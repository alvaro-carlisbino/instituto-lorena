-- O protocolo do paciente, a partir da venda que já existe.
--
-- Estado antes: 186 cards no funil "PROTOCOLOS E SPA" (115 em "fechado", 22 em "em sessões")
-- e lead_treatment_protocols / lead_protocol_sessions com ZERO linhas. Ou seja: o Kanban
-- dizia que 22 pacientes estavam em sessão e não existia um único registro de sessão no
-- sistema. A tela sabia desenhar, mas não tinha o que desenhar.
--
-- Aqui cada venda de protocolo com lead vira um registro de protocolo do paciente, para que
-- a equipe consiga finalmente clicar em "registrar sessão".

-- ---------------------------------------------------------------------------
-- 1. Rastro da origem, para o backfill ser idempotente
-- ---------------------------------------------------------------------------

alter table public.lead_treatment_protocols
  add column if not exists clinic_sale_id uuid references public.clinic_sales(id) on delete set null;

comment on column public.lead_treatment_protocols.clinic_sale_id is
  'Venda que originou este protocolo. Null = protocolo iniciado à mão na tela.';

create unique index if not exists lead_treatment_protocols_clinic_sale_uidx
  on public.lead_treatment_protocols (clinic_sale_id)
  where clinic_sale_id is not null;

-- ---------------------------------------------------------------------------
-- 2. O backfill
-- ---------------------------------------------------------------------------
-- Fica de fora, de propósito:
--   'parcela' → "ENTRADA DE PROTOCOLO" / "RESTANTE DE PROTOCOLO" são pedaços de pagamento
--               do mesmo protocolo. Virariam protocolo duplicado.
--   'outros'  → rótulo que a normalização não reconheceu ("PROTOCOLO PÓS PROTOCOLO",
--               "PACOTE TERAPIA" sem número). Aparecem na tela para alguém classificar.
--
-- status: TODOS entram como 'ativo', inclusive os que a venda marca como 'realizada'.
-- Marcar 'concluido' sem uma única sessão registrada seria inventar histórico clínico.

insert into public.lead_treatment_protocols
  (tenant_id, lead_id, protocol_id, clinic_sale_id, name, sessions_planned, price, status, started_on, note)
select
  cs.tenant_id,
  cs.lead_id,
  tp.id,
  cs.id,
  tp.name,
  tp.sessions_planned,
  round(cs.value_cents / 100.0, 2),
  'ativo',
  coalesce(cs.sold_at, (cs.scheduled_at at time zone 'America/Sao_Paulo')::date, cs.created_at::date),
  'Importado da venda de ' || coalesce(to_char(cs.sold_at, 'DD/MM/YYYY'), 'data não informada')
    || ' (rótulo original: "' || cs.procedure_label || '").'
    || case when tp.sessions_planned = 0
            then ' Número de sessões a definir com a clínica.'
            else '' end
from public.clinic_sales cs
join public.treatment_protocols tp
  on tp.source_key = public.clinic_protocol_key(cs.procedure_label)
 and tp.tenant_id  = cs.tenant_id
where cs.kind = 'protocolo'
  and cs.lead_id is not null
  and cs.status <> 'cancelada'
on conflict (clinic_sale_id) where clinic_sale_id is not null do nothing;

-- ---------------------------------------------------------------------------
-- 3. O que sobrou, para não sumir
-- ---------------------------------------------------------------------------

create or replace view public.v_protocolo_sem_catalogo
with (security_invoker = true) as
select
  cs.id            as sale_id,
  cs.tenant_id,
  cs.lead_id,
  cs.patient_name,
  cs.procedure_label,
  cs.value_cents / 100.0 as valor,
  cs.sold_at,
  public.clinic_protocol_key(cs.procedure_label) as motivo
from public.clinic_sales cs
where cs.kind = 'protocolo'
  and cs.status <> 'cancelada'
  and coalesce(public.clinic_protocol_key(cs.procedure_label), 'outros') in ('outros', 'parcela');

comment on view public.v_protocolo_sem_catalogo is
  'Venda de protocolo que não virou protocolo do paciente: rótulo não reconhecido (outros) ou pedaço de pagamento (parcela). Precisa de olho humano.';

grant select on public.v_protocolo_sem_catalogo to authenticated;
