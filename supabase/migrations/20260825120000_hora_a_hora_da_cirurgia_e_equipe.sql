-- Hora a hora dentro da cirurgia, e o relatório de horas × folículos por implantador.
--
-- O PROBLEMA, na frase de quem pediu: "como eu sei que foi realmente uma hora, ou
-- se foi 40 minutos? Leonardo fez uma hora?". A tela de produção mostra a cirurgia
-- inteira e para aí. Dentro dela existem 2.076 blocos de hora, cada um com lado
-- (direita/esquerda/centro), implantador, auxiliares e folículos — e nenhuma tela
-- lia `srg_hours`. O relatório de horas da equipe só existia no PHP da sala.
--
-- O BURACO QUE ISSO DESTAMPOU: o espelho trazia `inicioD/E/C` e `dtFim`, mas NÃO
-- trazia `cirurgia_hora.dtCriacao` — que, apesar do nome, é o INÍCIO do bloco e é
-- digitável na tela da sala ("salvar hora início"). É a ponta que o relatório do
-- PHP usa: duração = TIMESTAMPDIFF(dtCriacao, dtFim).
--
-- `inicioD/E/C` NÃO serve para duração. As três colunas vêm sempre com o mesmo
-- valor e são o carimbo de quando a LINHA foi salva: nos blocos de implante, que a
-- equipe preenche no fim do dia, o "início" cai depois do fim (na cirurgia #364 o
-- bloco da hora 1 tem início 17:02 e fim 14:04). Média dessas janelas dá −216 min.
-- Por isso a coluna nova, e por isso a de trás não é usada em conta nenhuma aqui.
--
-- DECISÕES DE CONTAGEM (é o que faz o número aguentar uma conversa de pagamento):
--
--   • Bloco sem `inicio` gravado usa o FIM DO BLOCO ANTERIOR do mesmo lado como
--     início — os blocos formam corrente, e é assim que as datas erradas de junho
--     foram deduzidas em 03/ago. Mas a tela mostra qual início é `registrado` e
--     qual é `encadeado`: número deduzido que se apresenta como medido é pior que
--     número faltando. O primeiro bloco de cada lado não tem corrente e fica sem
--     duração até o sync trazer `dtCriacao`.
--   • Duração fora de 0 a 12 h é DESCARTADA, não corrigida. É o mesmo teto que a
--     trava do PHP usa desde 03/ago/2026, e ele veio do banco: 95% dos blocos com
--     duração válida duram exatamente 1 h, o maior legítimo tem 1,5 h, e não existe
--     nada entre 1,5 h e 25 h. O que sobra é dia digitado errado.
--   • Folículo por hora só conta bloco que tem duração válida, e a quantidade de
--     blocos que entrou na conta (`base_horas`) sai junto do número. Sem isso o
--     fol/h de quem tem 2 blocos cronometrados de 12 vira "a produtividade dela".
--   • O implantador é lido da coluna do LADO quando ela existe, senão de
--     `implantador_d`. O sistema da sala grava quase todo mundo em `implantadorD`,
--     mesmo nas horas de lado E e C (2.029 dos 2.076 blocos).

-- ---------------------------------------------------------------------------
-- 1) A ponta que faltava no espelho
-- ---------------------------------------------------------------------------

alter table public.srg_hours add column if not exists inicio timestamptz;

comment on column public.srg_hours.inicio is
  'cirurgia_hora.dtCriacao no MySQL. Apesar do nome na origem, NÃO é "criado em": é o início do bloco de hora, digitável na tela da sala, e é a ponta que o relatório de horas usa. Preenchido pelo crm-cirurgia-sync.';

comment on column public.srg_hours.inicio_d is
  'cirurgia_hora.inicioD. Carimbo de quando a LINHA foi salva, não o início do bloco — vem igual em inicio_d/e/c e nos blocos de implante cai depois do fim. Não usar para duração; use `inicio`.';

-- ---------------------------------------------------------------------------
-- 2) Detalhe de uma cirurgia: etapa por etapa e bloco por bloco
-- ---------------------------------------------------------------------------

create or replace function public.crm_cirurgia_horas(p_surgery_id int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_resposta jsonb;
begin
  -- Guarda antes da conta: SECURITY DEFINER passa por cima da RLS das srg_*.
  if coalesce((select t.polo_type from public.tenants t where t.id = public.current_tenant_id()), '') <> 'clinic' then
    raise exception 'O detalhe da cirurgia é da clínica. Troque de polo para ver esta tela.'
      using errcode = '42501';
  end if;
  if not (public.can_route_leads() or public.current_user_can_finance()) then
    raise exception 'Sem permissão para ver o detalhe da cirurgia.'
      using errcode = '42501';
  end if;

  with cir as (
    select s.*
    from public.srg_surgeries s
    where s.id = p_surgery_id
      and s.deleted_at is null
      and s.tenant_id = public.current_tenant_id()
  ),
  -- Blocos de implante normalizados: lado, quem estava, e a janela real.
  bruto as (
    select h.id,
           h.hora,
           h.tipo,
           case h.tipo when 'IMPLANTACAOD' then 'DIREITA'
                       when 'IMPLANTACAOE' then 'ESQUERDA'
                       when 'IMPLANTACAOC' then 'CENTRO' end as lado,
           coalesce(case h.tipo when 'IMPLANTACAOE' then h.implantador_e
                                when 'IMPLANTACAOC' then h.implantador_c end,
                    h.implantador_d) as implantador_id,
           coalesce(case h.tipo when 'IMPLANTACAOE' then h.auxiliar_e
                                when 'IMPLANTACAOC' then h.auxiliar_c end,
                    h.auxiliar_d) as auxiliar_id,
           coalesce(case h.tipo when 'IMPLANTACAOE' then h.auxiliar_e2
                                when 'IMPLANTACAOC' then h.auxiliar_c2 end,
                    h.auxiliar_d2) as auxiliar2_id,
           h.inicio,
           h.dt_fim,
           -- A corrente: o fim de um bloco é o início do seguinte, no mesmo lado.
           lag(h.dt_fim) over (partition by h.tipo order by h.hora, h.id) as fim_anterior
    from public.srg_hours h
    join cir c on c.id = h.surgery_id
    where h.deleted_at is null
      and h.tipo like 'IMPLANTACAO%'
  ),
  janela as (
    select b.*,
           coalesce(b.inicio, b.fim_anterior) as ini,
           case when b.inicio is not null      then 'registrado'
                when b.fim_anterior is not null then 'encadeado' end as fonte_inicio
    from bruto b
  ),
  blocos as (
    select j.*,
           d.bruta_min,
           -- Fora de 0..12h é data digitada errada, não bloco de 25 horas.
           case when d.bruta_min > 0 and d.bruta_min <= 720 then d.bruta_min end as duracao_min,
           coalesce(f.fol, 0) as foliculos
    from janela j
    left join lateral (
      select extract(epoch from (j.dt_fim - j.ini)) / 60.0 as bruta_min
    ) d on true
    left join lateral (
      select sum(i.quantidade) as fol
      from public.srg_follicles_implanted i
      where i.hour_id = j.id and i.deleted_at is null
    ) f on true
  )
  select jsonb_build_object(
    'cirurgia', (
      select jsonb_build_object(
        'id',                 c.id,
        'paciente',           coalesce(nullif(c.paciente_nome, ''), 'Sem nome'),
        'prontuario',         c.shosp_prontuario,
        'lead_id',            c.lead_id,
        'dia',                c.dia,
        'status',             c.status,
        'sala',               c.sala,
        'idade',              c.idade,
        'meta',               nullif(c.meta, 0),
        'medico',             (select m.nome from public.srg_staff m where m.id = c.medico_id),
        'anestesista',        (select a.nome from public.srg_staff a where a.id = c.anestesista_id),
        'hora_inicio',        c.hora_inicio,
        'dt_fim',             c.dt_fim,
        'total_extraidos',    c.total_extraidos,
        'total_implantados',  c.total_implantados,
        'synced_at',          c.synced_at
      ) from cir c),

    -- Etapas cronometradas: é daqui que sai "o implante durou 4 h 35".
    'etapas', (
      select coalesce(jsonb_agg(x order by (x->>'inicio')), '[]'::jsonb) from (
        select jsonb_build_object(
          'etapa',       g.etapa,
          'inicio',      min(g.horario) filter (where g.tipo = 'INICIO'),
          'fim',         max(g.horario) filter (where g.tipo = 'CONCLUIDO'),
          'duracao_min', round(extract(epoch from (max(g.horario) filter (where g.tipo = 'CONCLUIDO')
                                                 - min(g.horario) filter (where g.tipo = 'INICIO'))) / 60.0)
        ) as x
        from public.srg_stages g
        join cir c on c.id = g.surgery_id
        where g.deleted_at is null and g.horario is not null
        group by g.etapa
      ) e),

    'blocos', (
      select coalesce(jsonb_agg(x order by (x->>'hora')::int, (x->>'lado')), '[]'::jsonb) from (
        select jsonb_build_object(
          'id',            b.id,
          'hora',          b.hora,
          'lado',          b.lado,
          'implantador',   (select p.nome from public.srg_staff p where p.id = b.implantador_id),
          'auxiliares',    (select coalesce(jsonb_agg(p.nome order by p.nome), '[]'::jsonb)
                              from public.srg_staff p
                             where p.id in (b.auxiliar_id, b.auxiliar2_id)),
          'inicio',        b.ini,
          'fim',           b.dt_fim,
          'fonte_inicio',  b.fonte_inicio,
          'duracao_min',   round(b.duracao_min),
          'duracao_suspeita_min', case when b.bruta_min is not null and b.duracao_min is null
                                       then round(b.bruta_min) end,
          'foliculos',     b.foliculos,
          'foliculos_hora', case when b.duracao_min >= 1
                                 then round(b.foliculos * 60.0 / b.duracao_min) end
        ) as x
        from blocos b
      ) t),

    -- Quanto cada pessoa fez NESTA cirurgia. É a linha que a gerente lê em voz alta.
    'por_pessoa', (
      select coalesce(jsonb_agg(x order by (x->>'foliculos')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'implantador',   coalesce(p.nome, 'Sem implantador'),
          'blocos',        count(*),
          'blocos_com_duracao', count(b.duracao_min),
          'minutos',       round(coalesce(sum(b.duracao_min), 0)),
          'foliculos',     coalesce(sum(b.foliculos), 0),
          'lados',         string_agg(distinct b.lado, '/' order by b.lado),
          -- Só sobre os blocos cronometrados; `base_horas` diz quantos são.
          'foliculos_hora', case when sum(b.duracao_min) >= 1
                                 then round(sum(b.foliculos) filter (where b.duracao_min is not null)
                                            * 60.0 / sum(b.duracao_min)) end,
          'base_horas',    count(b.duracao_min)
        ) as x
        from blocos b
        left join public.srg_staff p on p.id = b.implantador_id
        group by p.nome
      ) pp),

    'qualidade', (
      select jsonb_build_object(
        'blocos',              count(*),
        'sem_inicio',          count(*) filter (where b.ini is null),
        'inicio_encadeado',    count(*) filter (where b.fonte_inicio = 'encadeado'),
        'sem_fim',             count(*) filter (where b.dt_fim is null),
        'duracao_suspeita',    count(*) filter (where b.bruta_min is not null and b.duracao_min is null),
        'sem_implantador',     count(*) filter (where b.implantador_id is null)
      ) from blocos b)
  ) into v_resposta;

  return v_resposta;
end;
$fn$;

revoke all on function public.crm_cirurgia_horas(int) from public, anon;
grant execute on function public.crm_cirurgia_horas(int) to authenticated, service_role;

comment on function public.crm_cirurgia_horas(int) is
  'Detalhe de uma cirurgia: etapas cronometradas com duração, e os blocos de hora do implante (lado, implantador, auxiliares, início real, fim, duração, folículos, fol/h). Início vem de srg_hours.inicio; quando falta, é encadeado do fim do bloco anterior e a resposta diz qual é qual.';

-- ---------------------------------------------------------------------------
-- 3) Horas × folículos por implantador no período
-- ---------------------------------------------------------------------------
--
-- A meta de 550 fol/h é a mesma do painel do PHP, onde ela é HARDCODED em
-- Ajax.php e o deploy sai por FTP na mão. Aqui ela é parâmetro: mudar a meta na
-- tela não pode depender de subir arquivo em servidor.

create or replace function public.crm_cirurgia_equipe(p_de date, p_ate date, p_meta int default 550)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_resposta jsonb;
begin
  if coalesce((select t.polo_type from public.tenants t where t.id = public.current_tenant_id()), '') <> 'clinic' then
    raise exception 'O relatório da equipe da sala é da clínica. Troque de polo para ver esta tela.'
      using errcode = '42501';
  end if;
  if not (public.can_route_leads() or public.current_user_can_finance()) then
    raise exception 'Sem permissão para ver o relatório da equipe da sala.'
      using errcode = '42501';
  end if;

  with bruto as (
    select h.id,
           h.surgery_id,
           s.dia,
           h.hora,
           h.tipo,
           case h.tipo when 'IMPLANTACAOD' then 'DIREITA'
                       when 'IMPLANTACAOE' then 'ESQUERDA'
                       when 'IMPLANTACAOC' then 'CENTRO' end as lado,
           coalesce(case h.tipo when 'IMPLANTACAOE' then h.implantador_e
                                when 'IMPLANTACAOC' then h.implantador_c end,
                    h.implantador_d) as implantador_id,
           h.inicio,
           h.dt_fim,
           lag(h.dt_fim) over (partition by h.surgery_id, h.tipo order by h.hora, h.id) as fim_anterior
    from public.srg_hours h
    join public.srg_surgeries s on s.id = h.surgery_id
    where h.deleted_at is null
      and s.deleted_at is null
      and h.tipo like 'IMPLANTACAO%'
      and s.dia between p_de and p_ate
      and s.tenant_id = public.current_tenant_id()
  ),
  blocos as (
    select b.*,
           coalesce(b.inicio, b.fim_anterior) as ini,
           case when b.inicio is not null       then 'registrado'
                when b.fim_anterior is not null then 'encadeado' end as fonte_inicio,
           d.bruta_min,
           case when d.bruta_min > 0 and d.bruta_min <= 720 then d.bruta_min end as duracao_min,
           coalesce(f.fol, 0) as foliculos
    from bruto b
    left join lateral (
      select extract(epoch from (b.dt_fim - coalesce(b.inicio, b.fim_anterior))) / 60.0 as bruta_min
    ) d on true
    left join lateral (
      select sum(i.quantidade) as fol
      from public.srg_follicles_implanted i
      where i.hour_id = b.id and i.deleted_at is null
    ) f on true
  )
  select jsonb_build_object(
    'range', jsonb_build_object('de', p_de, 'ate', p_ate, 'meta', p_meta),

    'resumo', (
      select jsonb_build_object(
        'pessoas',        count(distinct b.implantador_id),
        'cirurgias',      count(distinct b.surgery_id),
        'blocos',         count(*),
        'blocos_com_duracao', count(b.duracao_min),
        'horas',          round((coalesce(sum(b.duracao_min), 0) / 60.0)::numeric, 1),
        'foliculos',      coalesce(sum(b.foliculos), 0),
        'foliculos_hora', case when sum(b.duracao_min) >= 1
                               then round(sum(b.foliculos) filter (where b.duracao_min is not null)
                                          * 60.0 / sum(b.duracao_min)) end
      ) from blocos b),

    'por_pessoa', (
      select coalesce(jsonb_agg(x order by (x->>'foliculos')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'implantador_id', b.implantador_id,
          'implantador',    coalesce(p.nome, 'Sem implantador'),
          'cirurgias',      count(distinct b.surgery_id),
          'blocos',         count(*),
          -- A honestidade da linha: quantos blocos têm as duas pontas do relógio.
          'base_horas',     count(b.duracao_min),
          'horas',          round((coalesce(sum(b.duracao_min), 0) / 60.0)::numeric, 1),
          'foliculos',      coalesce(sum(b.foliculos), 0),
          'foliculos_bloco', round(avg(b.foliculos)),
          'foliculos_hora', case when sum(b.duracao_min) >= 1
                                 then round(sum(b.foliculos) filter (where b.duracao_min is not null)
                                            * 60.0 / sum(b.duracao_min)) end,
          'pct_meta',       case when sum(b.duracao_min) >= 1 and p_meta > 0
                                 then round(100.0 * sum(b.foliculos) filter (where b.duracao_min is not null)
                                            * 60.0 / sum(b.duracao_min) / p_meta) end,
          'lados',          string_agg(distinct b.lado, '/' order by b.lado)
        ) as x
        from blocos b
        left join public.srg_staff p on p.id = b.implantador_id
        group by b.implantador_id, p.nome
      ) pp),

    -- A lista que dá o clique para o detalhe hora a hora.
    'por_cirurgia', (
      select coalesce(jsonb_agg(x order by (x->>'dia') desc, (x->>'surgery_id')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'surgery_id',   b.surgery_id,
          'dia',          b.dia,
          'paciente',     coalesce(nullif(s.paciente_nome, ''), 'Sem nome'),
          'status',       s.status,
          'meta',         nullif(s.meta, 0),
          'blocos',       count(*),
          'base_horas',   count(b.duracao_min),
          'horas',        round((coalesce(sum(b.duracao_min), 0) / 60.0)::numeric, 1),
          'foliculos',    coalesce(sum(b.foliculos), 0),
          'implantadores',(select string_agg(distinct coalesce(q.nome, '?'), ', ' order by coalesce(q.nome, '?'))
                             from public.srg_hours h2
                             left join public.srg_staff q
                               on q.id = coalesce(case h2.tipo when 'IMPLANTACAOE' then h2.implantador_e
                                                               when 'IMPLANTACAOC' then h2.implantador_c end,
                                                  h2.implantador_d)
                            where h2.surgery_id = b.surgery_id
                              and h2.deleted_at is null
                              and h2.tipo like 'IMPLANTACAO%')
        ) as x
        from blocos b
        join public.srg_surgeries s on s.id = b.surgery_id
        group by b.surgery_id, b.dia, s.paciente_nome, s.status, s.meta
      ) cc),

    'qualidade', (
      select jsonb_build_object(
        'blocos',           count(*),
        'sem_inicio',       count(*) filter (where b.ini is null),
        'inicio_encadeado', count(*) filter (where b.fonte_inicio = 'encadeado'),
        'sem_fim',          count(*) filter (where b.dt_fim is null),
        'duracao_suspeita', count(*) filter (where b.bruta_min is not null and b.duracao_min is null),
        'sem_implantador',  count(*) filter (where b.implantador_id is null),
        'ultimo_sync',      (select max(synced_at) from public.srg_hours)
      ) from blocos b)
  ) into v_resposta;

  return v_resposta;
end;
$fn$;

revoke all on function public.crm_cirurgia_equipe(date, date, int) from public, anon;
grant execute on function public.crm_cirurgia_equipe(date, date, int) to authenticated, service_role;

comment on function public.crm_cirurgia_equipe(date, date, int) is
  'Horas e folículos por implantador no período, contra a meta de folículos/hora (550 no painel do PHP, aqui parâmetro). Só bloco com as duas pontas do relógio entra na conta de fol/h; base_horas diz quantos são.';
