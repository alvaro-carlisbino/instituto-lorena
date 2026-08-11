-- A busca acha em TODOS os polos de que o usuário é membro, e diz de qual polo veio.
--
-- Até aqui o ⌘K só enxergava o polo ativo. Quem toca os dois negócios tinha de adivinhar
-- em qual workspace a pessoa estava e trocar de polo para procurar de novo — e o cliente
-- do Tricopill simplesmente não existia a partir da tela da clínica.
--
-- NÃO é privilégio novo: o conjunto é exatamente o de `my_tenants()`, que já alimenta o
-- seletor de workspace. Quem é membro de um polo só continua vendo um polo só —
-- verificado com um usuário só-Tricopill procurando um lead que só existe na clínica.
--
-- O polo vem junto no resultado de propósito. A regra da casa é que clínica e vendas não
-- se somam; misturar as duas numa lista sem etiqueta seria o primeiro passo para alguém
-- somar. Com a etiqueta, a lista mostra as duas e ninguém confunde.
--
-- (A migração 20260811012740 troca depois esse `polo` do nome para o ID, porque o ⌘K
--  precisa dele para trocar de workspace antes de abrir a pessoa.)
create or replace function public.crm_meus_tenants()
returns setof text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.tenant_id from public.tenant_members m where m.auth_user_id = auth.uid();
$function$;

revoke execute on function public.crm_meus_tenants() from anon, public;
grant execute on function public.crm_meus_tenants() to authenticated, service_role;

-- O tipo de retorno ganha `polo`, então precisa recriar em vez de substituir.
drop function if exists public.crm_buscar_pacientes(text, integer);
-- corpo: igual ao de 20260810234456, com 'l.tenant_id in (select t from meus)' no
-- lugar de '= public.current_tenant_id()', mais a coluna polo.

create function public.crm_buscar_pacientes(p_termo text, p_limit integer default 20)
returns table(
  tipo text, ref text, lead_id text, nome text, telefone text, prontuario text, cpf text,
  achado_por text, consultas integer, cirurgias integer, exames integer, vendas integer,
  ultimo_contato timestamptz, polo text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with termo as (
    select public.crm_norm_texto(p_termo) as texto,
           regexp_replace(coalesce(p_termo, ''), '\D', '', 'g') as digitos,
           lower(trim(coalesce(p_termo, ''))) as cru
  ),
  meus as (select t from public.crm_meus_tenants() t),
  por_lead as (
    -- `peso` ordena o resultado: identificador exato (telefone, CPF, pedido) vence nome
    -- parcial, porque quem digita 11 dígitos sabe exatamente quem procura.
    select distinct on (lid) lid, motivo, peso from (
      select l.id as lid, 'nome'::text as motivo, 3 as peso
      from public.leads l, termo t
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and length(t.texto) >= 2
        and public.crm_norm_texto(l.patient_name) like '%' || t.texto || '%'
      union all
      select l.id, 'telefone', 1
      from public.leads l, termo t
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and length(t.digitos) >= 4
        and public.crm_fone_final(l.phone) like '%' || right(t.digitos, 8) || '%'
      union all
      select sp.lead_id, 'CPF', 1
      from public.shosp_patients sp, termo t
      where sp.lead_id is not null and length(t.digitos) >= 6
        and regexp_replace(coalesce(sp.cpf, ''), '\D', '', 'g') like '%' || t.digitos || '%'
      union all
      select hp.lead_id, 'tricoscopia', 2
      from public.hairmetrix_pacientes hp, termo t
      where hp.tenant_id in (select t from meus) and hp.lead_id is not null
        and length(t.texto) >= 3 and hp.nome_normalizado like '%' || t.texto || '%'

      -- ↓↓↓ tudo daqui para baixo é o lado do CLIENTE, que não existia na busca ↓↓↓

      -- CPF do cadastro de venda (o do checkout do site e o das três telas de venda).
      union all
      select l.id, 'CPF', 1
      from public.leads l, termo t
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and length(t.digitos) >= 6
        and regexp_replace(coalesce(l.custom_fields->'cadastro'->>'cpf', ''), '\D', '', 'g')
            like '%' || t.digitos || '%'
      -- E-mail: do cadastro, do topo do custom_fields ou do Shosp.
      union all
      select l.id, 'e-mail', 1
      from public.leads l, termo t
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and length(t.cru) >= 3 and position('@' in t.cru) > 0
        and (lower(coalesce(l.custom_fields->>'email', '')) like '%' || t.cru || '%'
          or lower(coalesce(l.custom_fields->'cadastro'->>'email', '')) like '%' || t.cru || '%')
      union all
      select sp.lead_id, 'e-mail', 1
      from public.shosp_patients sp, termo t
      where sp.lead_id is not null
        and length(t.cru) >= 3 and position('@' in t.cru) > 0
        and lower(coalesce(sp.email, '')) like '%' || t.cru || '%'
      -- Nome completo do cadastro: o cartão costuma trazer o nome inteiro, e o card do
      -- lead costuma ter só o primeiro nome que a pessoa usou no WhatsApp.
      union all
      select l.id, 'nome no cadastro', 3
      from public.leads l, termo t
      where l.tenant_id in (select t from meus) and l.deleted_at is null
        and length(t.texto) >= 3
        and public.crm_norm_texto(l.custom_fields->'cadastro'->>'nomeCompleto') like '%' || t.texto || '%'
      -- Pagamento no cartão/PIX: CPF, nome do portador, telefone do pedido, número do
      -- pedido no Bling e número da NF-e.
      union all
      select rp.lead_id, m.motivo, m.peso
      from public.rede_payments rp, termo t,
        lateral (
          select
            case
              when length(t.digitos) >= 6
                and regexp_replace(coalesce(rp.customer_doc, ''), '\D', '', 'g') like '%' || t.digitos || '%'
                then 'CPF do pagamento'
              when t.digitos <> '' and rp.bling_order_id::text = t.digitos then 'pedido Bling'
              when t.digitos <> '' and rp.nfe_numero::text = t.digitos then 'NF-e'
              when length(t.digitos) >= 4
                and public.crm_fone_final(rp.phone) like '%' || right(t.digitos, 8) || '%'
                then 'telefone do pedido'
              when length(t.texto) >= 3
                and public.crm_norm_texto(rp.customer_name) like '%' || t.texto || '%'
                then 'nome no pagamento'
            end as motivo,
            case
              when length(t.texto) >= 3
                and public.crm_norm_texto(rp.customer_name) like '%' || t.texto || '%'
                and not (length(t.digitos) >= 6
                  and regexp_replace(coalesce(rp.customer_doc, ''), '\D', '', 'g') like '%' || t.digitos || '%')
                then 3
              else 1
            end as peso
        ) m
      where rp.tenant_id in (select t from meus) and rp.lead_id is not null
        and m.motivo is not null
      -- Checkout PIX (pagbank): mesma ideia, outra tabela.
      union all
      select pc.lead_id, 'CPF do pagamento', 1
      from public.pagbank_checkouts pc, termo t
      where pc.tenant_id in (select t from meus) and pc.lead_id is not null
        and length(t.digitos) >= 6
        and regexp_replace(coalesce(pc.customer_doc, ''), '\D', '', 'g') like '%' || t.digitos || '%'
      union all
      select pc.lead_id, 'nome no pagamento', 3
      from public.pagbank_checkouts pc, termo t
      where pc.tenant_id in (select t from meus) and pc.lead_id is not null
        and length(t.texto) >= 3
        and public.crm_norm_texto(pc.customer_name) like '%' || t.texto || '%'
      -- Assinante do clube.
      union all
      select s.lead_id, 'assinatura', 1
      from public.asaas_subscriptions s, termo t
      where s.tenant_id in (select t from meus) and s.lead_id is not null
        and ((length(t.digitos) >= 6
              and regexp_replace(coalesce(s.customer_doc, ''), '\D', '', 'g') like '%' || t.digitos || '%')
          or (length(t.cru) >= 3 and position('@' in t.cru) > 0
              and lower(coalesce(s.email, '')) like '%' || t.cru || '%'))
      -- Conta da loja: o cliente que criou login no site. Casa pelo telefone com o lead.
      union all
      select l.id, 'conta da loja', 1
      from public.tricopill_customers tc
      join public.leads l
        on l.tenant_id = tc.tenant_id
       and l.deleted_at is null
       and public.crm_fone_final(l.phone) = public.crm_fone_final(tc.phone)
       , termo t
      where tc.tenant_id in (select t from meus)
        and ((length(t.cru) >= 3 and position('@' in t.cru) > 0
              and lower(coalesce(tc.email, '')) like '%' || t.cru || '%')
          or (length(t.texto) >= 3 and public.crm_norm_texto(tc.name) like '%' || t.texto || '%'))
    ) z where lid is not null order by lid, peso
  ),
  por_shosp as (
    select sp.prontuario, sp.nome, sp.cpf, coalesce(sp.celular, sp.telefone) as fone,
      case
        when length(t.digitos) >= 6
             and regexp_replace(coalesce(sp.cpf,''), '\D','','g') like '%' || t.digitos || '%' then 'CPF'
        when length(t.digitos) >= 4
             and public.crm_fone_final(coalesce(sp.celular, sp.telefone)) like '%' || right(t.digitos, 8) || '%' then 'telefone'
        when t.digitos <> '' and sp.prontuario = t.digitos then 'prontuario'
        when length(t.cru) >= 3 and position('@' in t.cru) > 0
             and lower(coalesce(sp.email,'')) like '%' || t.cru || '%' then 'e-mail'
        else 'nome no Shosp'
      end as motivo
    from public.shosp_patients sp, termo t
    where sp.lead_id is null
      and ((length(t.texto) >= 3 and public.crm_norm_texto(sp.nome) like '%' || t.texto || '%')
        or (length(t.digitos) >= 6 and regexp_replace(coalesce(sp.cpf,''), '\D','','g') like '%' || t.digitos || '%')
        or (length(t.digitos) >= 4 and public.crm_fone_final(coalesce(sp.celular, sp.telefone)) like '%' || right(t.digitos, 8) || '%')
        or (t.digitos <> '' and sp.prontuario = t.digitos)
        or (length(t.cru) >= 3 and position('@' in t.cru) > 0
            and lower(coalesce(sp.email,'')) like '%' || t.cru || '%'))
  ),
  por_mirror as (
    select hp.id, hp.nome_pasta, hp.total_exames
    from public.hairmetrix_pacientes hp, termo t
    where hp.tenant_id in (select t from meus)
      and hp.lead_id is null and hp.total_exames > 0
      and length(t.texto) >= 3
      and hp.nome_normalizado like '%' || t.texto || '%'
  )
  select r.tipo, r.ref, r.lead_id, r.nome, r.telefone, r.prontuario, r.cpf, r.achado_por,
         r.consultas, r.cirurgias, r.exames, r.vendas, r.ultimo_contato, r.polo
  from (
    select 'lead'::text as tipo, l.id as ref, l.id as lead_id, l.patient_name as nome,
      l.phone as telefone, l.shosp_prontuario as prontuario,
      -- CPF: o do Shosp quando é paciente, o do cadastro de venda quando é cliente.
      coalesce(
        (select sp.cpf from public.shosp_patients sp where sp.lead_id = l.id limit 1),
        nullif(l.custom_fields->'cadastro'->>'cpf', '')
      ) as cpf,
      m.motivo as achado_por,
      (select count(*)::integer from public.shosp_appointments a where a.lead_id = l.id) as consultas,
      (select count(*)::integer from public.srg_surgeries s where s.lead_id = l.id and s.deleted_at is null) as cirurgias,
      (select coalesce(sum(hp.total_exames), 0)::integer from public.hairmetrix_pacientes hp where hp.lead_id = l.id) as exames,
      -- "Vendas" agora conta o que o cliente comprou, não só a venda de procedimento:
      -- para quem só compra Tricopill o selo vinha sempre zerado.
      ((select count(*) from public.clinic_sales cs where cs.lead_id = l.id and cs.status <> 'canceled')
       + (select count(*) from public.rede_payments rp where rp.lead_id = l.id and rp.status = 'paid')
       + (select count(*) from public.pagbank_checkouts pc where pc.lead_id = l.id and pc.status = 'paid')
      )::integer as vendas,
      l.last_interaction_at as ultimo_contato,
      (select tn.name from public.tenants tn where tn.id = l.tenant_id) as polo,
      m.peso as peso
    from por_lead m
    join public.leads l on l.id = m.lid
    where l.tenant_id in (select t from meus) and l.deleted_at is null
    union all
    select 'shosp', s.prontuario, null, s.nome, s.fone, s.prontuario, s.cpf, s.motivo,
      (select count(*)::integer from public.shosp_appointments a where a.prontuario = s.prontuario),
      (select count(*)::integer from public.srg_surgeries g where g.shosp_prontuario = s.prontuario and g.deleted_at is null),
      0,
      (select count(*)::integer from public.clinic_sales cs where cs.shosp_prontuario = s.prontuario and cs.status <> 'canceled'),
      null::timestamptz,
      null::text,
      case s.motivo when 'nome no Shosp' then 4 else 1 end
    from por_shosp s
    union all
    select 'mirror', h.id::text, null, h.nome_pasta, null, null, null, 'tricoscopia',
      0, 0, h.total_exames, 0, null::timestamptz, null::text, 5
    from por_mirror h
  ) r
  order by r.peso, r.ultimo_contato desc nulls last, r.nome
  limit greatest(coalesce(p_limit, 20), 1);
$function$;

revoke execute on function public.crm_buscar_pacientes(text, integer) from anon, public;
grant execute on function public.crm_buscar_pacientes(text, integer) to authenticated, service_role;
