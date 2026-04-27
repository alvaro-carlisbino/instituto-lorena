-- Três funis padrão Lorena para testes com cliente (alinhado a src/mocks/crmMock.ts).
-- IDs de etapa são únicos globalmente (PK em pipeline_stages).
-- session_replication_role: desativa triggers enforce_role_write durante a migração (ligação sem JWT de app).

set session_replication_role = 'replica';

insert into public.pipelines (id, name, board_config) values
  (
    'pipeline-clinica',
    'Pipeline Clínica',
    '{"stageSlaMinutes": {"novo": 15, "triagem": 30, "contato": 60, "consulta": 120, "acompanhamento": 240, "fechado": 0}}'::jsonb
  ),
  (
    'pipeline-tratamento-capilar',
    'Pipeline TRATAMENTO CAPILAR',
    '{"stageSlaMinutes": {"tc-novo": 20, "tc-triagem": 45, "tc-avaliacao": 120, "tc-plano": 240, "tc-sessoes": 0, "tc-concluido": 0}}'::jsonb
  ),
  (
    'pipeline-processo-cirurgico',
    'PROCESSO CIRÚRGICO',
    '{"stageSlaMinutes": {"cx-entrada": 60, "cx-pre-op": 1440, "cx-cirurgia": 0, "cx-pos-op": 720, "cx-alta": 0}}'::jsonb
  )
on conflict (id) do update set
  name = excluded.name,
  board_config = excluded.board_config;

insert into public.pipeline_stages (id, pipeline_id, name, position) values
  ('novo', 'pipeline-clinica', 'Novo lead', 0),
  ('triagem', 'pipeline-clinica', 'Triagem', 1),
  ('contato', 'pipeline-clinica', 'Contato', 2),
  ('consulta', 'pipeline-clinica', 'Consulta agendada', 3),
  ('acompanhamento', 'pipeline-clinica', 'Acompanhamento', 4),
  ('fechado', 'pipeline-clinica', 'Encerrado', 5),
  ('tc-novo', 'pipeline-tratamento-capilar', 'Novo', 0),
  ('tc-triagem', 'pipeline-tratamento-capilar', 'Triagem e primeiros dados', 1),
  ('tc-avaliacao', 'pipeline-tratamento-capilar', 'Avaliação capilar', 2),
  ('tc-plano', 'pipeline-tratamento-capilar', 'Plano e orçamento', 3),
  ('tc-sessoes', 'pipeline-tratamento-capilar', 'Em tratamento (sessões)', 4),
  ('tc-concluido', 'pipeline-tratamento-capilar', 'Tratamento concluído (pré-cirúrgico)', 5),
  ('cx-entrada', 'pipeline-processo-cirurgico', 'Entrada (pós-tratamento capilar)', 0),
  ('cx-pre-op', 'pipeline-processo-cirurgico', 'Pré-operatório', 1),
  ('cx-cirurgia', 'pipeline-processo-cirurgico', 'Cirurgia', 2),
  ('cx-pos-op', 'pipeline-processo-cirurgico', 'Pós-operatório', 3),
  ('cx-alta', 'pipeline-processo-cirurgico', 'Alta / concluído', 4)
on conflict (id) do update set
  pipeline_id = excluded.pipeline_id,
  name = excluded.name,
  position = excluded.position;

set session_replication_role = 'origin';
