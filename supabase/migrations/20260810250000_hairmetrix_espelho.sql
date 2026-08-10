-- Espelho do HairMetrix (Canfield Mirror) dentro do CRM.
--
-- O sistema de tricoscopia roda em duas máquinas Windows da clínica. O banco é um
-- SQL Server 2019 (instância CANFIELD) na 192.168.50.119, MAS os resultados da
-- análise NÃO estão em tabela: estão em arquivo, no disco, um JSON por captura em
--   C:\ProgramData\Canfield\Databases\MirrorDatabase\<SOBRENOME, NOME (id)>\<captura>\tricho_N.json
--
-- Isso é bom pra nós: o agente lê arquivo e nunca encosta no banco do fornecedor.
-- Sem risco de travar a garantia com a Canfield, sem quebrar quando eles atualizarem
-- o schema, e sem precisar de usuário SQL nenhum.
--
-- Volume no levantamento de 10/08/2026: 3.041 pacientes, 2.985 com exame, 32.331 capturas.
--
-- Cada pasta de captura tem três arquivos que importam:
--   tricho_N.json        detecção bruta: follicle_units[] e hairs[] (w, h, a, score, valid)
--   tricho_N_input.json  ppmm (calibração!), roi[], location (região), aparelho
--   worklist.ini         o roteiro da sessão: as 6 regiões e seus guids
--
-- Hierarquia real do Mirror, respeitada aqui:
--   paciente (pasta) -> exame (pasta de captura) -> medida (tricho_0..tricho_N, uma por região)
--
-- REGIÃO É PARTE DA CHAVE CLÍNICA. A sessão padrão da clínica captura 6 pontos:
-- Temporal 1 right, Frontal 1, Temporal 1 left, Mid, Vertex center, Occiput 3 left.
-- Occipital é área doadora e não rala; vertex é onde a calvície avança. Comparar um
-- com o outro, ou somar os seis num número só, produz gráfico bonito e conclusão
-- errada. Toda evolução aqui é calculada DENTRO da mesma região.
--
-- Escrita é service_role via edge function `hairmetrix-sync`. O authenticated só lê,
-- e só pode escrever nas colunas de VÍNCULO: ninguém do atendimento altera medida
-- de exame pela UI.


-- ---------------------------------------------------------------------------
-- 1. PACIENTE DO MIRROR
-- ---------------------------------------------------------------------------
-- `mirror_patient_id` é o número entre parênteses no nome da pasta, um timestamp
-- AAAAMMDDHHMMSSmmm do cadastro. É estável e único, serve de chave de idempotência.
--
-- `nome_pasta` guarda o nome cru ("SOBRENOME, NOME") porque é o ÚNICO dado de
-- identificação que o Mirror expõe no sistema de arquivos. É PII de saúde: fica
-- atrás de RLS por polo, nunca vai em URL, nunca sai em log.

create table if not exists public.hairmetrix_pacientes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  mirror_patient_id text not null,           -- 20260220132717638
  nome_pasta text not null,                  -- "SOBRENOME, NOME" cru, como está no disco
  nome_normalizado text,                     -- minúsculo/sem acento, para o matching
  cadastrado_em timestamptz,                 -- derivado do timestamp do id

  -- vínculo com o paciente de verdade do CRM. Nasce nulo de propósito: casar 3 mil
  -- pastas por nome no automático produz falso positivo em prontuário de saúde.
  lead_id text,
  vinculo_status text not null default 'pendente'
    check (vinculo_status in ('pendente', 'vinculado', 'ignorado')),
  vinculo_por uuid,
  vinculo_em timestamptz,

  primeiro_exame_em timestamptz,
  ultimo_exame_em timestamptz,
  total_exames integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists hairmetrix_pacientes_uk
  on public.hairmetrix_pacientes (tenant_id, mirror_patient_id);
create index if not exists hairmetrix_pacientes_lead_idx
  on public.hairmetrix_pacientes (tenant_id, lead_id) where lead_id is not null;
create index if not exists hairmetrix_pacientes_pendentes_idx
  on public.hairmetrix_pacientes (tenant_id, vinculo_status, total_exames desc);
create index if not exists hairmetrix_pacientes_nome_idx
  on public.hairmetrix_pacientes (tenant_id, nome_normalizado);


-- ---------------------------------------------------------------------------
-- 2. EXAME = UMA PASTA DE CAPTURA
-- ---------------------------------------------------------------------------
-- `consultation_guid` vem do _input.json e amarra as capturas da mesma consulta.
-- É mais confiável que o nome da pasta, então guardamos os dois.

create table if not exists public.hairmetrix_exames (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  paciente_id uuid not null references public.hairmetrix_pacientes(id) on delete cascade,
  mirror_patient_id text not null,           -- desnormalizado: o agente faz upsert sem 2 roundtrips
  capture_id text not null,                  -- 20260220133728064, nome da pasta da captura
  capturado_em timestamptz not null,         -- derivado do capture_id
  consultation_guid text,
  dispositivo text,                          -- ex.: VISIOMED 16
  serial_dispositivo text,                   -- ex.: 9906 — troca de aparelho quebra série histórica
  total_medidas integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists hairmetrix_exames_uk
  on public.hairmetrix_exames (tenant_id, capture_id);
create index if not exists hairmetrix_exames_paciente_idx
  on public.hairmetrix_exames (tenant_id, paciente_id, capturado_em desc);
create index if not exists hairmetrix_exames_consulta_idx
  on public.hairmetrix_exames (tenant_id, consultation_guid) where consultation_guid is not null;


-- ---------------------------------------------------------------------------
-- 3. MEDIDA = UM tricho_N.json
-- ---------------------------------------------------------------------------
-- Pixel é a fonte da verdade porque é o que o arquivo entrega. Mas a calibração
-- vem junto: `ppmm` está em todo tricho_N_input.json (187,12 px/mm no VISIOMED 16
-- em magnificação 15), então densidade por cm² e espessura em µm saem sempre.
--
-- Sanidade do modelo: fio de w≈15 px vira 15/187,12 = 0,080 mm = 80 µm, que é
-- espessura de fio terminal. Miniaturizado (<40 µm) cai abaixo de w≈7,5 px. Os
-- números batem com a fisiologia, o que dá confiança no mapeamento.
--
-- A área analisada não é a imagem inteira, é o polígono `roi` do _input.json. No
-- exemplo levantado dá ~0,90 cm². Usar a imagem toda infla a área e derruba a
-- densidade artificialmente, então a área vem do ROI, calculada pelo agente.
--
-- `fios_por_uf` é o número que decide conduta em transplante, e é o único que sai
-- correto mesmo se a calibração faltar, por ser razão entre duas contagens.

create table if not exists public.hairmetrix_medidas (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  exame_id uuid not null references public.hairmetrix_exames(id) on delete cascade,
  indice integer not null,                   -- o N de tricho_N
  guid text,                                 -- guid da captura, casa com o guid da região no worklist.ini
  regiao text,                               -- "Vertex center", "Occiput 3 left", ...
  evaluator text,                            -- ex.: UnclippedHairEvaluator

  -- contagens brutas
  unidades_foliculares integer not null default 0,
  fios_total integer not null default 0,
  fios_validos integer not null default 0,   -- só os com valid = true

  -- razão: independe de calibração, é a métrica mais confiável do conjunto
  fios_por_uf numeric(6,3),

  -- morfologia, em pixel
  espessura_media_px numeric(8,3),
  espessura_mediana_px numeric(8,3),
  espessura_p10_px numeric(8,3),             -- cauda fina = miniaturização
  comprimento_medio_px numeric(8,3),
  score_medio numeric(6,4),

  -- histograma compacto de espessura, para acompanhar miniaturização ao longo do
  -- tratamento sem guardar os milhares de fios individuais
  espessura_hist jsonb,

  -- calibração e derivados
  px_por_mm numeric(10,4),                   -- ppmm do _input.json
  roi_area_mm2 numeric(10,4),                -- área do polígono roi, não da imagem
  densidade_uf_cm2 numeric(8,2),
  densidade_fios_cm2 numeric(8,2),
  espessura_media_um numeric(8,2),
  pct_fios_finos numeric(5,2),               -- % abaixo de 40 µm

  -- contexto do aparelho: muda magnificação, muda o que a mesma medida significa
  magnificacao integer,
  zoom numeric(6,2),

  created_at timestamptz not null default now()
);

create unique index if not exists hairmetrix_medidas_uk
  on public.hairmetrix_medidas (exame_id, indice);
create index if not exists hairmetrix_medidas_exame_idx
  on public.hairmetrix_medidas (tenant_id, exame_id);
create index if not exists hairmetrix_medidas_regiao_idx
  on public.hairmetrix_medidas (tenant_id, regiao);


-- ---------------------------------------------------------------------------
-- 4. IMAGEM
-- ---------------------------------------------------------------------------
-- Bucket PRIVADO. Imagem de couro cabeludo é dado sensível de saúde: acesso só por
-- URL assinada de vida curta, nunca link público. `sha256` evita reenviar o mesmo
-- arquivo quando o agente reprocessa uma pasta.

create table if not exists public.hairmetrix_imagens (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  exame_id uuid not null references public.hairmetrix_exames(id) on delete cascade,
  indice integer not null,
  regiao text,
  storage_path text,                         -- bucket privado hairmetrix
  sha256 text,
  bytes bigint,
  enviado_em timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists hairmetrix_imagens_uk
  on public.hairmetrix_imagens (exame_id, indice);


-- ---------------------------------------------------------------------------
-- 5. OBSERVABILIDADE DO SYNC
-- ---------------------------------------------------------------------------
-- Lição do sync do Shosp e do banco: cron verde não prova nada. Sem esta tabela o
-- agente morre calado e a gente só descobre quando alguém reclama que faltou exame.

create table if not exists public.hairmetrix_sync_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  origem text not null default 'agente-windows',
  pastas_varridas integer not null default 0,
  exames_novos integer not null default 0,
  medidas_novas integer not null default 0,
  imagens_enviadas integer not null default 0,
  erros integer not null default 0,
  detalhe_erro text
);

create index if not exists hairmetrix_sync_log_idx
  on public.hairmetrix_sync_log (tenant_id, iniciado_em desc);


-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
-- Escrita é service_role (edge function), que passa por cima da RLS. Ao authenticated
-- damos SELECT em tudo e UPDATE só em hairmetrix_pacientes, para a tela de vínculo.
-- Nenhuma policy nasce com using(true).

alter table public.hairmetrix_pacientes enable row level security;
alter table public.hairmetrix_exames    enable row level security;
alter table public.hairmetrix_medidas   enable row level security;
alter table public.hairmetrix_imagens   enable row level security;
alter table public.hairmetrix_sync_log  enable row level security;

drop policy if exists "hairmetrix_pacientes tenant read" on public.hairmetrix_pacientes;
create policy "hairmetrix_pacientes tenant read" on public.hairmetrix_pacientes
  for select to authenticated using (tenant_id = public.current_tenant_id());

-- único write do usuário: casar a pasta do Mirror com o lead do CRM
drop policy if exists "hairmetrix_pacientes tenant vinculo" on public.hairmetrix_pacientes;
create policy "hairmetrix_pacientes tenant vinculo" on public.hairmetrix_pacientes
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists "hairmetrix_exames tenant read" on public.hairmetrix_exames;
create policy "hairmetrix_exames tenant read" on public.hairmetrix_exames
  for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists "hairmetrix_medidas tenant read" on public.hairmetrix_medidas;
create policy "hairmetrix_medidas tenant read" on public.hairmetrix_medidas
  for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists "hairmetrix_imagens tenant read" on public.hairmetrix_imagens;
create policy "hairmetrix_imagens tenant read" on public.hairmetrix_imagens
  for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists "hairmetrix_sync_log tenant read" on public.hairmetrix_sync_log;
create policy "hairmetrix_sync_log tenant read" on public.hairmetrix_sync_log
  for select to authenticated using (tenant_id = public.current_tenant_id());

grant select on public.hairmetrix_pacientes to authenticated;
grant update (lead_id, vinculo_status, vinculo_por, vinculo_em, updated_at)
  on public.hairmetrix_pacientes to authenticated;
grant select on public.hairmetrix_exames   to authenticated;
grant select on public.hairmetrix_medidas  to authenticated;
grant select on public.hairmetrix_imagens  to authenticated;
grant select on public.hairmetrix_sync_log to authenticated;


-- ---------------------------------------------------------------------------
-- 7. EVOLUÇÃO DO PACIENTE, POR REGIÃO
-- ---------------------------------------------------------------------------
-- É pra isso que a integração existe: mostrar na ficha se o tratamento está fazendo
-- efeito. Uma linha por (exame, região), com a variação contra a captura anterior
-- DA MESMA REGIÃO. O lag é particionado por região justamente por isso: vertex só
-- se compara com vertex.

create or replace function public.hairmetrix_evolucao(
  p_lead_id text,
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
      e.capturado_em,
      e.capture_id,
      m.regiao,
      m.unidades_foliculares,
      m.fios_validos,
      m.fios_por_uf,
      m.densidade_fios_cm2,
      m.espessura_media_um,
      m.pct_fios_finos
    from public.hairmetrix_medidas m
    join public.hairmetrix_exames e     on e.id = m.exame_id
    join public.hairmetrix_pacientes p  on p.id = e.paciente_id
    where p.lead_id = p_lead_id
      and p.tenant_id = public.current_tenant_id()
      and (p_regiao is null or m.regiao = p_regiao)
  )
  select
    b.capturado_em,
    b.capture_id,
    b.regiao,
    b.unidades_foliculares,
    b.fios_validos,
    b.fios_por_uf,
    b.densidade_fios_cm2,
    b.espessura_media_um,
    b.pct_fios_finos,
    case
      when lag(b.densidade_fios_cm2) over w > 0
      then round((b.densidade_fios_cm2 - lag(b.densidade_fios_cm2) over w)
                 * 100.0 / lag(b.densidade_fios_cm2) over w, 2)
    end,
    case
      when lag(b.espessura_media_um) over w > 0
      then round((b.espessura_media_um - lag(b.espessura_media_um) over w)
                 * 100.0 / lag(b.espessura_media_um) over w, 2)
    end
  from base b
  window w as (partition by b.regiao order by b.capturado_em)
  order by b.regiao, b.capturado_em;
$function$;

comment on function public.hairmetrix_evolucao(text, text) is
  'Evolução tricoscópica por região, captura a captura, com delta contra a anterior da MESMA região.';

-- SECURITY DEFINER aberta pra PUBLIC por padrão é furo. Fecha e libera só quem deve.
revoke all on function public.hairmetrix_evolucao(text, text) from public;
grant execute on function public.hairmetrix_evolucao(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. FILA DE VÍNCULO
-- ---------------------------------------------------------------------------
-- 2.985 pacientes com exame não casam sozinhos com o CRM. Esta é a tela de trabalho:
-- quem tem mais exame aparece primeiro, porque é onde o vínculo rende mais.
-- Mesmo aprendizado do backfill do ManyChat: planejar a fila desde o começo, em vez
-- de improvisar depois que o resto já está no ar.

create or replace function public.hairmetrix_pendentes_vinculo(p_limit integer default 50)
returns table(
  id uuid,
  mirror_patient_id text,
  nome_pasta text,
  total_exames integer,
  primeiro_exame_em timestamptz,
  ultimo_exame_em timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.mirror_patient_id, p.nome_pasta, p.total_exames,
         p.primeiro_exame_em, p.ultimo_exame_em
  from public.hairmetrix_pacientes p
  where p.tenant_id = public.current_tenant_id()
    and p.vinculo_status = 'pendente'
    and p.total_exames > 0
  order by p.total_exames desc, p.ultimo_exame_em desc nulls last
  limit greatest(coalesce(p_limit, 50), 1);
$function$;

comment on function public.hairmetrix_pendentes_vinculo(integer) is
  'Pastas do Mirror ainda não casadas com lead do CRM, as de maior volume primeiro.';

revoke all on function public.hairmetrix_pendentes_vinculo(integer) from public;
grant execute on function public.hairmetrix_pendentes_vinculo(integer) to authenticated;


comment on table public.hairmetrix_pacientes is
  'Espelho das pastas de paciente do Canfield Mirror. nome_pasta é PII de saúde.';
comment on table public.hairmetrix_exames is
  'Uma linha por pasta de captura do Mirror (capture_id = timestamp).';
comment on table public.hairmetrix_medidas is
  'Agregado de um tricho_N.json. Região faz parte da chave clínica: só se compara igual com igual.';
