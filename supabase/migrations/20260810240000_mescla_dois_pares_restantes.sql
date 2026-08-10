-- OS DOIS PARES QUE TINHAM FICADO DE FORA
--
-- 20260810230000 mesclou 8 dos 10 telefones com card nos dois polos e deixou estes dois
-- porque os nomes eram de pessoas diferentes. Olhando o push name das mensagens (que o
-- dono do aparelho não controla pelo CRM), os dois são o MESMO aparelho:
--
-- 554499362808 — as 98 mensagens do card da clínica são todas da "Mônica"; o card se chama
--   "Silvio Marcos Torrecilha" porque a captura passiva promoveu o nome do PACIENTE citado
--   na conversa. É o padrão já conhecido: quem digita é a acompanhante, o card mostra o
--   paciente. O nome novo carrega os dois, senão a conversa de venda da Mônica no Tricopill
--   aparece com o nome do Silvio e vice-versa.
--
-- 5511996109567 — não é paciente nenhum: é a mesa do financeiro/admin. Pra linha do Tricopill
--   mandava conciliação ("tem uns de maio que ainda não foram lançados", "esses do dia 22,
--   tá faltando da Renata e Knea"); pra clínica mandava "Estorno realizado!" e nome de
--   paciente. Duas pessoas no mesmo aparelho, Kauan e Jayne — por isso o nome sozinho nunca
--   protegeu, e o telefone entrou em INTERNAL_PHONES no internalContacts.ts.
--
-- Mesma mecânica do 20260810230000: move tudo que aponta pro lead (inclusive as tabelas sem
-- foreign key, que o delete deixaria órfãs caladas) e só então apaga o card antigo.

do $$
declare
  p record;
  t text;
  drop_cf jsonb;
  move_tables text[] := array[
    'interactions','crm_media_items','crm_media_retry_jobs','lead_tasks','survey_dispatches',
    'appointments','lead_wa_line_events','lead_treatment_protocols','rede_payments','asaas_payments',
    'asaas_subscriptions','pagbank_checkouts','fin_receivables','stock_kits','storefront_events',
    'meta_leadgen_events','medical_records','medical_records_access_log','clinical_notes','clinic_sales',
    'patient_accounts','patient_photos','shosp_appointments','shosp_patients','srg_surgeries','surgery_accounts'
  ];
  singleton_tables text[] := array['crm_reengage_state','lead_followups','patient_consents'];
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  for p in
    select * from (values
      ('lead-59a5f13b-c84','lead-666491d0-0ab','Financeiro Instituto Lorena Visentainer (Kauan / Jayne)'),
      ('lead-508716c2-93f','lead-185b2500-523','Mônica Nascimento (paciente: Silvio Marcos Torrecilha)')
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

    delete from public.crm_conversation_line_states d
     where d.lead_id = p.drop_id
       and exists (select 1 from public.crm_conversation_line_states k
                    where k.lead_id = p.keep_id and k.whatsapp_instance_id = d.whatsapp_instance_id);
    update public.crm_conversation_line_states set lead_id = p.keep_id where lead_id = p.drop_id;

    select coalesce(custom_fields, '{}'::jsonb) into drop_cf from public.leads where id = p.drop_id;
    delete from public.leads where id = p.drop_id;

    update public.leads k set
      patient_name  = p.nome,
      custom_fields = drop_cf || coalesce(k.custom_fields, '{}'::jsonb),
      updated_at    = now()
     where k.id = p.keep_id;
  end loop;
end $$;
