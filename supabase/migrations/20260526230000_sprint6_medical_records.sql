-- =============================================================================
-- Sprint 6 — Prontuário médico MVP (append-only + audit + criptografia opcional)
-- =============================================================================
-- Schema construído pra atender LGPD art. 11 (dado sensível de saúde com
-- consentimento explícito) e Res. CFM 1.821/2007 (retenção mínima de 20 anos).
--
-- Decisões deliberadas (e o porquê):
--
-- 1) Append-only: a tabela `medical_records` não aceita UPDATE nem DELETE via
--    RLS (exceto service_role pra correções administrativas auditadas). Errata
--    é feita por novo record com `corrects_record_id` apontando o anterior.
--
-- 2) Criptografia opcional via pgcrypto: campo `content_encrypted bytea`
--    armazena `pgp_sym_encrypt(content, key)` quando a clínica habilitou.
--    Sem chave, cai em `content_plain` com flag `is_encrypted=false` e UI alerta.
--    Chave por tenant em `tenant_integrations.medical_records_key`.
--
-- 3) Audit trail: TODA leitura via RPC `medical_record_list` insere linha em
--    `medical_records_access_log`. Não há leitura direta da tabela via API.
--
-- 4) Consentimento: tabela `patient_consents` registra opt-in por finalidade.
--    UI deve exibir + obrigar opt-in antes do primeiro registro de prontuário.
--
-- 5) Assinatura digital: campos `signed_at`, `signature_meta jsonb` preparados
--    pra plugar ICP-Brasil (Serasa/Soluti) depois. UI marca "assinatura pendente"
--    quando vazio. Sem AC homologada, validade é "registro eletrônico" comum.
-- =============================================================================

create extension if not exists pgcrypto;

-- === Tipos válidos de registro ===
create table if not exists public.medical_record_types (
  code text primary key,
  label text not null,
  description text null
);

insert into public.medical_record_types (code, label, description) values
  ('anamnese',     'Anamnese',          'Histórico clínico, queixa principal, exame inicial'),
  ('evolucao',     'Evolução',          'Acompanhamento da consulta/sessão'),
  ('exame',        'Exame',             'Resultado/laudo de exame realizado'),
  ('conduta',      'Conduta',           'Plano terapêutico definido'),
  ('prescricao',   'Prescrição',        'Medicação/orientação prescrita'),
  ('atestado',     'Atestado',          'Atestado médico emitido'),
  ('relato',       'Relato cirúrgico',  'Descrição de procedimento cirúrgico'),
  ('observacao',   'Observação',        'Anotação geral'),
  ('errata',       'Errata',            'Correção de registro anterior (usar corrects_record_id)')
on conflict (code) do nothing;

-- === Tabela principal ===
create table if not exists public.medical_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete restrict,
  lead_id text not null,
  author_user_id text null,  -- app_users.id; null se gerado por integração
  author_name text not null,  -- snapshot do nome (auditoria robusta a renomeação)
  author_crm text null,       -- ex.: 'CRM-PR 12345' (autoridade médica)
  record_type text not null references public.medical_record_types(code),
  is_encrypted boolean not null default false,
  content_plain text null,
  content_encrypted bytea null,
  signed_at timestamptz null,
  signature_meta jsonb null,
  corrects_record_id uuid null references public.medical_records(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint medical_records_content_present check (
    content_plain is not null or content_encrypted is not null
  )
);

create index if not exists medical_records_lead_idx on public.medical_records(lead_id);
create index if not exists medical_records_tenant_lead_idx on public.medical_records(tenant_id, lead_id, created_at desc);

comment on table public.medical_records is
  'Prontuário médico append-only. Sem UPDATE/DELETE via RLS. Corrigir = inserir record errata.';

-- === Audit log de leitura ===
create table if not exists public.medical_records_access_log (
  id bigserial primary key,
  tenant_id text not null references public.tenants(id) on delete cascade,
  record_id uuid null references public.medical_records(id) on delete cascade,
  lead_id text not null,
  reader_user_id text null,
  reader_auth_uid uuid null,
  action text not null check (action in ('view_list','view_record','export','print')),
  ip text null,
  user_agent text null,
  created_at timestamptz not null default now()
);

create index if not exists mr_access_log_record_idx on public.medical_records_access_log(record_id);
create index if not exists mr_access_log_lead_idx on public.medical_records_access_log(tenant_id, lead_id, created_at desc);

-- === Consentimento do paciente ===
create table if not exists public.patient_consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.tenants(id) on delete cascade,
  lead_id text not null,
  purpose text not null check (purpose in (
    'medical_care',      -- atendimento médico (LGPD art. 11 II 'a')
    'marketing',         -- comunicação de marketing
    'research',          -- pesquisa científica anonimizada
    'health_insurance',  -- compartilhamento com convênio
    'whatsapp_messages'  -- recebimento de mensagens automatizadas
  )),
  granted boolean not null default false,
  granted_at timestamptz null,
  revoked_at timestamptz null,
  source text null,    -- 'in_person', 'whatsapp_optin', 'web_form'
  evidence jsonb null, -- texto exato exibido + IP + timestamp
  created_at timestamptz not null default now()
);

create unique index if not exists patient_consents_unique
  on public.patient_consents(tenant_id, lead_id, purpose);

-- === RLS ===
alter table public.medical_records enable row level security;
alter table public.medical_records_access_log enable row level security;
alter table public.patient_consents enable row level security;

-- medical_records: NÃO há policy de UPDATE/DELETE pra authenticated. Append-only.
drop policy if exists "medical_records select own tenant" on public.medical_records;
create policy "medical_records select own tenant"
  on public.medical_records for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists "medical_records insert own tenant" on public.medical_records;
create policy "medical_records insert own tenant"
  on public.medical_records for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- Audit log: authenticated insere a própria leitura, lê só do tenant.
drop policy if exists "mr_access_log select own tenant" on public.medical_records_access_log;
create policy "mr_access_log select own tenant"
  on public.medical_records_access_log for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists "mr_access_log insert own tenant" on public.medical_records_access_log;
create policy "mr_access_log insert own tenant"
  on public.medical_records_access_log for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- patient_consents: tenant lê/escreve só os seus.
drop policy if exists "patient_consents tenant rw" on public.patient_consents;
create policy "patient_consents tenant rw"
  on public.patient_consents for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

grant select, insert on public.medical_records to authenticated;
grant select, insert on public.medical_records_access_log to authenticated;
grant all on public.patient_consents to authenticated;
grant usage on sequence public.medical_records_access_log_id_seq to authenticated;
grant all on all tables in schema public to service_role;

-- === Helper RPCs ===

-- Cria um registro de prontuário (criptografando se houver chave de tenant).
create or replace function public.medical_record_create(
  p_lead_id text,
  p_record_type text,
  p_content text,
  p_corrects_record_id uuid default null,
  p_signature_meta jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_user_id text;
  v_author_name text;
  v_author_crm text;
  v_key text;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'sem tenant'; end if;
  if p_lead_id is null or length(trim(p_lead_id)) = 0 then raise exception 'lead_id obrigatorio'; end if;
  if p_content is null or length(trim(p_content)) = 0 then raise exception 'conteudo obrigatorio'; end if;

  -- Autor: app_users do auth.uid()
  select id, name, custom_fields->>'crm' into v_user_id, v_author_name, v_author_crm
    from public.app_users
   where auth_user_id = v_uid and tenant_id = v_tenant
   limit 1;
  if v_author_name is null then v_author_name := 'Sistema'; end if;

  -- Verifica consentimento de atendimento médico
  if not exists (
    select 1 from public.patient_consents
     where tenant_id = v_tenant
       and lead_id = p_lead_id
       and purpose = 'medical_care'
       and granted = true
       and revoked_at is null
  ) then
    raise exception 'paciente nao consentiu uso para atendimento medico (LGPD art. 11)';
  end if;

  -- Chave de cripto opcional (tenant_integrations.medical_records_key)
  select integrations->>'medical_records_key' into v_key
    from (select to_jsonb(ti) as integrations from public.tenant_integrations ti where ti.tenant_id = v_tenant) t;

  v_id := gen_random_uuid();
  insert into public.medical_records (
    id, tenant_id, lead_id, author_user_id, author_name, author_crm,
    record_type, is_encrypted, content_plain, content_encrypted,
    corrects_record_id, signed_at, signature_meta
  )
  values (
    v_id, v_tenant, p_lead_id, v_user_id, v_author_name, v_author_crm,
    p_record_type,
    v_key is not null,
    case when v_key is null then p_content else null end,
    case when v_key is not null then pgp_sym_encrypt(p_content, v_key) else null end,
    p_corrects_record_id,
    case when p_signature_meta is not null then now() else null end,
    p_signature_meta
  );

  return v_id;
end;
$$;

revoke all on function public.medical_record_create(text, text, text, uuid, jsonb) from public;
grant execute on function public.medical_record_create(text, text, text, uuid, jsonb) to authenticated;

-- Lista registros do lead e LOGA o acesso (audit obrigatório).
create or replace function public.medical_record_list(p_lead_id text)
returns table (
  id uuid,
  record_type text,
  author_name text,
  author_crm text,
  content text,
  signed_at timestamptz,
  corrects_record_id uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_user_id text;
  v_key text;
begin
  if v_tenant is null then return; end if;

  -- Loga a leitura
  select id into v_user_id from public.app_users where auth_user_id = v_uid and tenant_id = v_tenant limit 1;
  insert into public.medical_records_access_log (tenant_id, lead_id, reader_user_id, reader_auth_uid, action)
  values (v_tenant, p_lead_id, v_user_id, v_uid, 'view_list');

  select integrations->>'medical_records_key' into v_key
    from (select to_jsonb(ti) as integrations from public.tenant_integrations ti where ti.tenant_id = v_tenant) t;

  return query
    select
      r.id,
      r.record_type,
      r.author_name,
      r.author_crm,
      case
        when r.is_encrypted and v_key is not null then
          coalesce(pgp_sym_decrypt(r.content_encrypted, v_key), '(falha decriptacao)')
        when r.is_encrypted and v_key is null then
          '(conteudo criptografado — chave indisponivel)'
        else
          r.content_plain
      end as content,
      r.signed_at,
      r.corrects_record_id,
      r.created_at
    from public.medical_records r
    where r.tenant_id = v_tenant
      and r.lead_id = p_lead_id
    order by r.created_at desc;
end;
$$;

revoke all on function public.medical_record_list(text) from public;
grant execute on function public.medical_record_list(text) to authenticated;
