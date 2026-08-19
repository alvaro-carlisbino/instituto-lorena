-- Duas coisas que o Tricopill não conseguia medir, e que apareceram juntas na conferência
-- dos pedidos 3675 (Elaine, Sinop) e 3695 (Dirce, São Paulo): o MESMO carrinho de R$ 746
-- saiu por R$ 757,27 e por R$ 681,57, e nenhum dos dois pagou frete.
--
-- 1. QUANTAS VEZES UM CUPOM FOI USADO
--
-- `coupons.uses` dizia 10 para o CLUBE10 enquanto o banco tinha 15 vendas pagas com ele.
-- A causa: o site tem cópia PRÓPRIA de `_shared/coupons.ts` e essa cópia nunca teve a
-- função que conta o uso — só o CRM conta. Toda venda do site passava sem contar.
--
-- Só somar as que faltam não resolve: `increment_coupon_use` soma cego, e os caminhos que
-- chamam ele podem repetir (o poll do Pix roda em cron, webhook reentrega, retry do Bling).
-- Contador que pode contar duas vezes é tão inútil quanto o que não conta, porque o dia que
-- o `max_uses` for ligado ele vai travar cedo ou tarde demais e ninguém vai saber qual.
--
-- Então o uso vira LINHA, não número: `coupon_uses` guarda QUEM queimou o cupom (o id do
-- pagamento). A chave primária é a idempotência — chamar duas vezes pelo mesmo pagamento
-- não conta duas vezes. `coupons.uses` continua existindo (o front e o `quoteCoupon` leem
-- ele) mas passa a ser derivado das linhas, nunca digitado.
--
-- 2. QUANTO CUSTOU A ETIQUETA
--
-- Não existia tabela de envio: o `autoShipToCart` monta o carrinho no Melhor Envio e o
-- custo morre ali. Por isso "frete grátis" não aparece em relatório nenhum e a conferência
-- do custo real acaba sendo feita à mão, na caneta, em cima do papel do pedido.
--
-- Com o limiar de frete grátis em R$ 560 (promo de agosto), TODA venda do kit 3+1 sai sem
-- frete, e o custo depende do CEP: a etiqueta da Dirce (São Paulo) custa R$ 28,98 e a da
-- Elaine (Sinop, MT) custa R$ 64,80. Mesma venda, mesma quantidade, R$ 35,82 de diferença
-- que hoje some. `shipping_labels` guarda o CUSTO ao lado do que foi COBRADO, para a conta
-- do frete grátis ser um select e não um bilhete.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Uso de cupom
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.coupon_uses (
  tenant_id text not null,
  code      text not null,
  -- Id do pagamento que queimou o cupom (rede_payments.id, asaas_payments.id,
  -- pagbank_checkouts.id). É o que torna a contagem idempotente.
  ref       text not null,
  used_at   timestamptz not null default now(),
  primary key (tenant_id, code, ref)
);

create index if not exists coupon_uses_tenant_code_idx on public.coupon_uses (tenant_id, code);

alter table public.coupon_uses enable row level security;

drop policy if exists "coupon_uses tenant read" on public.coupon_uses;
create policy "coupon_uses tenant read" on public.coupon_uses
  for select using (tenant_id = current_tenant_id());

comment on table public.coupon_uses is
  'Uma linha por uso de cupom, chaveada pelo pagamento que o queimou. É a fonte de coupons.uses e o que torna a contagem idempotente (cron/webhook/retry não contam duas vezes).';

-- Versão idempotente: conta pelo pagamento. Só mexe em `coupons.uses` quando a linha é
-- NOVA — `on conflict do nothing` + `returning` faz o insert dizer se contou ou não.
create or replace function public.increment_coupon_use(p_tenant text, p_code text, p_ref text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_linhas integer := 0;
begin
  if p_tenant is null or p_code is null or p_ref is null
     or btrim(p_code) = '' or btrim(p_ref) = '' then
    return false;
  end if;

  insert into public.coupon_uses (tenant_id, code, ref)
  values (p_tenant, upper(btrim(p_code)), p_ref)
  on conflict (tenant_id, code, ref) do nothing;

  -- ROW_COUNT é inteiro: 1 quando a linha é nova, 0 quando o cupom já tinha sido
  -- contado para este pagamento.
  get diagnostics v_linhas = row_count;

  if v_linhas > 0 then
    update public.coupons
       set uses = uses + 1, updated_at = now()
     where tenant_id = p_tenant and code = upper(btrim(p_code));
  end if;

  return v_linhas > 0;
end;
$fn$;

revoke all on function public.increment_coupon_use(text, text, text) from public, anon;
grant execute on function public.increment_coupon_use(text, text, text) to service_role;

comment on function public.increment_coupon_use(text, text, text) is
  'Conta UM uso do cupom, uma vez por pagamento. Chamar de novo com o mesmo ref devolve false e não soma.';

-- A versão de 2 argumentos continua existindo porque as edge functions JÁ DEPLOYADAS
-- chamam ela: se sumir agora, cupom para de contar entre esta migração e o redeploy.
-- Ela soma cego, como sempre somou. Quem for mexer num caller: passe o ref e use a de 3.
--
-- Mas ela nasceu ABERTA: o ACL tinha `anon=X` e o `=X/` de PUBLIC. Sendo `security definer`,
-- qualquer um com a chave publicável podia chamar e queimar uso de cupom pela API — e num
-- cupom com `max_uses` isso é apagar a promoção de fora. Quem chama é sempre edge function
-- com service_role, então fechar não quebra caminho nenhum.
revoke all on function public.increment_coupon_use(text, text) from public, anon, authenticated;
grant execute on function public.increment_coupon_use(text, text) to service_role;
revoke all on function public.increment_coupon_use(text, text, text) from public, anon, authenticated;
grant execute on function public.increment_coupon_use(text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Backfill: o histórico vira linha, e `uses` passa a ser o que o banco sabe
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.coupon_uses (tenant_id, code, ref, used_at)
select p.tenant_id, upper(btrim(p.coupon_code)), p.id, coalesce(p.paid_at, p.created_at)
  from public.rede_payments p
 where p.status = 'paid' and nullif(btrim(coalesce(p.coupon_code, '')), '') is not null
on conflict do nothing;

insert into public.coupon_uses (tenant_id, code, ref, used_at)
select p.tenant_id, upper(btrim(p.coupon_code)), p.id, coalesce(p.paid_at, now())
  from public.asaas_payments p
 where p.status = 'paid' and nullif(btrim(coalesce(p.coupon_code, '')), '') is not null
on conflict do nothing;

insert into public.coupon_uses (tenant_id, code, ref, used_at)
select p.tenant_id, upper(btrim(p.coupon_code)), p.checkout_id, coalesce(p.paid_at, p.created_at)
  from public.pagbank_checkouts p
 where p.status = 'paid' and nullif(btrim(coalesce(p.coupon_code, '')), '') is not null
on conflict do nothing;

-- `uses` passa a ser o que as linhas dizem. Sobe onde o site não contava (CLUBE10: 10 → 15)
-- e desce onde algum caminho contou duas vezes.
update public.coupons c
   set uses = coalesce((select count(*) from public.coupon_uses u
                         where u.tenant_id = c.tenant_id and u.code = c.code), 0),
       updated_at = now()
 where coalesce(c.uses, 0) <> coalesce((select count(*) from public.coupon_uses u
                                         where u.tenant_id = c.tenant_id and u.code = c.code), 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Custo real da etiqueta
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.shipping_labels (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null,
  lead_id       text,
  -- Pagamento (rede_payments.id / asaas_payments.id) ou nº do pedido no Bling. É o que
  -- liga o custo à venda; sem ele a linha ainda vale pelo par lead + data.
  order_ref     text,
  cart_id       text,
  service       text,
  company       text,
  -- CUSTO da etiqueta (o que sai da carteira do Melhor Envio), sem markup.
  cost_cents    integer,
  -- O que o cliente PAGOU de frete nessa venda. 0 = frete grátis, e a diferença para o
  -- custo é o que a promoção tirou da margem.
  charged_cents integer,
  to_cep        text,
  to_city       text,
  to_uf         text,
  created_at    timestamptz not null default now()
);

create index if not exists shipping_labels_tenant_created_idx on public.shipping_labels (tenant_id, created_at desc);
create index if not exists shipping_labels_lead_idx on public.shipping_labels (lead_id);
create index if not exists shipping_labels_order_ref_idx on public.shipping_labels (order_ref);

alter table public.shipping_labels enable row level security;

drop policy if exists "shipping_labels tenant read" on public.shipping_labels;
create policy "shipping_labels tenant read" on public.shipping_labels
  for select using (tenant_id = current_tenant_id());

comment on table public.shipping_labels is
  'Custo real do frete por envio, ao lado do que foi cobrado do cliente. Gravada pelo autoShipToCart no momento em que o envio entra no carrinho do Melhor Envio.';
