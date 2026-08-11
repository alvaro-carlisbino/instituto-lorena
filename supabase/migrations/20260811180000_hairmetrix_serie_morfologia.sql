-- A série passa a devolver a morfologia por fio, que é a parte confiável da medida.
--
-- Levantamento de 11/08/2026 na área doadora — que não rala, logo o que ela varia
-- entre exames é erro de medida. Mediana da variação absoluta, mesmo aparelho:
--
--   % de fios finos ........  2,4 pp    proporção
--   comprimento médio ......  4,2%      por fio
--   espessura média ........  5,1%      por fio
--   espessura mediana ......  5,2%      por fio
--   % de fio terminal ......  5,5 pp    proporção
--   fios por UF ............  6,8%      razão entre duas contagens
--   espessura p10 .......... 10,8%      percentil extremo, amostra pequena
--   densidade fios/cm² ..... 13,8%      contagem ÷ área
--   massa capilar .......... 15,5%      contagem × calibre: multiplica os dois erros
--   razão com a doadora .... 23,2%      razão entre dois ruídos independentes
--
-- A regra que sai daí: TUDO QUE É POR FIO É ESTÁVEL, TUDO QUE ENVOLVE CONTAR DENTRO
-- DE UMA ÁREA HERDA O ERRO DE POSICIONAMENTO DO ROI (que sozinho já anda 5,1%).
--
-- Duas ideias boas morreram nessa conta e ficam registradas para ninguém tentar de
-- novo: a "massa capilar" (área transversal total de fio por cm², que é o número
-- que corresponde ao que a pessoa vê no espelho) e a "razão com a própria doadora"
-- (normalizar pelo teto genético do paciente). As duas são mais barulhentas do que
-- qualquer métrica isolada, porque compõem erros em vez de cancelá-los.
--
-- Faltavam aqui a mediana e o comprimento. Sem comprimento não dá para desenhar o
-- fio em escala; sem mediana não dá para separar o fio típico da média, que a cauda
-- grossa puxa para cima.

-- `create or replace` não muda o tipo de retorno: coluna nova em RETURNS TABLE
-- exige drop antes. Dentro da transação da migration, então a função nunca fica
-- ausente para quem está com a tela aberta.
drop function if exists public.hairmetrix_serie_paciente(uuid);

create function public.hairmetrix_serie_paciente(p_paciente_id uuid)
returns table(
  exame_id uuid, capture_id text, capturado_em timestamptz, regiao text, indice integer,
  dispositivo text, serial_dispositivo text, magnificacao integer,
  unidades_foliculares integer, fios_validos integer, fios_por_uf numeric,
  densidade_uf_cm2 numeric, densidade_fios_cm2 numeric,
  espessura_media_um numeric, espessura_p10_um numeric, pct_fios_finos numeric,
  espessura_hist jsonb, roi_area_mm2 numeric, score_medio numeric,
  espessura_mediana_um numeric, comprimento_medio_mm numeric,
  delta_densidade_pct numeric, delta_espessura_pct numeric, delta_finos_pp numeric,
  base_densidade_pct numeric, base_espessura_pct numeric, base_finos_pp numeric,
  dias_desde_base integer
)
language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select
      e.id as exame_id, e.capture_id, e.capturado_em, m.regiao, m.indice,
      e.dispositivo, e.serial_dispositivo, m.magnificacao,
      m.unidades_foliculares, m.fios_validos, m.fios_por_uf,
      m.densidade_uf_cm2, m.densidade_fios_cm2, m.espessura_media_um,
      case when m.px_por_mm > 0
           then round(m.espessura_p10_px / m.px_por_mm * 1000, 2) end as espessura_p10_um,
      m.pct_fios_finos, m.espessura_hist, m.roi_area_mm2, m.score_medio,
      case when m.px_por_mm > 0
           then round(m.espessura_mediana_px / m.px_por_mm * 1000, 2) end as espessura_mediana_um,
      -- comprimento em mm, não em µm: é o segmento visível do fio dentro do quadro,
      -- ordem de meio milímetro. "506 µm" é um número que ninguém lê.
      case when m.px_por_mm > 0
           then round(m.comprimento_medio_px / m.px_por_mm, 3) end as comprimento_medio_mm
    from public.hairmetrix_medidas m
    join public.hairmetrix_exames e     on e.id = m.exame_id
    join public.hairmetrix_pacientes p  on p.id = e.paciente_id
    where p.id = p_paciente_id
      and p.tenant_id = public.current_tenant_id()
  )
  select
    b.exame_id, b.capture_id, b.capturado_em, b.regiao, b.indice,
    b.dispositivo, b.serial_dispositivo, b.magnificacao,
    b.unidades_foliculares, b.fios_validos, b.fios_por_uf,
    b.densidade_uf_cm2, b.densidade_fios_cm2, b.espessura_media_um,
    b.espessura_p10_um, b.pct_fios_finos, b.espessura_hist, b.roi_area_mm2, b.score_medio,
    b.espessura_mediana_um, b.comprimento_medio_mm,
    case when lag(b.densidade_fios_cm2) over w > 0
         then round((b.densidade_fios_cm2 - lag(b.densidade_fios_cm2) over w)
                    * 100.0 / lag(b.densidade_fios_cm2) over w, 2) end,
    case when lag(b.espessura_media_um) over w > 0
         then round((b.espessura_media_um - lag(b.espessura_media_um) over w)
                    * 100.0 / lag(b.espessura_media_um) over w, 2) end,
    case when lag(b.pct_fios_finos) over w is not null
         then round(b.pct_fios_finos - lag(b.pct_fios_finos) over w, 2) end,
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
  window w as (partition by b.regiao order by b.capturado_em)
  order by b.regiao, b.capturado_em;
$function$;

comment on function public.hairmetrix_serie_paciente(uuid) is
  'Série tricoscópica completa por região. Inclui a morfologia por fio (mediana, comprimento), que é a parte confiável da medida.';

revoke all on function public.hairmetrix_serie_paciente(uuid) from public;
grant execute on function public.hairmetrix_serie_paciente(uuid) to authenticated;
