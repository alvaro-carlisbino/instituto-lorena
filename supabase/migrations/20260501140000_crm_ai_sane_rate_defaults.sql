-- Corrige limites iniciais muito agressivos (2 respostas IA/hora global e 240s entre respostas),
-- que bloqueavam triagens com várias mensagens do mesmo paciente.

alter table public.crm_ai_configs
  alter column max_ai_replies_per_hour set default 400;

alter table public.crm_ai_configs
  alter column min_seconds_between_ai_replies set default 10;

-- Só ajusta linhas que ainda têm os defaults legados da migração 20260427105000.
update public.crm_ai_configs
set
  max_ai_replies_per_hour = 400,
  min_seconds_between_ai_replies = 10,
  updated_at = now()
where id = 'default'
  and max_ai_replies_per_hour <= 5
  and min_seconds_between_ai_replies >= 120;
