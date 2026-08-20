-- ─────────────────────────────────────────────────────────────────────────────
-- Estimativa de unidades foliculares para a landing + feriados fechados
--
-- A calculadora do site (e a do app) é a maior isca de conversão da clínica. Aqui
-- ela vira UMA função: a landing usa para mostrar o número na hora, e a edge
-- function do pré-agendamento usa a MESMA função para gravar a estimativa junto
-- do lead. Sem isso, a conta viveria em dois lugares (front e servidor) e um dia
-- os dois discordariam sobre o que a clínica prometeu para o paciente.
--
-- A referência continua sendo `clinica_referencia_por_area()`: quartis das
-- cirurgias FINALIZADAS da casa, não tabela genérica de internet.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.clinica_estimativa_publica(p_escala text, p_grau text)
returns table (esperado int, minimo int, maximo int, amostra int, areas text[])
language sql
stable
security definer
set search_path = public
as $fn$
  with mapa(escala, grau, area, nivel) as (
    values
      -- Norwood (masculino). II e III ainda são entradas; da IV em diante entra coroa.
      ('norwood', '2',  'Hairline',           'leve'),
      ('norwood', '2',  'Recesso',            'leve'),
      ('norwood', '3',  'Hairline',           'leve'),
      ('norwood', '3',  'Entradas + topetes', 'leve'),
      ('norwood', '3v', 'Hairline',           'leve'),
      ('norwood', '3v', 'Entradas + topetes', 'leve'),
      ('norwood', '3v', 'Coroa',              'leve'),
      ('norwood', '4',  'Hairline',           'medio'),
      ('norwood', '4',  'Entradas + topetes', 'medio'),
      ('norwood', '4',  'Coroa',              'leve'),
      ('norwood', '5',  'Hairline',           'medio'),
      ('norwood', '5',  'Entradas + topetes', 'avancado'),
      ('norwood', '5',  'Coroa',              'medio'),
      ('norwood', '5',  'Escalpe Médio',      'leve'),
      ('norwood', '6',  'Hairline',           'avancado'),
      ('norwood', '6',  'Entradas + topetes', 'avancado'),
      ('norwood', '6',  'Coroa',              'avancado'),
      ('norwood', '6',  'Escalpe Médio',      'medio'),
      ('norwood', '7',  'Hairline',           'avancado'),
      ('norwood', '7',  'Entradas + topetes', 'avancado'),
      ('norwood', '7',  'Coroa',              'avancado'),
      ('norwood', '7',  'Escalpe Médio',      'avancado'),
      ('norwood', '7',  'Segunda área',       'medio'),
      -- Ludwig (feminino): a perda é difusa, começa por coroa e escalpe médio.
      ('ludwig',  '1',  'Coroa',              'leve'),
      ('ludwig',  '1',  'Escalpe Médio',      'leve'),
      ('ludwig',  '2',  'Coroa',              'medio'),
      ('ludwig',  '2',  'Escalpe Médio',      'medio'),
      ('ludwig',  '3',  'Coroa',              'avancado'),
      ('ludwig',  '3',  'Escalpe Médio',      'avancado'),
      ('ludwig',  '3',  'Segunda área',       'medio')
  ),
  ref as (select * from public.clinica_referencia_por_area())
  select
    coalesce(sum(case m.nivel when 'leve' then r.leve when 'medio' then r.medio else r.avancado end), 0)::int,
    coalesce(sum(r.leve), 0)::int,
    coalesce(sum(r.avancado), 0)::int,
    coalesce(max(r.cirurgias), 0)::int,
    coalesce(array_agg(m.area order by m.area), '{}')::text[]
  from mapa m
  join ref r on r.area = m.area
  where m.escala = lower(coalesce(p_escala, ''))
    and m.grau = lower(coalesce(p_grau, ''))
$fn$;

comment on function public.clinica_estimativa_publica(text, text) is
  'Estimativa de unidades foliculares por grau (Norwood/Ludwig), calculada sobre os quartis das cirurgias reais da casa.';

revoke all on function public.clinica_estimativa_publica(text, text) from public;
grant execute on function public.clinica_estimativa_publica(text, text) to anon, authenticated;

-- Feriados nacionais de data fixa até o começo de 2027. Só os fixos: Carnaval,
-- Sexta-feira Santa e Corpus Christi mudam de data todo ano e chutar aqui seria
-- fechar um dia útil sem motivo. A equipe fecha os outros pela tela.
insert into public.clinic_booking_blackouts (unidade_id, dia, motivo)
select null, d::date, m
from (values
  ('2026-09-07'::date, 'Independência'),
  ('2026-10-12'::date, 'Nossa Senhora Aparecida'),
  ('2026-11-02'::date, 'Finados'),
  ('2026-11-15'::date, 'Proclamação da República'),
  ('2026-11-20'::date, 'Consciência Negra'),
  ('2026-12-24'::date, 'Véspera de Natal'),
  ('2026-12-25'::date, 'Natal'),
  ('2026-12-31'::date, 'Véspera de Ano Novo'),
  ('2027-01-01'::date, 'Confraternização Universal')
) as f(d, m)
where not exists (
  select 1 from public.clinic_booking_blackouts b
  where b.dia = f.d and b.unidade_id is null
);
