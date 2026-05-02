-- Facilita conversas em rajada: sem intervalo mínimo entre respostas IA por defeito.
-- Quem precisar de anti-spam pode definir min_seconds_between_ai_replies > 0 em crm_ai_configs.

alter table public.crm_ai_configs
  alter column min_seconds_between_ai_replies set default 0;

update public.crm_ai_configs
set
  min_seconds_between_ai_replies = 0,
  updated_at = now()
where id = 'default'
  and min_seconds_between_ai_replies in (10, 240);
