-- Pesquisa de satisfação da clínica: trava cruzada + claim atômico + acentos.
--
-- Contexto (28/jul/2026): a clínica tem DOIS caminhos de pesquisa que escutam o mesmo
-- evento — o NPS da Sofia (texto "0 a 10", via `crm-nps-dispatch`, quando o card vai
-- para Encerrado) e o card de avaliação com botões (flow do ManyChat, disparado pelo
-- cron `crm-payment-confirm-watch` para as etapas consulta/fechado). Nenhum sabia do
-- outro: 122 pacientes receberam as duas pesquisas nos últimos 30 dias, algumas com
-- menos de dois minutos de diferença.
--
-- Aqui entra a parte de banco da correção:
--   1. claim ATÔMICO do carimbo `feedback_sent_at` (jsonb_set no servidor);
--   2. release do carimbo quando o envio do flow falha;
--   3. as perguntas dos templates escritas com acento.

-- ── 1. Claim atômico ───────────────────────────────────────────────────────────────
-- O código antigo lia `custom_fields`, montava o objeto novo em JS e gravava o campo
-- INTEIRO de volta. Qualquer escrita concorrente no mesmo lead (webhook do ManyChat,
-- captura de cadastro) sobrescrevia o carimbo recém-gravado — e o cron, que roda a cada
-- 2 minutos, mandava o card de novo. Com `jsonb_set` só a chave é tocada.
--
-- Devolve true apenas para quem CONSEGUIU o claim: duas execuções simultâneas não
-- enviam duas vezes (a segunda re-avalia o WHERE depois do lock e não acha linha).
create or replace function public.crm_claim_feedback_dispatch(
  p_lead_id text,
  p_skipped text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_now text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  update public.leads
     set custom_fields = jsonb_set(
           case
             when p_skipped is null then coalesce(custom_fields, '{}'::jsonb)
             else jsonb_set(coalesce(custom_fields, '{}'::jsonb), '{feedback_skipped}', to_jsonb(p_skipped))
           end,
           '{feedback_sent_at}',
           to_jsonb(v_now)
         )
   where id = p_lead_id
     -- `->>` (e não `->`) cobre tanto chave ausente quanto valor null explícito.
     and custom_fields ->> 'feedback_sent_at' is null
  returning id into v_id;

  return v_id is not null;
end;
$$;

-- ── 2. Release ─────────────────────────────────────────────────────────────────────
-- Envio do flow falhou: solta o carimbo pra tentar de novo na próxima rodada. Remove
-- só as duas chaves, preservando o resto de `custom_fields`.
create or replace function public.crm_release_feedback_dispatch(p_lead_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  update public.leads
     set custom_fields = (coalesce(custom_fields, '{}'::jsonb) - 'feedback_sent_at') - 'feedback_skipped'
   where id = p_lead_id
  returning id into v_id;

  return v_id is not null;
end;
$$;

revoke all on function public.crm_claim_feedback_dispatch(text, text) from public, anon, authenticated;
revoke all on function public.crm_release_feedback_dispatch(text) from public, anon, authenticated;
grant execute on function public.crm_claim_feedback_dispatch(text, text) to service_role;
grant execute on function public.crm_release_feedback_dispatch(text) to service_role;

-- ── 3. Acentos nas perguntas ───────────────────────────────────────────────────────
-- Vinham sem acento desde a migration original (20260429140000). O paciente lia
-- "Apos o atendimento (...) na nossa recepcao e triagem" — parecia mensagem automática
-- mal-feita logo no pedido de avaliação.
update public.survey_templates set nps_question =
  'Após o atendimento, de 0 a 10, o quanto recomendaria a experiência na nossa recepção e triagem? Pode mandar a nota e, se quiser, um comentário na mesma mensagem.'
  where id = 'nps-clinica';

update public.survey_templates set nps_question =
  'Sobre o tratamento capilar, de 0 a 10, como avalia o acompanhamento e os resultados até aqui? Pode mandar a nota e, se quiser, um comentário na mesma mensagem.'
  where id = 'nps-capilar';

update public.survey_templates set nps_question =
  'Sobre a cirurgia e o cuidado pós-operatório, de 0 a 10, o quanto recomendaria a nossa equipe? Pode mandar a nota e, se quiser, um comentário na mesma mensagem.'
  where id = 'nps-cirurgico';

update public.survey_templates set nps_question =
  'De 0 a 10, quanto recomendaria a nossa clínica a um amigo ou familiar? Pode mandar a nota e, se quiser, um comentário na mesma mensagem.'
  where id = 'nps-default';

update public.survey_templates set name = 'NPS — Processo cirúrgico' where id = 'nps-cirurgico';
update public.survey_templates set name = 'NPS genérico (fallback)' where id = 'nps-default';
