-- Taxa da adquirente por venda + rastro da conta a receber no Bling.
--
-- Motivo (29/jul/2026): o Kauan não conseguia fechar o caixa porque o financeiro do Bling não
-- batia com o extrato da Rede. A investigação mostrou que NÃO era o valor do pedido (esses
-- batiam no centavo) — era que **a venda não existia no financeiro do Bling**: dos 21 pedidos
-- que o nosso sistema criou entre 20 e 29/jul, ZERO tinham conta a receber, contra 62 de 70
-- lançados à mão pela equipe. Pedido criado por API nasce "Em aberto" e o Bling não gera o
-- financeiro sozinho.
--
-- Agora a venda gera a conta a receber pelo valor BRUTO (= o que o cliente pagou = o que sai na
-- NF-e) e a taxa da adquirente entra como `tarifa` na baixa. Assim o caixa fecha pelo LÍQUIDO
-- sem mexer no valor da venda: taxa de cartão é despesa financeira, não desconto na mercadoria.
alter table public.rede_payments
  add column if not exists fee_cents           integer,
  add column if not exists net_cents           integer,
  add column if not exists fee_source          text,
  add column if not exists bling_receivable_id text,
  add column if not exists bling_settled_at    timestamptz;

alter table public.asaas_payments
  add column if not exists fee_cents           integer,
  add column if not exists net_cents           integer,
  add column if not exists fee_source          text,
  add column if not exists bling_receivable_id text,
  add column if not exists bling_settled_at    timestamptz;

comment on column public.rede_payments.fee_cents is
  'Taxa retida pela adquirente nesta venda, em centavos.';
comment on column public.rede_payments.net_cents is
  'Líquido recebido (amount_cents - fee_cents) — é o número que fecha o caixa.';
comment on column public.rede_payments.fee_source is
  'tabela = calculada pela taxa cadastrada em tenant_integrations.<gateway>.fees; extrato = valor REAL importado do extrato da adquirente (tem precedência).';

-- Tabela de taxas da Rede. Só cadastro a que está PROVADA no extrato de 28/07 (crédito à vista
-- 1,32%). As outras modalidades ficam de fora de propósito: sem taxa cadastrada o sistema cria a
-- conta a receber e deixa EM ABERTO em vez de baixar com um número chutado — taxa errada no
-- financeiro do cliente é pior que campo vazio. Complete débito/parcelado no extrato da Rede.
update public.tenant_integrations
   set rede = coalesce(rede, '{}'::jsonb) || jsonb_build_object(
         'fees', coalesce(rede->'fees', '{}'::jsonb) || jsonb_build_object('credito_avista', 1.32)
       )
 where tenant_id in ('instituto-lorena', 'tricopill')
   and rede is not null;

-- Backfill das duas vendas de 28/07 que destravaram o caixa (contas criadas e baixadas na mão
-- pela API do Bling: 26454734392 → pedido 3506, 26454747805 → pedido 3507).
update public.rede_payments
   set fee_cents = 749, net_cents = 55966, fee_source = 'extrato',
       bling_receivable_id = '26454734392', bling_settled_at = '2026-07-28T15:01:20Z'
 where id = '25cc57dc1d194a9b' and fee_cents is null;

update public.rede_payments
   set fee_cents = 220, net_cents = 16451, fee_source = 'extrato',
       bling_receivable_id = '26454747805', bling_settled_at = '2026-07-28T18:31:56Z'
 where id = '78831f2712d24c89' and fee_cents is null;
