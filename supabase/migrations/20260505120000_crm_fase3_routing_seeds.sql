-- Fase 3: consulta realizada (status), roteamento configurável, seeds de mensagens rápidas e follow-up

-- Tabela antiga pode existir sem a coluna shortcut (create table if not exists não altera schema)
do $sync$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_quick_messages' and column_name = 'title'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_quick_messages' and column_name = 'shortcut'
  ) then
    alter table public.crm_quick_messages rename column title to shortcut;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crm_quick_messages' and column_name = 'shortcut'
  ) then
    alter table public.crm_quick_messages add column shortcut text;
    update public.crm_quick_messages set shortcut = ('legacy-' || replace(id::text, '-', '')) where shortcut is null;
    alter table public.crm_quick_messages alter column shortcut set not null;
  end if;
end
$sync$;

alter table public.crm_quick_messages add column if not exists category text;
alter table public.crm_quick_messages add column if not exists sort_order int default 0;
alter table public.crm_quick_messages add column if not exists content text;

alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('draft', 'confirmed', 'cancelled', 'completed'));

alter table public.org_settings add column if not exists appointment_completed_routing jsonb not null default '{
  "sourcePipelineId": "pipeline-clinica",
  "targetPipelineId": "pipeline-tratamento-capilar",
  "targetStageId": "tc-novo"
}'::jsonb;

update public.org_settings
set appointment_completed_routing = '{
  "sourcePipelineId": "pipeline-clinica",
  "targetPipelineId": "pipeline-tratamento-capilar",
  "targetStageId": "tc-novo"
}'::jsonb
where id = 'default'
  and (appointment_completed_routing is null or appointment_completed_routing = '{}'::jsonb);

create unique index if not exists crm_quick_messages_shortcut_uidx on public.crm_quick_messages (shortcut);

insert into public.crm_quick_messages (shortcut, content, category, sort_order)
select v.shortcut, v.content, v.category, v.sort_order
from (
  values
    ('ola', 'Olá! Tudo bem? Sou da equipe do Instituto Lorena.', 'saudação', 0),
    ('horario', 'Nosso horário de atendimento é de segunda a sexta, das 8h às 18h.', 'agenda', 1),
    ('agradecer', 'Muito obrigado pelo contato! Estamos à disposição.', 'fechamento', 2),
    ('agendar', 'Posso te ajudar a encontrar um horário para avaliação?', 'agenda', 3),
    ('endereco', 'Posso enviar o link com a localização da clínica?', 'info', 4)
) as v(shortcut, content, category, sort_order)
where not exists (select 1 from public.crm_quick_messages q where q.shortcut = v.shortcut);

create unique index if not exists crm_followup_configs_pipeline_day_uidx
  on public.crm_followup_configs (pipeline_id, day_number);

insert into public.crm_followup_configs (pipeline_id, day_number, message_template, enabled)
select v.pipeline_id, v.day_number, v.message_template, v.enabled
from (
  values
    ('pipeline-clinica', 1, '{{name}}, passando para saber se conseguiu ver nossa mensagem. Podemos ajudar com alguma dúvida?', true::boolean),
    ('pipeline-clinica', 3, 'Oi {{name}}, ainda estamos à disposição aqui no Instituto Lorena. Quando puder, responda e seguimos o atendimento.', true),
    ('pipeline-clinica', 5, '{{name}}, último retorno: caso não tenha interesse no momento, avise para encerrarmos por aqui. Obrigado!', true),
    ('pipeline-tratamento-capilar', 1, '{{name}}, como está o tratamento? Precisa de algo da equipe?', true),
    ('pipeline-tratamento-capilar', 3, '{{name}}, quer agendar retorno ou tirar dúvidas sobre o protocolo?', true),
    ('pipeline-tratamento-capilar', 5, '{{name}}, seguimos disponíveis. Responda quando puder.', true),
    ('pipeline-processo-cirurgico', 1, '{{name}}, tudo certo com os próximos passos do processo?', true),
    ('pipeline-processo-cirurgico', 3, '{{name}}, precisa de ajuda com documentação ou datas?', true),
    ('pipeline-processo-cirurgico', 5, '{{name}}, estamos à disposição para concluir seu processo.', true)
) as v(pipeline_id, day_number, message_template, enabled)
where not exists (
  select 1 from public.crm_followup_configs c
  where c.pipeline_id = v.pipeline_id and c.day_number = v.day_number
);
