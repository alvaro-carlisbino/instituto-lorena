-- Laudo de evolução tricoscópica: a tela que o médico abre com o paciente do lado.
--
-- O agente já grava muito mais do que a tela mostrava. `hairmetrix_evolucao_paciente`
-- devolvia 11 colunas; as medidas têm 25. Ficavam de fora justamente as que explicam
-- o número para o paciente:
--
--   espessura_hist      distribuição de espessura em faixas — é o gráfico que mostra
--                       fio fino virando fio grosso, que é o que o tratamento faz
--   espessura_p10_px    a cauda fina: miniaturização aparece aqui antes da média
--   densidade_uf_cm2    unidade folicular por cm² (a média só de fios esconde se o
--                       ganho veio de fio novo ou de fio que engrossou)
--   serial_dispositivo  a clínica tem DOIS VISIOMED (6575 e 9906) e 605 pacientes
--                       têm série que atravessa os dois. Sem mostrar isso, uma troca
--                       de aparelho vira "o tratamento piorou".
--   roi_area_mm2        área realmente analisada; se cair pela metade entre exames,
--                       a densidade não é comparável
--
-- E faltava o delta que importa na consulta. O delta contra o exame anterior responde
-- "melhorou desde a última vez?"; quem senta na cadeira quer saber "melhorou desde que
-- eu comecei?". Os dois saem daqui, sempre DENTRO DA MESMA REGIÃO.


-- ---------------------------------------------------------------------------
-- 1. SÉRIE COMPLETA DO PACIENTE
-- ---------------------------------------------------------------------------
-- Uma linha por (exame, região). O cliente agrupa por região e desenha; a conta de
-- variação fica aqui porque janela em SQL não erra de ordenação, e o `partition by
-- regiao` é a garantia de que vertex nunca é comparado com occipital.
--
-- p10 sai em µm, não em pixel. Pixel só significa alguma coisa junto da calibração,
-- e ninguém vai mostrar "6,08 px" para o paciente.

create or replace function public.hairmetrix_serie_paciente(p_paciente_id uuid)
returns table(
  exame_id uuid,
  capture_id text,
  capturado_em timestamptz,
  regiao text,
  indice integer,
  dispositivo text,
  serial_dispositivo text,
  magnificacao integer,
  unidades_foliculares integer,
  fios_validos integer,
  fios_por_uf numeric,
  densidade_uf_cm2 numeric,
  densidade_fios_cm2 numeric,
  espessura_media_um numeric,
  espessura_p10_um numeric,
  pct_fios_finos numeric,
  espessura_hist jsonb,
  roi_area_mm2 numeric,
  score_medio numeric,
  delta_densidade_pct numeric,
  delta_espessura_pct numeric,
  delta_finos_pp numeric,
  base_densidade_pct numeric,
  base_espessura_pct numeric,
  base_finos_pp numeric,
  dias_desde_base integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select
      e.id            as exame_id,
      e.capture_id,
      e.capturado_em,
      m.regiao,
      m.indice,
      e.dispositivo,
      e.serial_dispositivo,
      m.magnificacao,
      m.unidades_foliculares,
      m.fios_validos,
      m.fios_por_uf,
      m.densidade_uf_cm2,
      m.densidade_fios_cm2,
      m.espessura_media_um,
      -- px -> µm: p10_px / (px por mm) * 1000. Sem calibração não há µm, e é melhor
      -- devolver nulo do que um número que parece medida e não é.
      case when m.px_por_mm > 0
           then round(m.espessura_p10_px / m.px_por_mm * 1000, 2) end as espessura_p10_um,
      m.pct_fios_finos,
      m.espessura_hist,
      m.roi_area_mm2,
      m.score_medio
    from public.hairmetrix_medidas m
    join public.hairmetrix_exames e     on e.id = m.exame_id
    join public.hairmetrix_pacientes p  on p.id = e.paciente_id
    where p.id = p_paciente_id
      and p.tenant_id = public.current_tenant_id()
  )
  select
    b.exame_id,
    b.capture_id,
    b.capturado_em,
    b.regiao,
    b.indice,
    b.dispositivo,
    b.serial_dispositivo,
    b.magnificacao,
    b.unidades_foliculares,
    b.fios_validos,
    b.fios_por_uf,
    b.densidade_uf_cm2,
    b.densidade_fios_cm2,
    b.espessura_media_um,
    b.espessura_p10_um,
    b.pct_fios_finos,
    b.espessura_hist,
    b.roi_area_mm2,
    b.score_medio,

    -- contra o exame anterior da mesma região: "mudou desde a última vez?"
    case when lag(b.densidade_fios_cm2) over w > 0
         then round((b.densidade_fios_cm2 - lag(b.densidade_fios_cm2) over w)
                    * 100.0 / lag(b.densidade_fios_cm2) over w, 2) end,
    case when lag(b.espessura_media_um) over w > 0
         then round((b.espessura_media_um - lag(b.espessura_media_um) over w)
                    * 100.0 / lag(b.espessura_media_um) over w, 2) end,
    -- miniaturização já é percentual: a variação dele é em ponto percentual, não em
    -- "% de %". Sair de 40% para 30% é -10 pp, e é assim que se fala na consulta.
    case when lag(b.pct_fios_finos) over w is not null
         then round(b.pct_fios_finos - lag(b.pct_fios_finos) over w, 2) end,

    -- contra o primeiro exame da mesma região: "melhorou desde que eu comecei?"
    case when first_value(b.densidade_fios_cm2) over w > 0
         then round((b.densidade_fios_cm2 - first_value(b.densidade_fios_cm2) over w)
                    * 100.0 / first_value(b.densidade_fios_cm2) over w, 2) end,
    case when first_value(b.espessura_media_um) over w > 0
         then round((b.espessura_media_um - first_value(b.espessura_media_um) over w)
                    * 100.0 / first_value(b.espessura_media_um) over w, 2) end,
    case when first_value(b.pct_fios_finos) over w is not null
         then round(b.pct_fios_finos - first_value(b.pct_fios_finos) over w, 2) end,

    (b.capturado_em::date - (first_value(b.capturado_em) over w)::date)::integer
  from base b
  -- frame padrão (unbounded preceding .. current row): first_value = primeiro da região,
  -- lag = anterior da região. Trocar o frame aqui muda silenciosamente o significado.
  window w as (partition by b.regiao order by b.capturado_em)
  order by b.regiao, b.capturado_em;
$function$;

comment on function public.hairmetrix_serie_paciente(uuid) is
  'Série tricoscópica completa por região, com delta contra o exame anterior E contra o primeiro. Base do laudo de evolução.';

revoke all on function public.hairmetrix_serie_paciente(uuid) from public;
grant execute on function public.hairmetrix_serie_paciente(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. CABEÇALHO DO PACIENTE
-- ---------------------------------------------------------------------------
-- A tela de laudo abre por URL direta (o médico manda o link para si mesmo, volta
-- nela depois da consulta). Sem esta função ela dependeria de ter passado antes pela
-- listagem, e recarregar a página mostraria um laudo sem nome em cima.
--
-- O nome do CRM só vem quando existe vínculo. Sem vínculo, o único identificador é a
-- pasta do Mirror — e é assim que tem que aparecer, sem inventar um paciente.

create or replace function public.hairmetrix_paciente_cabecalho(p_paciente_id uuid)
returns table(
  id uuid,
  mirror_patient_id text,
  nome_pasta text,
  total_exames integer,
  primeiro_exame_em timestamptz,
  ultimo_exame_em timestamptz,
  vinculo_status text,
  lead_id text,
  lead_nome text,
  lead_telefone text,
  shosp_prontuario text,
  aparelhos integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.id,
    p.mirror_patient_id,
    p.nome_pasta,
    p.total_exames,
    p.primeiro_exame_em,
    p.ultimo_exame_em,
    p.vinculo_status,
    p.lead_id,
    l.patient_name,
    l.phone,
    l.shosp_prontuario,
    (select count(distinct e.serial_dispositivo)::integer
       from public.hairmetrix_exames e
      where e.paciente_id = p.id
        and e.serial_dispositivo is not null)
  from public.hairmetrix_pacientes p
  left join public.leads l
    on l.id = p.lead_id
   and l.tenant_id = p.tenant_id
   and l.deleted_at is null
  where p.id = p_paciente_id
    and p.tenant_id = public.current_tenant_id();
$function$;

comment on function public.hairmetrix_paciente_cabecalho(uuid) is
  'Identificação do paciente do Mirror + o lead vinculado, se houver. `aparelhos` > 1 avisa que a série atravessa troca de VISIOMED.';

revoke all on function public.hairmetrix_paciente_cabecalho(uuid) from public;
grant execute on function public.hairmetrix_paciente_cabecalho(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. PANORAMA DA BASE
-- ---------------------------------------------------------------------------
-- A listagem mostrava 4 contadores e nada sobre o acervo. São 5 anos de exame
-- (set/2021 em diante) e 1.352 pacientes com dois ou mais — esse é o número que diz
-- quanta evolução existe para olhar, e era invisível.
--
-- Sem argumento e sem parâmetro: é resumo do tenant inteiro, cabe em índice.

create or replace function public.hairmetrix_panorama()
returns table(
  pacientes integer,
  com_evolucao integer,
  vinculados integer,
  pendentes integer,
  exames integer,
  medidas integer,
  primeiro_exame_em timestamptz,
  ultimo_exame_em timestamptz,
  ultima_sync_em timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    (select count(*)::integer from public.hairmetrix_pacientes p
      where p.tenant_id = public.current_tenant_id() and p.total_exames > 0),
    (select count(*)::integer from public.hairmetrix_pacientes p
      where p.tenant_id = public.current_tenant_id() and p.total_exames > 1),
    (select count(*)::integer from public.hairmetrix_pacientes p
      where p.tenant_id = public.current_tenant_id() and p.vinculo_status = 'vinculado'),
    (select count(*)::integer from public.hairmetrix_pacientes p
      where p.tenant_id = public.current_tenant_id()
        and p.vinculo_status = 'pendente' and p.total_exames > 0),
    (select count(*)::integer from public.hairmetrix_exames e
      where e.tenant_id = public.current_tenant_id()),
    (select count(*)::integer from public.hairmetrix_medidas m
      where m.tenant_id = public.current_tenant_id()),
    (select min(e.capturado_em) from public.hairmetrix_exames e
      where e.tenant_id = public.current_tenant_id()),
    (select max(e.capturado_em) from public.hairmetrix_exames e
      where e.tenant_id = public.current_tenant_id()),
    (select max(s.finalizado_em) from public.hairmetrix_sync_log s
      where s.tenant_id = public.current_tenant_id());
$function$;

comment on function public.hairmetrix_panorama() is
  'Contadores do acervo de tricoscopia do tenant, inclusive quantos pacientes têm série (2+ exames).';

revoke all on function public.hairmetrix_panorama() from public;
grant execute on function public.hairmetrix_panorama() to authenticated;
