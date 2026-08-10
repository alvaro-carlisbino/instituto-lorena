-- MESCLA DOS CARDS DUPLICADOS ENTRE POLOS
--
-- 10 telefones tinham DOIS cards, um na clínica e um no Tricopill. Em todos, o da clínica
-- era o mais antigo — e `findLeadByPhone` (crm.ts) casa por telefone sem filtrar polo e
-- ordena por `created_at asc`, então o card da clínica sempre ganhava e o do Tricopill
-- ficava órfão. A Ingrid mandava mensagem do número do Spa pra linha de vendas e ela
-- aparecia dentro da conversa da Dandara sobre agenda, com outro nome no topo.
--
-- Vão 8 dos 10. Ficam de fora `5511996109567` (Jayne na clínica, Kauan Financeiro no
-- Tricopill) e `554499362808` (Silvio na clínica, Mônica no Tricopill): ali são pessoas
-- diferentes no mesmo número, mesclar juntaria histórico de gente que não é a mesma.
--
-- O card que fica é o da clínica (o que já recebe tudo). O nome passa a ser o mais
-- descritivo dos dois onde isso importa: "Aline" vira "Aline Comercial Instituto Lorena
-- Visentainer" e "Spa" vira "Spa Capilar - Ingrid", que é o que faz `matchesInternalTerm`
-- reconhecer os dois como contato interno. Ver a lista por telefone em internalContacts.ts.
--
-- Roda depois de 20260810220000: a mescla também move o estado por linha.

do $$
declare
  p record;
  t text;
  drop_cf jsonb;
  -- Tudo que aponta pro lead muda de dono ANTES do delete. Metade não tem foreign key
  -- (pagamento, recebível, prontuário): o delete passava limpo e a linha ficava apontando
  -- pra um id inexistente. O card do Álvaro no Tricopill tinha 4 e.Rede, 3 Asaas e 1
  -- PagBank pendurados assim; o do André, 1 Asaas e 1 venda de clínica.
  move_tables text[] := array[
    'interactions','crm_media_items','crm_media_retry_jobs','lead_tasks','survey_dispatches',
    'appointments','lead_wa_line_events','lead_treatment_protocols','rede_payments','asaas_payments',
    'asaas_subscriptions','pagbank_checkouts','fin_receivables','stock_kits','storefront_events',
    'meta_leadgen_events','medical_records','medical_records_access_log','clinical_notes','clinic_sales',
    'patient_accounts','patient_photos','shosp_appointments','shosp_patients','srg_surgeries','surgery_accounts'
  ];
  -- Índice único por lead: se o card que fica já tem linha, a do outro não cabe.
  singleton_tables text[] := array['crm_reengage_state','lead_followups','patient_consents'];
begin
  -- enforce_role_write() só libera quem tem o claim de service_role no JWT.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  for p in
    select * from (values
      ('lead-ef546dca-8fe','lead-78587908-710','Alvaro Carlisbino'),
      ('lead-29356af4-3fb','lead-5bfc7145-aec','recepção'),
      ('lead-65209a08-17e','lead-bd41d434-0be','Spa Capilar - Ingrid'),
      ('lead-3126315e-fdf','lead-0a3781a3-6c8','Aline Comercial Instituto Lorena Visentainer'),
      ('lead-8196add9-45e','lead-665b3687-aba','André Luis Cecatto'),
      ('lead-e7d7d832-114','lead-7e6a0180-8f4','Fran'),
      ('lead-3869e70c-526','lead-f74c3c6b-b11','Géh Souza'),
      ('lead-834422ec-395','lead-c21081de-8bf','Lorena')
    ) as v(keep_id, drop_id, nome)
  loop
    foreach t in array move_tables loop
      execute format('update public.%I set lead_id = %L where lead_id = %L', t, p.keep_id, p.drop_id);
    end loop;

    foreach t in array singleton_tables loop
      execute format(
        'delete from public.%I d where d.lead_id = %L and exists (select 1 from public.%I k where k.lead_id = %L)',
        t, p.drop_id, t, p.keep_id);
      execute format('update public.%I set lead_id = %L where lead_id = %L', t, p.keep_id, p.drop_id);
    end loop;

    delete from public.lead_tag_assignments d
     where d.lead_id = p.drop_id
       and exists (select 1 from public.lead_tag_assignments k
                    where k.lead_id = p.keep_id and k.tag_id = d.tag_id);
    update public.lead_tag_assignments set lead_id = p.keep_id where lead_id = p.drop_id;

    delete from public.crm_lead_followup_state d
     where d.lead_id = p.drop_id
       and exists (select 1 from public.crm_lead_followup_state k where k.lead_id = p.keep_id);
    update public.crm_lead_followup_state set lead_id = p.keep_id where lead_id = p.drop_id;

    update public.crm_conversation_states k set
      last_inbound_at     = greatest(k.last_inbound_at, d.last_inbound_at),
      last_ai_reply_at    = greatest(k.last_ai_reply_at, d.last_ai_reply_at),
      last_human_reply_at = greatest(k.last_human_reply_at, d.last_human_reply_at),
      updated_at          = now()
      from public.crm_conversation_states d
     where k.lead_id = p.keep_id and d.lead_id = p.drop_id;
    delete from public.crm_conversation_states d
     where d.lead_id = p.drop_id
       and exists (select 1 from public.crm_conversation_states k where k.lead_id = p.keep_id);
    update public.crm_conversation_states set lead_id = p.keep_id where lead_id = p.drop_id;

    -- Estado por LINHA: a linha que o card que fica já tem vence; as outras vêm do outro.
    delete from public.crm_conversation_line_states d
     where d.lead_id = p.drop_id
       and exists (select 1 from public.crm_conversation_line_states k
                    where k.lead_id = p.keep_id and k.whatsapp_instance_id = d.whatsapp_instance_id);
    update public.crm_conversation_line_states set lead_id = p.keep_id where lead_id = p.drop_id;

    -- Guarda o custom_fields e APAGA o card antigo antes de gravar no que fica: o índice
    -- único de leadgen_id do Lead Ads não deixa os dois carregarem o mesmo id ao mesmo tempo.
    select coalesce(custom_fields, '{}'::jsonb) into drop_cf from public.leads where id = p.drop_id;
    delete from public.leads where id = p.drop_id;

    update public.leads k set
      patient_name  = p.nome,
      custom_fields = drop_cf || coalesce(k.custom_fields, '{}'::jsonb),
      updated_at    = now()
     where k.id = p.keep_id;
  end loop;
end $$;
