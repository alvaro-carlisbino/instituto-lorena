-- O prontuário estava quebrado em produção: "column reference \"id\" is ambiguous".
--
-- Causa: `medical_record_list` declara `returns table(id uuid, ...)`. Em plpgsql, cada
-- coluna do RETURNS TABLE vira uma VARIÁVEL de saída com esse nome. Então a linha
--
--     select id into v_user_id from public.app_users where ...
--
-- tem duas leituras possíveis para `id` — a variável de saída da função e a coluna da
-- tabela — e o Postgres recusa em vez de escolher (erro 42702). Reproduzido em função
-- de teste antes do conserto: a mesma mensagem, palavra por palavra.
--
-- Não era intermitente nem dependia de dado: a função falhava em TODA chamada de quem
-- tem tenant, ou seja, /prontuario nunca listou nada para ninguém. Bate com
-- `medical_records` e `clinical_notes` estarem zeradas.
--
-- Conserto: qualificar a tabela (`u.id`). `medical_record_create` lê `app_users` do mesmo
-- jeito e hoje escapa só porque retorna uuid e não tem variável chamada `id` — qualificar
-- lá também, senão a próxima pessoa que trocar o retorno para TABLE reabre o mesmo buraco.
--
-- ---------------------------------------------------------------------------
-- SEGUNDO BUG, atrás do primeiro
-- ---------------------------------------------------------------------------
-- Com o `id` resolvido, a chamada passou a morrer em
-- `function pgp_sym_decrypt(bytea, text) does not exist`. O pgcrypto do Supabase mora no
-- schema `extensions`, e estas funções fixam `search_path = 'public'` (o endurecimento
-- correto, ver [[supabase_rpc_aberta_anon]]) — então o nome não resolve.
--
-- Isso quebrava TODA listagem, inclusive com zero registros: o Postgres resolve a função
-- no PLANO da query, não por linha. O ramo do `case` nem precisava ser executado.
--
-- Conserto: qualificar `extensions.pgp_sym_*` em vez de afrouxar o search_path.
-- `gen_random_uuid()` não precisa: é nativo do pg_catalog, que está sempre no caminho.

create or replace function public.medical_record_list(p_lead_id text)
returns table(
  id uuid, record_type text, author_name text, author_crm text,
  content text, signed_at timestamptz, corrects_record_id uuid, created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_user_id text;
  v_key text;
begin
  if v_tenant is null then return; end if;

  select u.id into v_user_id
    from public.app_users u
   where u.auth_user_id = v_uid and u.tenant_id = v_tenant
   limit 1;

  insert into public.medical_records_access_log (tenant_id, lead_id, reader_user_id, reader_auth_uid, action)
  values (v_tenant, p_lead_id, v_user_id, v_uid, 'view_list');

  select t.llm->>'medical_records_key' into v_key
    from public.tenant_integrations t where t.tenant_id = v_tenant;

  return query
    select r.id, r.record_type, r.author_name, r.author_crm,
      case
        when r.is_encrypted and v_key is not null then coalesce(extensions.pgp_sym_decrypt(r.content_encrypted, v_key), '(falha decriptacao)')
        when r.is_encrypted and v_key is null then '(conteudo criptografado - chave indisponivel)'
        else r.content_plain
      end as content,
      r.signed_at, r.corrects_record_id, r.created_at
    from public.medical_records r
    where r.tenant_id = v_tenant and r.lead_id = p_lead_id
    order by r.created_at desc;
end;
$function$;

create or replace function public.medical_record_create(
  p_lead_id text,
  p_record_type text,
  p_content text,
  p_corrects_record_id uuid default null::uuid,
  p_signature_meta jsonb default null::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_uid uuid := auth.uid();
  v_user_id text;
  v_author_name text;
  v_key text;
  v_id uuid;
begin
  if v_tenant is null then raise exception 'sem tenant'; end if;
  if p_lead_id is null or length(trim(p_lead_id)) = 0 then raise exception 'lead_id obrigatorio'; end if;
  if p_content is null or length(trim(p_content)) = 0 then raise exception 'conteudo obrigatorio'; end if;

  select u.id, u.name into v_user_id, v_author_name
    from public.app_users u
   where u.auth_user_id = v_uid and u.tenant_id = v_tenant
   limit 1;
  if v_author_name is null then v_author_name := 'Sistema'; end if;

  if not exists (
    select 1 from public.patient_consents
     where tenant_id = v_tenant and lead_id = p_lead_id
       and purpose = 'medical_care' and granted = true and revoked_at is null
  ) then
    raise exception 'paciente nao consentiu uso para atendimento medico (LGPD art. 11)';
  end if;

  select t.llm->>'medical_records_key' into v_key
    from public.tenant_integrations t where t.tenant_id = v_tenant;

  v_id := gen_random_uuid();
  insert into public.medical_records (
    id, tenant_id, lead_id, author_user_id, author_name,
    record_type, is_encrypted, content_plain, content_encrypted,
    corrects_record_id, signed_at, signature_meta
  )
  values (
    v_id, v_tenant, p_lead_id, v_user_id, v_author_name,
    p_record_type,
    v_key is not null,
    case when v_key is null then p_content else null end,
    case when v_key is not null then extensions.pgp_sym_encrypt(p_content, v_key) else null end,
    p_corrects_record_id,
    case when p_signature_meta is not null then now() else null end,
    p_signature_meta
  );
  return v_id;
end;
$function$;
