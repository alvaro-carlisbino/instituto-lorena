-- Venda de Shopee, Mercado Livre e TikTok Shop também vai para o grupo do WhatsApp.
--
-- O comprovante de venda no grupo do financeiro nasceu preso ao GATEWAY: quem dispara é o
-- fechamento do pagamento na e.Rede, no Asaas, no ciclo da assinatura ou na confirmação manual.
-- Venda de marketplace não passa por gateway nenhum — ela nasce pronta dentro do Bling, pela
-- integração do canal. Resultado: o grupo via a venda do site e do bot no mesmo minuto, e a
-- venda da Shopee só existia para quem abrisse o Bling.
--
-- Quem passa a mandar é a varredura `crm-bling-marketplace-fin`, que já lê exatamente esses
-- pedidos para lançar a conta a receber que o Bling não gera. Esta migração dá a ela as três
-- coisas que faltavam: onde carimbar o que já foi enviado, como chamar cada canal pelo nome, e
-- de que dia em diante começar (para a primeira rodada não despejar a semana inteira no grupo).

-- ── 1. Onde fica a marca de "já mandei" ─────────────────────────────────────────────────────
--
-- Sem uma marca persistida, a varredura reenviaria a mesma venda a cada rodada. As tabelas de
-- pagamento não servem: pedido de marketplace não tem linha em `rede_payments`/`asaas_payments`
-- (é essa a razão de o comprovante nunca ter saído). Chave = polo + id do pedido no Bling.
--
-- Grupo e dono têm marca SEPARADA porque falham separado: um W-API instável entre os dois
-- envios faria a venda chegar duas vezes para quem já tinha recebido.
create table if not exists public.marketplace_sale_receipts (
  tenant_id       text        not null,
  bling_order_id  text        not null,
  numero          text,
  canal           text,
  canal_loja_id   text,
  pedido_do_canal text,
  amount_cents    bigint,
  order_date      date,
  group_sent_at   timestamptz,
  owner_sent_at   timestamptz,
  created_at      timestamptz not null default now(),
  primary key (tenant_id, bling_order_id)
);

comment on table public.marketplace_sale_receipts is
  'Comprovante de venda de marketplace (Shopee/Mercado Livre/TikTok Shop) entregue no WhatsApp. '
  'A linha É o dedupe: enquanto group_sent_at/owner_sent_at estiverem nulos, a varredura '
  'crm-bling-marketplace-fin tenta de novo na rodada seguinte.';

-- Reenviar um comprovante à mão: zerar a marca e esperar a próxima rodada da varredura.
--   update marketplace_sale_receipts set group_sent_at = null where bling_order_id = '…';
create index if not exists marketplace_sale_receipts_pendentes_idx
  on public.marketplace_sale_receipts (tenant_id, created_at desc)
  where group_sent_at is null;

alter table public.marketplace_sale_receipts enable row level security;

drop policy if exists "marketplace_sale_receipts tenant read" on public.marketplace_sale_receipts;
create policy "marketplace_sale_receipts tenant read"
  on public.marketplace_sale_receipts
  for select
  using (public.is_staff_user() and tenant_id = public.current_tenant_id());

-- Quem escreve aqui é só a Edge Function (service_role, que passa por cima da RLS). O painel
-- lê; ninguém logado precisa gravar. Sem isto, o grant padrão do Supabase deixaria a ausência
-- de policy de INSERT ser a única barreira.
revoke insert, update, delete on public.marketplace_sale_receipts from anon, authenticated;

-- ── 2. Nome do canal e data de corte ────────────────────────────────────────────────────────
--
-- O pedido do Bling identifica o canal por `loja.id` (206142894, 206152906…), e não existe
-- endpoint que traduza esse número: `/canais-de-venda` responde 404. O nome bonito vem daqui;
-- o CNPJ do intermediador (Shopee 35.635.824/0001-12, Mercado Livre/EBAZAR 03.007.331/0001-41)
-- é o plano B no código. Canal novo = uma linha a mais neste JSON, sem deploy.
--
-- Os dois primeiros ids saíram de pedidos reais (3734 Shopee, 3696 Mercado Livre). O do TikTok
-- veio da tela de configuração da integração e ainda não foi confirmado por pedido — se o
-- primeiro pedido do TikTok chegar ao grupo como "Marketplace (loja …)", é este id que está
-- errado, e o conserto é trocar a chave aqui.
--
-- `marketplace_receipt_since` existe para a PRIMEIRA rodada não mandar de uma vez todas as
-- vendas de marketplace da janela de varredura. Sem ele, ligar a função significaria despejar
-- uma semana de pedidos antigos no grupo do financeiro.
update public.tenant_integrations
set notifications = coalesce(notifications, '{}'::jsonb) || jsonb_build_object(
      'marketplace_receipt_enabled', true,
      'marketplace_receipt_since', '2026-08-28',
      'marketplace_channel_names', jsonb_build_object(
        '206142894', 'Shopee',
        '206152906', 'Mercado Livre',
        '206140663', 'TikTok Shop'
      )
    ),
    updated_at = now()
where bling ->> 'access_token' is not null;

-- ── 3. A varredura passa a rodar de 15 em 15 minutos ────────────────────────────────────────
--
-- De hora em hora bastava para lançar conta a receber; para avisar venda, não. O trabalho novo
-- por rodada é pequeno: a listagem de pedidos da janela já era feita, e o DETALHE do pedido
-- (itens, endereço, comissão) só é buscado para pedido que ainda não tem comprovante.
do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'crm-bling-marketplace-fin-job';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule => '*/15 * * * *');
  end if;
end $$;
