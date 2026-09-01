-- ─────────────────────────────────────────────────────────────────────────────
-- "Quantos agendamos ontem?" era pergunta sem resposta
--
-- A Shosp devolve a data DA CONSULTA e nunca a data em que o agendamento foi
-- MARCADO. O espelho `shosp_appointments` copiava só isso, e `synced_at` é
-- reescrito toda vez que a linha muda de status, então nem ele servia de proxy.
--
-- Em 01/set/2026 a clínica passou o fechamento do dia (1 TC feminina, 2 TC
-- masculinas, 1 clínica masculina) e a única forma de descobrir QUEM eram foi
-- reconstruir pela numeração: `codigo_agendamento` é sequencial na Shosp, então
-- o que nasceu ontem está entre o maior código de anteontem e o maior de hoje.
-- Funcionou, e é frágil: depende de o sync ter rodado na virada dos dois dias.
--
-- `first_seen_at` grava a primeira vez que o CRM viu aquele agendamento. Não é
-- a hora exata em que a atendente marcou, é a rodada de sync seguinte (o cron
-- roda de 15 em 15 min, o full-agenda de 3 em 3h), e para contar por DIA isso
-- basta.
--
-- POR QUE FICA NULO NO HISTÓRICO: dá para preencher os antigos com `synced_at`,
-- e seria mentira. `synced_at` é a ÚLTIMA alteração: o agendamento de fevereiro
-- que alguém confirmou ontem tem synced_at de ontem. Nulo aqui quer dizer
-- "entrou antes de existir a medição", que é a verdade.
--
-- O UPSERT NÃO PRECISA MUDAR, E NÃO PODE MUDAR: em `_shared/shospSync.ts` o
-- payload não cita `first_seen_at`, e coluna ausente do payload não entra no
-- DO UPDATE SET do PostgREST. Se alguém adicionar o campo à lista, mesmo com o
-- valor "certo", a data de criação passa a ser reescrita a cada sync e a métrica
-- morre em silêncio.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.shosp_appointments
  add column if not exists first_seen_at timestamptz;

-- Em duas etapas de propósito: `add column ... default now()` preencheria as
-- ~30 mil linhas antigas com a data desta migration, que é o dado falso descrito
-- acima. Assim o default vale só para linha nova.
alter table public.shosp_appointments
  alter column first_seen_at set default now();

comment on column public.shosp_appointments.first_seen_at is
  'Primeira vez que este agendamento apareceu no sync. Proxy de "quando foi marcado", já que a Shosp não informa isso. NULO = anterior a 01/set/2026. Nunca mandar esta coluna no upsert do sync.';

create index if not exists shosp_appointments_first_seen_at_idx
  on public.shosp_appointments (first_seen_at desc)
  where first_seen_at is not null;

-- ── A leitura: o que foi marcado no período ──────────────────────────────────
--
-- Devolve o agendamento junto com o lead e o canal de onde a pessoa veio, que é
-- a pergunta que sempre vem colada ("e de onde vieram?"). Consulta médica e
-- horário de spa entram misturados na agenda, então `e_consulta` separa: o
-- serviço nem sempre chega preenchido (a varredura da grade inteira não traz
-- serviço), e nesse caso vale o prestador ser médico.
create or replace function public.crm_agendamentos_criados(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (
  codigo_agendamento text,
  criado_em          timestamptz,
  paciente           text,
  prontuario         text,
  prestador          text,
  servico            text,
  data_consulta      date,
  horario            text,
  status             text,
  e_consulta         boolean,
  lead_id            text,
  lead_nome          text,
  lead_criado_em     timestamptz,
  canal              text,
  campanha           text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.codigo_agendamento,
    a.first_seen_at,
    coalesce(a.payload->>'paciente', l.patient_name),
    a.prontuario,
    a.prestador,
    a.servico,
    a.data,
    a.horario,
    a.status,
    (a.servico ilike '%CONSULTA%')
      or (a.servico is null and a.prestador !~* 'spa capilar'),
    a.lead_id,
    l.patient_name,
    l.created_at,
    l.attribution_channel,
    l.attribution_campaign
  from shosp_appointments a
  left join leads l on l.id = a.lead_id and l.deleted_at is null
  where a.first_seen_at >= p_start
    and a.first_seen_at <  p_end
  order by a.first_seen_at;
$$;

comment on function public.crm_agendamentos_criados(timestamptz, timestamptz) is
  'Agendamentos MARCADOS no período (por first_seen_at), com lead e canal. Não confundir com a agenda do período, que filtra por shosp_appointments.data.';

revoke all on function public.crm_agendamentos_criados(timestamptz, timestamptz) from public, anon;
grant execute on function public.crm_agendamentos_criados(timestamptz, timestamptz) to authenticated, service_role;
