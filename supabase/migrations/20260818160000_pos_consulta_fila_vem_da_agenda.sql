-- A fila de pós-consulta passa a nascer da AGENDA, não do arrasto de card.
--
-- Contexto (18/ago/2026, pergunta da Aline): ela atendeu uma consulta de
-- transplante da Dra. Lorena às 10h45, abriu a aba Pós-consulta às 12h57 e não
-- achou o paciente. Não era atraso de sincronismo: a fila lia UMA coisa só —
-- lead parado na etapa "Consulta Realizada" do funil da clínica. Quem move o
-- card para lá é gente, e quase nunca acontece (era o mesmo repasse que "quase
-- nunca acontecia" no tempo da planilha).
--
-- O caminho automático existia e estava morto por dois motivos independentes:
--
--   1. `advanceLeadStageFromShosp` procura status `atendid|comparec|realizad`.
--      A Shosp desta clínica NUNCA devolve nenhum dos três. O vocabulário real,
--      medido no espelho: Agendado (2.441), Confirmado (1.319), Desmarcado (184)
--      e Faltou (79). Zero "Atendido". A regra nunca casou uma vez sequer.
--
--   2. Mesmo que casasse, o passo por paciente só varre os 10 leads de
--      `last_interaction_at` mais recente por rodada, entre 290 com prontuário.
--      Paciente que conversou há duas semanas e sentou na cadeira hoje nunca
--      entra nessa janela.
--
-- A virada: para saber que alguém saiu da consulta não é preciso status nenhum.
-- O agendamento de hoje JÁ está no espelho desde o dia em que foi marcado, com
-- médico, horário e (quando veio pelo passo por paciente) serviço. Se a hora
-- passou e ninguém desmarcou nem registrou falta, a pessoa esteve aqui. É a
-- mesma leitura que o analytics já usa desde 28/jul ("comparecido é PROXY").
--
-- O que NÃO entra na fila, para a Aline não receber lista de 20 nomes por dia:
--   * agenda do spa (prestador "Spa Capilar - *") — sessão, não consulta;
--   * retorno, finalização, lavagem, curativo, execução de protocolo — quando o
--     serviço veio da Shosp, ele decide; quando não veio (a grade geral não
--     devolve serviço), a observação da recepção é o desempate possível.
--
-- A fila começa em 18/08/2026. Sem esse corte, a primeira abertura da tela
-- traria meses de consulta antiga e repetiria o problema que a migration de
-- ontem resolveu zerando 43 pacientes de backlog.

-- ---------------------------------------------------------------------------
-- Destino dado a cada item da fila
-- ---------------------------------------------------------------------------
-- Item da fila não é mais "um lead": é uma CONSULTA (`agenda:<codigo>`), um lead
-- parado na etapa antiga (`lead:<id>`) ou uma inclusão à mão (`manual:<uuid>`).
-- Por isso a decisão é gravada por item, e não mais por lead — o mesmo paciente
-- pode voltar em outra consulta e merecer outra decisão.
create table if not exists public.post_consultation_resolutions (
  item_id     text primary key,
  tenant_id   text not null default 'instituto-lorena' references public.tenants (id),
  lead_id     text references public.leads (id) on delete set null,
  prontuario  text,
  -- Nome copiado na hora da decisão: item de agenda pode não ter card, e a lista
  -- "fora da fila" precisa mostrar gente mesmo quando o paciente não é lead.
  paciente    text not null,
  consulta_em date,
  outcome     text not null,
  reason      text,
  resolved_by text,
  resolved_at timestamptz not null default now()
);

-- Fora do `create table` porque a coluna ganhou o destino 'followup' depois: a
-- Aline precisa marcar o primeiro contato de quem saiu da consulta dizendo que
-- vai pensar, e isso não é venda nem funil novo — é só o retorno combinado.
alter table public.post_consultation_resolutions
  drop constraint if exists post_consultation_resolutions_outcome_check;
alter table public.post_consultation_resolutions
  add constraint post_consultation_resolutions_outcome_check
  check (outcome in ('cirurgia', 'protocolo', 'followup', 'dispensado'));

create index if not exists post_consultation_resolutions_tenant_idx
  on public.post_consultation_resolutions (tenant_id, resolved_at desc);
create index if not exists post_consultation_resolutions_lead_idx
  on public.post_consultation_resolutions (lead_id);

alter table public.post_consultation_resolutions enable row level security;
drop policy if exists "post_consultation_resolutions tenant" on public.post_consultation_resolutions;
create policy "post_consultation_resolutions tenant" on public.post_consultation_resolutions
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on table public.post_consultation_resolutions is
  'Destino dado a cada item da fila de pós-consulta (consulta da agenda, lead parado ou inclusão manual).';

-- Herda o que já estava dispensado, senão os 43 de ontem voltariam à fila hoje.
insert into public.post_consultation_resolutions
  (item_id, tenant_id, lead_id, paciente, outcome, reason, resolved_at)
select 'lead:' || d.lead_id, d.tenant_id, d.lead_id,
       coalesce(l.patient_name, '—'), 'dispensado', d.reason, d.dismissed_at
from public.post_consultation_dismissals d
left join public.leads l on l.id = d.lead_id
on conflict (item_id) do nothing;

comment on table public.post_consultation_dismissals is
  'LEGADO: substituída por post_consultation_resolutions (as linhas foram copiadas). Mantida só para não perder histórico.';

-- ---------------------------------------------------------------------------
-- Inclusão à mão
-- ---------------------------------------------------------------------------
-- A Aline pediu explicitamente: "eu mesma poderia registrar ele aqui". Serve
-- para o que a agenda não conta — consulta encaixada, paciente que voltou fora
-- de horário, ou consulta cujo serviço a Shosp não devolveu.
create table if not exists public.post_consultation_manual_items (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   text not null default 'instituto-lorena' references public.tenants (id),
  lead_id     text references public.leads (id) on delete cascade,
  prontuario  text,
  paciente    text not null,
  telefone    text,
  consulta_em date not null default (now() at time zone 'America/Sao_Paulo')::date,
  nota        text,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists post_consultation_manual_items_tenant_idx
  on public.post_consultation_manual_items (tenant_id, consulta_em desc);

alter table public.post_consultation_manual_items enable row level security;
drop policy if exists "post_consultation_manual_items tenant" on public.post_consultation_manual_items;
create policy "post_consultation_manual_items tenant" on public.post_consultation_manual_items
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on table public.post_consultation_manual_items is
  'Paciente colocado na fila de pós-consulta à mão, quando a agenda não conta a história toda.';

-- ---------------------------------------------------------------------------
-- A fila
-- ---------------------------------------------------------------------------
-- Três origens numa lista só, sem materializar nada: o que vale é o estado de
-- agora. Consulta desmarcada depois some sozinha; falta registrada depois some
-- sozinha; paciente já encaminhado some porque tem linha em `resolutions`.
--
-- SECURITY INVOKER de propósito: a RLS de `shosp_*` (só membro de polo clínica)
-- e a de `leads` continuam valendo. Quem é só do Tricopill recebe zero linha,
-- sem precisar de trava nova aqui dentro.
create or replace function public.crm_pos_consulta_fila(p_dias integer default 7)
returns table (
  item_id     text,
  origem      text,
  lead_id     text,
  prontuario  text,
  paciente    text,
  telefone    text,
  consulta_em date,
  horario     text,
  prestador   text,
  servico     text,
  status_agenda text,
  origem_lead text,
  dias_parado integer
)
language sql
stable
set search_path to 'public'
as $fn$
with agora as (
  select (now() at time zone 'America/Sao_Paulo')::date as dia,
         (now() at time zone 'America/Sao_Paulo')::time as hora
),
janela as (
  select a.dia,
         a.hora,
         greatest(a.dia - greatest(coalesce(p_dias, 7), 0), date '2026-08-18') as desde
  from agora a
),
-- Uma linha por paciente: a consulta mais recente da janela. Dois horários no
-- mesmo dia (acontece: encaixe, remanejamento) não viram duas cobranças.
consultas as (
  select distinct on (ap.prontuario)
    ap.codigo_agendamento as codigo,
    ap.prontuario         as prontuario,
    ap.data               as data,
    ap.horario            as horario,
    ap.prestador          as prestador,
    ap.servico            as servico,
    ap.status             as status,
    coalesce(sp.nome, ap.payload ->> 'paciente', '—') as paciente,
    coalesce(ld.id, sp.lead_id)                       as lead_id,
    nullif(coalesce(sp.celular, sp.telefone), '')     as telefone,
    jn.dia                                            as dia_hoje
  from public.shosp_appointments ap
  cross join janela jn
  left join public.shosp_patients sp on sp.prontuario = ap.prontuario
  left join lateral (
    select lx.id
    from public.leads lx
    where lx.shosp_prontuario = ap.prontuario
      and lx.deleted_at is null
    order by lx.updated_at desc
    limit 1
  ) ld on true
  where ap.prontuario is not null
    and ap.data between jn.desde and jn.dia
    -- Consulta que ainda não aconteceu não é pós-consulta. Sem horário legível,
    -- espera virar o dia em vez de cobrar a Aline por algo que não terminou.
    and (
      ap.data < jn.dia
      or substring(coalesce(ap.horario, '') from '^[0-9]{1,2}:[0-9]{2}')::time <= jn.hora
    )
    and coalesce(ap.status, '') !~* 'desmarc|cancel|falt'
    and coalesce(ap.prestador, '') !~* '^[[:space:]]*spa capilar'
    -- Serviço manda quando existe. Quando não existe (a grade geral da Shosp não
    -- devolve serviço), a observação da recepção é o que sobra para separar
    -- consulta de retorno/finalização.
    and case
          when nullif(btrim(coalesce(ap.servico, '')), '') is not null
            then ap.servico ~* '^[[:space:]]*consulta'
          else coalesce(ap.payload ->> 'observacao', '')
               !~* 'finaliza|retorno|lavagem|curativo|protocolo|terapia|sess[aã]o|[0-9][[:space:]]*[ºo°]?[[:space:]]*(m[eê]s|meses)'
        end
  order by ap.prontuario, ap.data desc, ap.horario desc nulls last
),
da_agenda as (
  select
    ('agenda:' || cs.codigo)::text as item_id,
    'agenda'::text                 as origem,
    cs.lead_id                     as lead_id,
    cs.prontuario                  as prontuario,
    cs.paciente                    as paciente,
    cs.telefone                    as telefone,
    cs.data                        as consulta_em,
    cs.horario                     as horario,
    cs.prestador                   as prestador,
    cs.servico                     as servico,
    cs.status                      as status_agenda,
    null::text                     as origem_lead,
    (cs.dia_hoje - cs.data)::integer as dias_parado
  from consultas cs
  where not exists (
    select 1 from public.post_consultation_resolutions r
    where r.item_id = 'agenda:' || cs.codigo
  )
),
-- Origem antiga: lead arrastado à mão para "Consulta Realizada". Continua
-- valendo — só deixou de ser a ÚNICA porta.
do_funil as (
  select
    ('lead:' || lf.id)::text as item_id,
    'funil'::text            as origem,
    lf.id                    as lead_id,
    lf.shosp_prontuario      as prontuario,
    lf.patient_name          as paciente,
    lf.phone                 as telefone,
    (coalesce(lf.stage_entered_at, lf.created_at) at time zone 'America/Sao_Paulo')::date as consulta_em,
    null::text               as horario,
    null::text               as prestador,
    null::text               as servico,
    null::text               as status_agenda,
    lf.source                as origem_lead,
    greatest(
      0,
      (select jn.dia from janela jn)
        - (coalesce(lf.stage_entered_at, lf.created_at) at time zone 'America/Sao_Paulo')::date
    )::integer               as dias_parado
  from public.leads lf
  where lf.pipeline_id = 'pipeline-clinica'
    and lf.stage_id = 'stage-1777902160674'
    and lf.deleted_at is null
    -- Qualquer destino recente vale, não só o item 'lead:<id>': o mesmo paciente
    -- entra pela agenda, é encaminhado, e o card continua parado na etapa antiga.
    -- Sem esta linha ele voltaria à fila no instante seguinte, pela porta velha.
    and not exists (
      select 1 from public.post_consultation_resolutions r
      where (r.item_id = 'lead:' || lf.id or r.lead_id = lf.id)
        and r.resolved_at >= now() - interval '60 days'
    )
    -- Mesmo paciente vindo pelas duas portas aparece uma vez só, pela agenda,
    -- que é a que sabe médico, dia e serviço.
    and not exists (
      select 1 from da_agenda ag where ag.lead_id = lf.id
    )
),
na_mao as (
  select
    ('manual:' || mi.id::text)::text as item_id,
    'manual'::text                   as origem,
    mi.lead_id                       as lead_id,
    mi.prontuario                    as prontuario,
    mi.paciente                      as paciente,
    mi.telefone                      as telefone,
    mi.consulta_em                   as consulta_em,
    null::text                       as horario,
    null::text                       as prestador,
    mi.nota                          as servico,
    null::text                       as status_agenda,
    null::text                       as origem_lead,
    greatest(0, (select jn.dia from janela jn) - mi.consulta_em)::integer as dias_parado
  from public.post_consultation_manual_items mi
  where not exists (
    select 1 from public.post_consultation_resolutions r
    where r.item_id = 'manual:' || mi.id::text
  )
),
tudo as (
  select * from da_agenda
  union all
  select * from do_funil
  union all
  select * from na_mao
)
select t.item_id, t.origem, t.lead_id, t.prontuario, t.paciente, t.telefone,
       t.consulta_em, t.horario, t.prestador, t.servico, t.status_agenda,
       t.origem_lead, t.dias_parado
from tudo t
order by t.consulta_em asc nulls last, t.horario asc nulls last, t.paciente asc
$fn$;

comment on function public.crm_pos_consulta_fila(integer) is
  'Fila de pós-consulta: consulta médica que já aconteceu (espelho Shosp) + lead parado na etapa antiga + inclusão manual, menos quem já recebeu destino.';

revoke execute on function public.crm_pos_consulta_fila(integer) from public, anon;
grant execute on function public.crm_pos_consulta_fila(integer) to authenticated, service_role;
