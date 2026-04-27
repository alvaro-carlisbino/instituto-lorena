-- Follow-up automático (tarefas por etapa) e modelos NPS por funil — alinhado a src/mocks/crmMock.ts
-- session_replication_role: desativa enforce_role_write durante a migração

set session_replication_role = 'replica';

-- Remove regra legada de demo se existir
delete from public.automation_rules where id = 'auto-1';

insert into public.survey_templates (id, name, nps_question, enabled) values
  ('nps-default', 'NPS generico (fallback)', 'De 0 a 10, quanto recomendaria a nossa clinica a um amigo ou familiar?', false),
  ('nps-clinica', 'NPS — Pipeline Clínica', 'Apos o atendimento, de 0 a 10, o quanto recomendaria a experiencia na nossa recepcao e triagem?', true),
  ('nps-capilar', 'NPS — Tratamento capilar', 'Sobre o tratamento capilar, de 0 a 10, como avalia o acompanhamento e os resultados ate aqui?', true),
  ('nps-cirurgico', 'NPS — Processo cirurgico', 'Sobre a cirurgia e o cuidado pos-operatorio, de 0 a 10, o quanto recomendaria a nossa equipe?', true)
on conflict (id) do update set
  name = excluded.name,
  nps_question = excluded.nps_question,
  enabled = excluded.enabled;

insert into public.automation_rules (id, name, enabled, trigger_type, trigger_config, action_type, action_config) values
  (
    'auto-novo',
    'Clínica: primeiro retorno (novo lead)',
    true,
    'stage_entered',
    '{"stageId": "novo"}'::jsonb,
    'create_task',
    '{"title": "Ligar ou WhatsApp em ate 2h", "hoursOffset": 2, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-triagem',
    'Clínica: follow-up pós-triagem',
    true,
    'stage_entered',
    '{"stageId": "triagem"}'::jsonb,
    'create_task',
    '{"title": "Confirmar entendimento e proximo passo (triagem)", "hoursOffset": 4, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-contato',
    'Clínica: contato humano (24h)',
    true,
    'stage_entered',
    '{"stageId": "contato"}'::jsonb,
    'create_task',
    '{"title": "Contato humano: proposta ou proxima acao", "hoursOffset": 24, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-consulta',
    'Clínica: pos-consulta',
    true,
    'stage_entered',
    '{"stageId": "consulta"}'::jsonb,
    'create_task',
    '{"title": "Check-in pos-consulta (satisfacao e retorno)", "hoursOffset": 48, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-tc-avaliacao',
    'Capilar: apos avaliacao',
    true,
    'stage_entered',
    '{"stageId": "tc-avaliacao"}'::jsonb,
    'create_task',
    '{"title": "Enviar plano e condicoes (avaliacao capilar)", "hoursOffset": 24, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-tc-plano',
    'Capilar: acompanhamento do plano',
    true,
    'stage_entered',
    '{"stageId": "tc-plano"}'::jsonb,
    'create_task',
    '{"title": "Cobrar aceite do plano / orcamento", "hoursOffset": 48, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-tc-sessoes',
    'Capilar: em sessoes',
    true,
    'stage_entered',
    '{"stageId": "tc-sessoes"}'::jsonb,
    'create_task',
    '{"title": "Check-in de evolucao (meio do tratamento)", "hoursOffset": 168, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-cx-pre',
    'Cirurgico: pre-operatorio',
    true,
    'stage_entered',
    '{"stageId": "cx-pre-op"}'::jsonb,
    'create_task',
    '{"title": "Checklist de exames e documentacao pre-cirurgia", "hoursOffset": 24, "taskType": "follow_up"}'::jsonb
  ),
  (
    'auto-cx-pos',
    'Cirurgico: pos-operatorio',
    true,
    'stage_entered',
    '{"stageId": "cx-pos-op"}'::jsonb,
    'create_task',
    '{"title": "Primeiro contato pos-cirurgia (dor, curativo, duvidas)", "hoursOffset": 4, "taskType": "follow_up"}'::jsonb
  )
on conflict (id) do update set
  name = excluded.name,
  enabled = excluded.enabled,
  trigger_type = excluded.trigger_type,
  trigger_config = excluded.trigger_config,
  action_type = excluded.action_type,
  action_config = excluded.action_config;

insert into public.notification_rules (id, name, channel, enabled, trigger) values
  ('ntf-4', 'Tarefa de follow-up a vencer hoje', 'in_app', true, 'task_follow_up_due_today'),
  ('ntf-5', 'NPS enviado — aguarda registo de resposta', 'in_app', true, 'nps_dispatch_pending'),
  ('ntf-6', 'Lembrete: lead em triagem ha mais de 2h', 'in_app', true, 'triage_stale_2h')
on conflict (id) do update set
  name = excluded.name,
  channel = excluded.channel,
  enabled = excluded.enabled,
  trigger = excluded.trigger;

set session_replication_role = 'origin';
