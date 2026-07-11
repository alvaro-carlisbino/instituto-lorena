-- RPC que alimenta o painel /tricopill-reengajamento. SECURITY DEFINER pra não
-- depender de RLS nas views (o frontend chama como authenticated).
-- Retorna KPIs + quem está em cadência (ativos) + quem vai entrar (fila).
-- A fila aplica o MESMO blocklist do scheduler (contato interno/lixo) pra o
-- número refletir quem de fato vai ser contatado.

create or replace function public.tricopill_reengage_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'metrics', (select row_to_json(m) from public.tricopill_reengage_metrics m),
    'ativos', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
        select l.patient_name, rs.track, rs.step, rs.status, rs.last_sent_at
        from public.crm_reengage_state rs join public.leads l on l.id = rs.lead_id
        where l.tenant_id = 'tricopill'
        order by rs.updated_at desc limit 200) a),
    'fila', (select coalesce(jsonb_agg(q), '[]'::jsonb) from (
        select patient_name, situacao, dias_silencio, last_kit, reactivation_status, recompra_status
        from public.tricopill_reengage_leads v
        where situacao in ('silencioso','comprou')
          and coalesce(reactivation_status,'') not in ('active','stopped','converted')
          and coalesce(recompra_status,'') not in ('active','stopped')
          and length(regexp_replace(translate(lower(coalesce(patient_name,'')),
                'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn'), '[^a-z]', '', 'g')) >= 3
          and translate(lower(coalesce(patient_name,'')),
                'áàâãäéèêëíìîïóòôõöúùûüçñ','aaaaaeeeeiiiiooooouuuucn')
              !~ 'recepc|marketing|comercial|contato whatsapp|spa capilar|instituto lorena|lorena visentainer|alvaro carlisbino|financeiro|atendimento|guegrorioda'
        order by dias_silencio desc nulls last limit 300) q)
  );
$$;

grant execute on function public.tricopill_reengage_overview() to authenticated;
