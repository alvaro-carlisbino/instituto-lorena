-- Catálogo de protocolos a partir das vendas que já aconteceram.
--
-- treatment_protocols nasceu vazio em 07/jul (a migration original não tinha seed) e ficou
-- assim por um mês: a tela /protocolos abria em "Cadastre um protocolo primeiro" e a seção
-- da ficha do lead não deixava iniciar nada. Enquanto isso 205 protocolos foram vendidos e
-- registrados em clinic_sales, escritos à mão em 41 rótulos diferentes ("PROTOCOLO PÓS TC",
-- "protocolo pos tc", "PROTOOCLO PÓS TC", "PROTCOLO PÓS TC"...).
--
-- O catálogo abaixo NÃO é inventado: é a normalização desses rótulos, com o preço vindo da
-- MEDIANA do que foi cobrado de verdade. O número de sessões só é preenchido onde o próprio
-- rótulo diz ("3 SESSÕES", "5 SESSÕES", "SESSÃO AVULSA"); nos demais fica 0, que a UI mostra
-- como "a definir". Chutar 4 ou 6 sessões seria inventar protocolo clínico, e isso não se faz.

-- ---------------------------------------------------------------------------
-- 1. A regra de normalização, em UM lugar só
-- ---------------------------------------------------------------------------
-- Mesmo princípio do lib/search.js do site: a regra mora numa função e todo mundo chama ela.
-- Se amanhã a Ingrid inventar um rótulo novo, muda aqui e o catálogo inteiro acompanha.

create or replace function public.clinic_protocol_key(p_label text)
returns text
language sql
immutable
set search_path = public
as $$
  with t as (
    select regexp_replace(
             upper(translate(
               coalesce(p_label, ''),
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
             )),
             '\s+', ' ', 'g'
           ) as s
  )
  select case
    -- "ENTRADA DE PROTOCOLO" (R$ 500) e "RESTANTE DE PROTOCOLO" não são protocolos, são
    -- pedaços de pagamento do mesmo protocolo. Não viram item de catálogo.
    when t.s = '' then null
    when t.s ~ 'ENTRADA DE PROTOCOLO|RESTANTE DE PROTOCOLO' then 'parcela'
    -- Pós-TC vem antes de "inicial" porque existe "PROTOCOLO INICIAL PÓS TC".
    -- Exige o "TC" explícito: "PROTOCOLO PÓS" e "PROTOCOLO PÓS PROTOCOLO" caem em 'outros'
    -- de propósito. O preço deles até parece pós-TC, mas casar por semelhança é a mesma
    -- armadilha do srg_match_patients, e aqui o custo é a clínica cobrar o valor errado.
    when t.s ~ 'POS *TC' then 'pos-tc'
    when t.s ~ 'INICIAL' then 'inicial'
    when t.s ~ '5 *SESS' then 'terapia-5'
    when t.s ~ '3 *SESS|3 *TERAPIA' then 'terapia-3'
    when t.s ~ 'MANUTENCAO' then 'manutencao'
    when t.s ~ 'CONVENCIONAL|PROTOCOLO CONV' then 'convencional'
    when t.s ~ 'AVULS' then 'avulsa'
    else 'outros'
  end
  from t;
$$;

comment on function public.clinic_protocol_key(text) is
  'Normaliza o rótulo digitado à mão em clinic_sales.procedure_label para a chave do catálogo. Regra única: quem precisar classificar protocolo chama esta função.';

-- ---------------------------------------------------------------------------
-- 2. Chave estável no catálogo, para o seed ser idempotente
-- ---------------------------------------------------------------------------

alter table public.treatment_protocols
  add column if not exists source_key text;

comment on column public.treatment_protocols.source_key is
  'Chave de clinic_protocol_key(). Null = protocolo cadastrado à mão pela clínica, que o seed nunca toca.';

create unique index if not exists treatment_protocols_tenant_source_key_uidx
  on public.treatment_protocols (tenant_id, source_key)
  where source_key is not null;

-- ---------------------------------------------------------------------------
-- 3. O catálogo
-- ---------------------------------------------------------------------------
-- sessions_planned = 0 quer dizer "a definir", não "uma sessão". A UI trata assim.

insert into public.treatment_protocols
  (tenant_id, source_key, name, category, sessions_planned, interval_days, default_price, description, active)
values
  ('instituto-lorena', 'pos-tc',      'Protocolo Pós-TC',             'capilar', 0, 30, 4600.00,
   'Protocolo de acompanhamento após o transplante capilar. 85 vendas em 2026, preço mediano R$ 4.600. Número de sessões a confirmar com a clínica.', true),
  ('instituto-lorena', 'convencional','Protocolo Convencional',       'capilar', 0, 30, 5580.00,
   'Protocolo capilar sem cirurgia. 49 vendas em 2026, preço mediano R$ 5.580. Número de sessões a confirmar com a clínica.', true),
  ('instituto-lorena', 'manutencao',  'Protocolo de Manutenção',      'capilar', 0, 30, 5000.00,
   'Manutenção após protocolo ou cirurgia. 27 vendas em 2026, preço mediano R$ 5.000. Número de sessões a confirmar com a clínica.', true),
  ('instituto-lorena', 'inicial',     'Protocolo Inicial',            'capilar', 0, 30, 2400.00,
   'Entrada no tratamento capilar. 5 vendas em 2026, preço mediano R$ 2.400. Número de sessões a confirmar com a clínica.', true),
  ('instituto-lorena', 'terapia-3',   'Pacote 3 sessões de terapia',  'spa',     3, 30, 1070.00,
   'Pacote fechado de 3 sessões de terapia capilar. 19 vendas em 2026, preço mediano R$ 1.070.', true),
  ('instituto-lorena', 'terapia-5',   'Pacote 5 sessões de terapia',  'spa',     5, 30, 1695.00,
   'Pacote fechado de 5 sessões de terapia capilar. 7 vendas em 2026, preço mediano R$ 1.695.', true),
  ('instituto-lorena', 'avulsa',      'Sessão avulsa (TR / MMP)',     'spa',     1, null, 1800.00,
   'Sessão única de terapia regenerativa ou microagulhamento. 3 vendas em 2026, preço mediano R$ 1.800.', true)
on conflict (tenant_id, source_key) where source_key is not null
do update set
  name             = excluded.name,
  category         = excluded.category,
  interval_days    = excluded.interval_days,
  description      = excluded.description,
  updated_at       = now();
-- de propósito o update NÃO mexe em sessions_planned nem em default_price: assim que a
-- clínica corrigir o número de sessões ou o preço na tela, um redeploy não desfaz.
