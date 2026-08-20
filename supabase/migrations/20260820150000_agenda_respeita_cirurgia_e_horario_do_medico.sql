-- ─────────────────────────────────────────────────────────────────────────────
-- A landing passa a respeitar o dia de cirurgia e o horário real de cada médico
--
-- Faltavam duas coisas que a Shosp não sabe:
--
-- 1. CIRURGIA NÃO ESTÁ NA SHOSP. O transplante é agendado no sistema do centro
--    cirúrgico (espelho `srg_*`), então a agenda da Shosp mostra a Dra. Lorena com
--    a manhã inteira livre num dia em que ela tem duas cirurgias marcadas. Cirurgia
--    finalizada tem mediana de 06:57 às 17:08: é o dia todo.
--
-- 2. CONSULTA NÃO É O DIA INTEIRO, e cada médico tem o seu turno. Olhando as
--    consultas de verdade desde jun/2025:
--      Dra. Lorena  → manhã. 09h(4) 10h(18) 11h(18) 12h(6) 13h(2), e só 4 à tarde.
--      Dr. Matheus  → tarde. 13h(2) 14h(5) 15h(6) 16h(2).
--      Dra. Jaqueline → tarde. 13h(1) 14h(3) 15h(3) 16h(3) 17h(2).
--    Em DIA DE CIRURGIA o padrão muda de novo: a Dra. Lorena atende no meio da
--    manhã (10h(12) 11h(8) 12h(8)) e o Dr. Matheus só no fim da tarde (15h,16h,17h).
--
-- Por isso cada profissional ganha duas janelas: a normal e a de dia de cirurgia
-- (nula = não atende quando opera). E um teto de consultas por dia, para um pico
-- de anúncio não encher a manhã da médica com seis avaliações.
--
-- Nada disso é chute meu: os números acima saíram de `shosp_appointments` cruzado
-- com `srg_surgeries`. Mas continua sendo POLÍTICA da casa, então vive em tabela e
-- muda pela tela, sem deploy.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clinic_booking_prestadores
  add column if not exists srg_medico_id int,
  add column if not exists hora_inicio time not null default time '08:00',
  add column if not exists hora_fim time not null default time '18:00',
  add column if not exists hora_inicio_cirurgia time,
  add column if not exists hora_fim_cirurgia time,
  add column if not exists max_por_dia int not null default 3;

comment on column public.clinic_booking_prestadores.srg_medico_id is
  'Id do médico no sistema do centro cirúrgico (srg_staff). É o elo que revela o dia de cirurgia, que a Shosp não conhece.';
comment on column public.clinic_booking_prestadores.hora_inicio_cirurgia is
  'Janela de consulta em dia de cirurgia. NULA = não atende quando opera.';
comment on column public.clinic_booking_prestadores.max_por_dia is
  'Teto de pré-agendamentos por dia para este profissional. Segura pico de anúncio.';

update public.clinic_booking_prestadores set
  srg_medico_id = 172,
  hora_inicio = time '09:00', hora_fim = time '14:00',
  hora_inicio_cirurgia = time '10:00', hora_fim_cirurgia = time '13:00'
where codigo_prestador = '2';

update public.clinic_booking_prestadores set
  srg_medico_id = 171,
  hora_inicio = time '13:00', hora_fim = time '18:00',
  hora_inicio_cirurgia = time '15:00', hora_fim_cirurgia = time '18:00'
where codigo_prestador = '5';

update public.clinic_booking_prestadores set
  srg_medico_id = 173,
  hora_inicio = time '13:00', hora_fim = time '18:00',
  hora_inicio_cirurgia = time '13:00', hora_fim_cirurgia = time '18:00'
where codigo_prestador = '8';

-- ── Agenda pública, agora com cirurgia e turno do médico ─────────────────────
drop function if exists public.clinica_agenda_publica(text, int, text);

create or replace function public.clinica_agenda_publica(
  p_unidade text default null,
  p_dias int default null,
  p_objetivo text default null
)
returns table (unidade_id text, slot_at timestamptz, codigo_prestador text, profissional text)
language sql
stable
security definer
set search_path = public
as $fn$
  with cfg as (
    select
      s.timezone as tz,
      s.lead_time_hours as lead_h,
      least(coalesce(p_dias, s.horizon_days), 60) as dias,
      s.active as ativo
    from public.clinic_booking_settings s
    where s.tenant_id = 'instituto-lorena'
  ),
  -- Dia em que o médico está no centro cirúrgico. AGUARDANDO conta: é cirurgia
  -- marcada, e é justamente essa que ainda pode receber consulta em cima.
  cirurgia as (
    select distinct s.dia, s.medico_id
    from public.srg_surgeries s
    where s.deleted_at is null
      and s.status in ('AGUARDANDO', 'EM_PROCESSO', 'FINALIZADA')
      and s.dia >= current_date - 1
  ),
  candidato as (
    select
      u.id as unidade_id,
      pr.codigo_prestador,
      pr.rotulo_publico,
      pr.sort_order,
      pr.max_por_dia,
      ((s.dia + s.horario::time) at time zone c.tz) as slot_at,
      s.dia,
      s.horario::time as hora,
      exists (
        select 1 from cirurgia cir
        where cir.dia = s.dia and cir.medico_id = pr.srg_medico_id
      ) as dia_de_cirurgia,
      pr.hora_inicio,
      pr.hora_fim,
      pr.hora_inicio_cirurgia,
      pr.hora_fim_cirurgia
    from public.shosp_agenda_slots s
    cross join cfg c
    join public.clinic_booking_units u
      on u.shosp_codigo_unidade = s.codigo_unidade
     and u.active
     and (p_unidade is null or u.id = p_unidade)
    join public.clinic_booking_prestadores pr
      on pr.unidade_id = u.id
     and pr.codigo_prestador = s.codigo_prestador
     and pr.active
     and (p_objetivo is null or p_objetivo = any (pr.objetivos))
    where s.dia between (now() at time zone c.tz)::date and (now() at time zone c.tz)::date + c.dias
  ),
  no_turno as (
    select k.*
    from candidato k
    where case
            when k.dia_de_cirurgia then
              k.hora_inicio_cirurgia is not null
              and k.hora >= k.hora_inicio_cirurgia
              and k.hora < k.hora_fim_cirurgia
            else
              k.hora >= k.hora_inicio and k.hora < k.hora_fim
          end
      -- Expediente geral da unidade (segunda a sexta, horário comercial).
      and exists (
        select 1
        from public.clinic_booking_windows w
        where w.tenant_id = 'instituto-lorena'
          and w.unidade_id = k.unidade_id
          and w.active
          and w.weekday = extract(dow from k.dia)
          and k.hora >= w.hora_inicio
          and k.hora < w.hora_fim
      )
      and not exists (
        select 1
        from public.clinic_booking_blackouts b
        where b.tenant_id = 'instituto-lorena'
          and b.dia = k.dia
          and (b.unidade_id is null or b.unidade_id = k.unidade_id)
      )
      -- Teto por médico por dia, contando o que a landing já reservou.
      and (
        select count(*)
        from public.clinic_prebookings p
        where p.tenant_id = 'instituto-lorena'
          and p.codigo_prestador = k.codigo_prestador
          and p.status in ('pendente', 'confirmado')
          and (p.slot_at at time zone (select tz from cfg))::date = k.dia
      ) < k.max_por_dia
  )
  select distinct on (k.unidade_id, k.slot_at)
    k.unidade_id, k.slot_at, k.codigo_prestador, k.rotulo_publico
  from no_turno k
  cross join cfg c
  where c.ativo
    and k.slot_at >= now() + make_interval(hours => c.lead_h)
    and not exists (
      select 1 from public.clinic_prebookings p
      where p.tenant_id = 'instituto-lorena'
        and p.unidade_id = k.unidade_id
        and p.slot_at = k.slot_at
        and coalesce(p.codigo_prestador, '') = k.codigo_prestador
        and p.status in ('pendente', 'confirmado')
    )
  order by k.unidade_id, k.slot_at, k.sort_order
$fn$;

comment on function public.clinica_agenda_publica(text, int, text) is
  'Horários da landing: livres na Shosp, dentro do turno de consulta do médico, respeitando dia de cirurgia, feriado, expediente e teto diário.';

revoke all on function public.clinica_agenda_publica(text, int, text) from public;
grant execute on function public.clinica_agenda_publica(text, int, text) to anon, authenticated;

-- Leitura do espelho da cirurgia pela função: `srg_surgeries` tem RLS, e a função
-- é SECURITY DEFINER, então roda como dono e enxerga. O anon continua sem acesso
-- direto à tabela: o que sai daqui é horário livre, nunca nome de paciente.
