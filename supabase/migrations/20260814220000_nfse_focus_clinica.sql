-- NFS-e da clínica pela Focus NFe (ambiente NACIONAL).
--
-- Por que uma tabela própria em vez de pendurar num campo do atendimento: a nota tem vida
-- própria e ASSÍNCRONA. O POST devolve 202 "processando_autorizacao" e a autorização chega
-- depois, por webhook. Guardar só um `nfse_numero` na venda repetiria o erro que o selo do
-- Bling já custou caro (ver src/lib/nfeSelo.ts): número preenchido não prova nota autorizada.
-- Aqui o `status` é a fonte da verdade e o número só existe quando a SEFIN devolveu.
--
-- Escopo: Maringá adota o ambiente nacional, então o caminho é /v2/nfsen e a alíquota do ISS
-- vem do MUNICÍPIO, não do payload. Por isso não há coluna de alíquota de entrada — só o que
-- a nota autorizada devolveu.

alter table public.tenant_integrations
  add column if not exists focus jsonb not null default '{}'::jsonb;

comment on column public.tenant_integrations.focus is
  'Config NÃO-secreta da Focus NFe por polo: cnpj_prestador, codigo_municipio, '
  'codigo_tributacao_nacional, regime_especial_tributacao, tributos_aproximados. '
  'Os TOKENS moram em secret de ambiente (FOCUS_NFE_TOKEN_*), nunca aqui — o repo é público.';

create table if not exists public.nfse_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),

  -- `ref` é a chave que a gente escolhe e a Focus usa para sempre referenciar a nota.
  -- Reemitir com a mesma ref devolve a nota existente em vez de duplicar — é o que torna
  -- o retry seguro. Por isso é única por polo.
  ref text not null,

  -- 'processando_autorizacao' | 'autorizado' | 'cancelado' | 'erro_autorizacao'
  status text not null default 'processando_autorizacao',

  -- Só preenchidos quando a SEFIN autoriza. Nulo aqui significa "não temos nota", e não
  -- "ainda não leu" — a tela deve tratar os dois como "sem documento fiscal".
  numero text,
  codigo_verificacao text,
  url_consulta text,
  url_xml text,
  url_pdf text,

  valor_servico_cents integer not null,
  valor_iss_cents integer,
  aliquota_aplicada numeric(5,2),

  -- Quem tomou o serviço. Guardado desnormalizado de propósito: a nota é um documento de um
  -- instante, e o cadastro do paciente muda depois. O que valeu foi o que foi transmitido.
  tomador_documento text,
  tomador_nome text,
  descricao_servico text,

  -- Rastro para quando a SEFIN recusa: o array de {codigo, mensagem} que voltou.
  erros jsonb,
  -- Payload exatamente como transmitido, para reproduzir rejeição sem adivinhação.
  payload jsonb,

  -- 'homologacao' | 'producao'. Nota de homologação NÃO é documento fiscal e nunca pode
  -- aparecer misturada com as reais em relatório.
  ambiente text not null default 'homologacao',

  -- `leads.id` é TEXT neste banco, não uuid.
  lead_id text references public.leads (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists nfse_notes_ref_uniq
  on public.nfse_notes (tenant_id, ref);

-- A fila que a recepção olha: o que está pendente ou deu erro, mais recente primeiro.
create index if not exists nfse_notes_pendentes_idx
  on public.nfse_notes (tenant_id, status, created_at desc);

create index if not exists nfse_notes_lead_idx
  on public.nfse_notes (lead_id) where lead_id is not null;

alter table public.nfse_notes enable row level security;

drop policy if exists "nfse_notes tenant read" on public.nfse_notes;
create policy "nfse_notes tenant read" on public.nfse_notes
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user());

-- Escrita só pela edge function (service_role). Ninguém carimba status de nota fiscal pela
-- tela: o status é o que a SEFIN disse, não o que a atendente achou.
drop policy if exists "nfse_notes staff write" on public.nfse_notes;

grant select on public.nfse_notes to authenticated;
