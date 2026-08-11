-- Costura entre a venda (clinic_sales) e a sala de cirurgia (srg_surgeries).
--
-- O buraco: clinic_sales.srg_surgery_id existia como coluna e estava NULO nas 213 vendas de
-- cirurgia. Consequência prática no funil: 62 cards em "cirurgia realizada" e só 12 com
-- cirurgia de verdade no espelho. O CRM afirmava "realizada" com base na data da planilha,
-- não em alguém ter operado.
--
-- A âncora é o PRONTUÁRIO, como já vale em srg_match_patients. Duas faixas:
--   'dia'              → prontuário bate E a data bate. 43 casos.
--   'prontuario_unico' → prontuário bate, é a única venda daquele prontuário e a única
--                        cirurgia daquele prontuário, mas as datas divergem. 15 casos.
--                        Liga, e GUARDA a divergência em dias. A data da planilha estava
--                        errada (a memória do módulo já registra venda em 31/07 com
--                        procedimento em 04/01) e esconder isso seria repetir o erro.
-- Prontuário com mais de uma venda ou mais de uma cirurgia (2 casos) NÃO é ligado.
-- Em saúde, casar por semelhança mostra a cirurgia de um paciente para outro.

alter table public.clinic_sales
  add column if not exists srg_match_kind text,
  add column if not exists srg_date_diff_days integer;

comment on column public.clinic_sales.srg_match_kind is
  'Como a venda foi ligada ao espelho: dia | prontuario_unico | manual. Null = não ligada.';
comment on column public.clinic_sales.srg_date_diff_days is
  'Quantos dias a data da planilha diverge da data que a sala registrou. 0 ou null = sem divergência.';

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Idempotente: só escreve onde srg_surgery_id ainda está nulo, e nunca por cima de um
-- vínculo manual (srg_match_kind = 'manual').

with cs as (
  select id,
         shosp_prontuario,
         (scheduled_at at time zone 'America/Sao_Paulo')::date as dia,
         count(*) over (partition by shosp_prontuario) as vendas_do_pront
  from public.clinic_sales
  where kind = 'cirurgia'
    and shosp_prontuario is not null
    and srg_surgery_id is null
    and coalesce(srg_match_kind, '') <> 'manual'
), sg as (
  select id,
         shosp_prontuario,
         dia,
         count(*) over (partition by shosp_prontuario) as cirurgias_do_pront
  from public.srg_surgeries
  where shosp_prontuario is not null
    and deleted_at is null
), par as (
  select cs.id as sale_id,
         sg.id as surgery_id,
         case when cs.dia = sg.dia then 'dia' else 'prontuario_unico' end as kind,
         case when cs.dia is null then null else (sg.dia - cs.dia) end as diff,
         row_number() over (
           partition by cs.id
           order by (cs.dia = sg.dia) desc nulls last, sg.dia
         ) as rn
  from cs
  join sg on sg.shosp_prontuario = cs.shosp_prontuario
  where cs.dia = sg.dia
     or (cs.vendas_do_pront = 1 and sg.cirurgias_do_pront = 1)
)
update public.clinic_sales c
set srg_surgery_id     = par.surgery_id,
    srg_match_kind     = par.kind,
    srg_date_diff_days = par.diff,
    updated_at         = now()
from par
where par.rn = 1
  and c.id = par.sale_id;

-- Mão dupla: o espelho passa a saber de qual venda veio.
update public.srg_surgeries s
set lead_id = c.lead_id
from public.clinic_sales c
where c.srg_surgery_id = s.id
  and c.lead_id is not null
  and s.lead_id is null;

-- ---------------------------------------------------------------------------
-- A tela de conferência
-- ---------------------------------------------------------------------------
-- Antes disso a única forma de saber que o funil mentia era rodar SQL na mão.

create or replace view public.v_cirurgia_conferencia
with (security_invoker = true) as
select
  c.id                                        as sale_id,
  c.tenant_id,
  c.lead_id,
  c.patient_name,
  c.shosp_prontuario,
  c.status,
  (c.scheduled_at at time zone 'America/Sao_Paulo')::date as data_vendida,
  s.dia                                       as data_da_sala,
  c.srg_surgery_id,
  c.srg_match_kind,
  c.srg_date_diff_days,
  s.total_implantados,
  s.status                                    as status_da_sala,
  case
    when c.srg_surgery_id is not null and coalesce(c.srg_date_diff_days, 0) <> 0
      then 'data_diverge'
    when c.srg_surgery_id is not null
      then 'confirmada'
    when c.status = 'realizada'
      then 'realizada_sem_confirmacao'
    when c.status = 'agendada'
      then 'agendada_sem_espelho'
    else 'sem_espelho'
  end                                         as conferencia
from public.clinic_sales c
left join public.srg_surgeries s on s.id = c.srg_surgery_id
where c.kind = 'cirurgia'
  and c.status <> 'cancelada';

comment on view public.v_cirurgia_conferencia is
  'Venda de cirurgia x o que a sala registrou. "realizada_sem_confirmacao" é o card que o funil dá como operado sem que exista cirurgia no espelho.';

grant select on public.v_cirurgia_conferencia to authenticated;

-- ---------------------------------------------------------------------------
-- Contagem para o topo da tela
-- ---------------------------------------------------------------------------

create or replace function public.crm_cirurgia_conferencia_resumo()
returns table (conferencia text, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select conferencia, count(*)::bigint
  from public.v_cirurgia_conferencia
  group by conferencia
  order by 2 desc;
$$;

revoke all on function public.crm_cirurgia_conferencia_resumo() from public;
grant execute on function public.crm_cirurgia_conferencia_resumo() to authenticated;
