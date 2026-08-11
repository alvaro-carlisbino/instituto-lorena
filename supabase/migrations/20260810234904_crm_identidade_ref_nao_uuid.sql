-- A ficha 360 de QUALQUER lead da clínica estourava 500.
--
-- `crm_identidade` resolve três tipos de referência e, no ramo 'mirror', fazia
-- `p_ref::uuid`. Os ids de lead não são uuid ('lead-0ef341e7-8ed'), e como a função é
-- SQL puro ela é inlinada: o planejador avalia o cast mesmo quando p_tipo = 'lead',
-- desde que a varredura de hairmetrix_pacientes tenha linhas visíveis. Por isso o erro
-- só aparecia no polo da clínica (que tem tricoscopia) e não no do Tricopill — e por
-- isso passou despercebido desde que o 360 entrou.
--
-- O conserto é tirar o cast de dentro de expressão inlinável: um helper em plpgsql é
-- caixa-preta para o planejador e devolve null quando o texto não é uuid.
create or replace function public.crm_uuid_ou_nulo(p_texto text)
returns uuid
language plpgsql
immutable
as $function$
begin
  return p_texto::uuid;
exception when others then
  return null;
end;
$function$;

create or replace function public.crm_identidade(p_tipo text, p_ref text)
returns table(lead_id text, prontuario text, mirror_ids uuid[], nome text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ref as (
    select case when p_tipo = 'mirror' then public.crm_uuid_ou_nulo(p_ref) end as uid
  ),
  base as (
    select
      case p_tipo
        when 'lead'   then p_ref
        when 'shosp'  then (select sp.lead_id from public.shosp_patients sp where sp.prontuario = p_ref)
        when 'mirror' then (select hp.lead_id from public.hairmetrix_pacientes hp, ref r where hp.id = r.uid)
      end as lid,
      case p_tipo
        when 'shosp' then p_ref
        when 'lead'  then (select l.shosp_prontuario from public.leads l where l.id = p_ref)
      end as pront0,
      case p_tipo
        when 'mirror' then (select hp.nome_pasta from public.hairmetrix_pacientes hp, ref r where hp.id = r.uid)
        when 'shosp'  then (select sp.nome from public.shosp_patients sp where sp.prontuario = p_ref)
        when 'lead'   then (select l.patient_name from public.leads l where l.id = p_ref)
      end as nome0
  ),
  completo as (
    select b.lid,
      coalesce(b.pront0,
        (select sp.prontuario from public.shosp_patients sp where sp.lead_id = b.lid limit 1),
        (select l.shosp_prontuario from public.leads l where l.id = b.lid)) as pront,
      b.nome0
    from base b
  )
  select c.lid, c.pront,
    coalesce((select array_agg(hp.id) from public.hairmetrix_pacientes hp, ref r
      where hp.tenant_id = public.current_tenant_id()
        and ((c.lid is not null and hp.lead_id = c.lid)
          or (p_tipo = 'mirror' and hp.id = r.uid))), '{}'::uuid[]),
    c.nome0
  from completo c;
$function$;
