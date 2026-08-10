-- O que a tela de tricoscopia precisa e a migration do espelho não entregou.
--
-- 1) Evolução pelo paciente DO MIRROR, não pelo lead. Sem isso, 2.985 pacientes
--    ficariam invisíveis até alguém casar cada um com um lead do CRM: o exame
--    existe antes do vínculo, e é olhando o exame que a pessoa descobre quem é.
-- 2) Sugestão de lead para o vínculo. O Mirror guarda "SOBRENOME, NOME" e o CRM
--    guarda "NOME SOBRENOME", então comparar string direto nunca casa. O
--    casamento é por conjunto de palavras.
--
-- Nada aqui grava vínculo automático. Em prontuário de saúde, casar por
-- semelhança é mostrar o exame de um paciente para outro. A máquina ordena os
-- candidatos, quem decide é gente — mesma regra do vínculo de cirurgia.

-- Espelho do normalizarNome() do agente (hairmetrix-sync/index.ts): minúsculo,
-- sem acento, só letra e número. Mexeu num, mexe no outro.
create or replace function public.hairmetrix_normalizar(p_texto text)
returns text
language sql
immutable
as $function$
  select trim(regexp_replace(
    regexp_replace(
      lower(translate(
        coalesce(p_texto, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )),
      '[^a-z0-9 ]', ' ', 'g'),
    '\s+', ' ', 'g'));
$function$;

comment on function public.hairmetrix_normalizar(text) is
  'Normaliza nome para matching. Espelho de normalizarNome() na edge function.';


-- ---------------------------------------------------------------------------
-- Evolução por paciente do Mirror
-- ---------------------------------------------------------------------------
create or replace function public.hairmetrix_evolucao_paciente(
  p_paciente_id uuid,
  p_regiao text default null
)
returns table(
  capturado_em timestamptz,
  capture_id text,
  regiao text,
  unidades_foliculares integer,
  fios_validos integer,
  fios_por_uf numeric,
  densidade_fios_cm2 numeric,
  espessura_media_um numeric,
  pct_fios_finos numeric,
  delta_densidade_pct numeric,
  delta_espessura_pct numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select
      e.capturado_em, e.capture_id, m.regiao,
      m.unidades_foliculares, m.fios_validos, m.fios_por_uf,
      m.densidade_fios_cm2, m.espessura_media_um, m.pct_fios_finos
    from public.hairmetrix_medidas m
    join public.hairmetrix_exames e    on e.id = m.exame_id
    join public.hairmetrix_pacientes p on p.id = e.paciente_id
    where p.id = p_paciente_id
      and p.tenant_id = public.current_tenant_id()
      and (p_regiao is null or m.regiao = p_regiao)
  )
  select
    b.capturado_em, b.capture_id, b.regiao,
    b.unidades_foliculares, b.fios_validos, b.fios_por_uf,
    b.densidade_fios_cm2, b.espessura_media_um, b.pct_fios_finos,
    case when lag(b.densidade_fios_cm2) over w > 0
         then round((b.densidade_fios_cm2 - lag(b.densidade_fios_cm2) over w)
                    * 100.0 / lag(b.densidade_fios_cm2) over w, 2) end,
    case when lag(b.espessura_media_um) over w > 0
         then round((b.espessura_media_um - lag(b.espessura_media_um) over w)
                    * 100.0 / lag(b.espessura_media_um) over w, 2) end
  from base b
  window w as (partition by b.regiao order by b.capturado_em)
  order by b.regiao, b.capturado_em;
$function$;

comment on function public.hairmetrix_evolucao_paciente(uuid, text) is
  'Evolução por região da pasta do Mirror, funcione ou não o vínculo com o lead.';

revoke all on function public.hairmetrix_evolucao_paciente(uuid, text) from public;
grant execute on function public.hairmetrix_evolucao_paciente(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Sugestão de lead para o vínculo
-- ---------------------------------------------------------------------------
-- Score = quantas palavras do nome do Mirror aparecem no nome do lead, sobre o
-- total de palavras. Palavra com menos de 3 letras é ignorada ("de", "da", "e"),
-- senão "Maria de Souza" casa com meio mundo.

create or replace function public.hairmetrix_sugerir_leads(
  p_paciente_id uuid,
  p_limit integer default 8
)
returns table(
  lead_id text,
  patient_name text,
  phone text,
  shosp_prontuario text,
  score integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with alvo as (
    select public.hairmetrix_normalizar(p.nome_pasta) as nome
    from public.hairmetrix_pacientes p
    where p.id = p_paciente_id
      and p.tenant_id = public.current_tenant_id()
  ),
  palavras as (
    select t as palavra
    from alvo, unnest(string_to_array((select nome from alvo), ' ')) as t
    where length(t) >= 3
  ),
  candidatos as (
    select l.id, l.patient_name, l.phone, l.shosp_prontuario,
           public.hairmetrix_normalizar(l.patient_name) as nome_norm
    from public.leads l
    where l.tenant_id = public.current_tenant_id()
      and l.deleted_at is null
      and l.patient_name is not null
      -- pré-filtro pela palavra mais longa: evita pontuar a base inteira
      and public.hairmetrix_normalizar(l.patient_name) like
          '%' || (select palavra from palavras order by length(palavra) desc limit 1) || '%'
  )
  select c.id, c.patient_name, c.phone, c.shosp_prontuario,
         (100 * (select count(*) from palavras w
                  where c.nome_norm like '%' || w.palavra || '%')
              / greatest((select count(*) from palavras), 1))::integer as score
  from candidatos c
  order by score desc, length(c.patient_name)
  limit greatest(coalesce(p_limit, 8), 1);
$function$;

comment on function public.hairmetrix_sugerir_leads(uuid, integer) is
  'Candidatos a vínculo por conjunto de palavras. Ordena, não decide: quem casa é gente.';

revoke all on function public.hairmetrix_sugerir_leads(uuid, integer) from public;
grant execute on function public.hairmetrix_sugerir_leads(uuid, integer) to authenticated;
