-- IA SÓ FORA DO HORÁRIO DA EQUIPE (24/ago/2026)
--
-- Medição de 23/08: entre 18h e 8h saíram 1.034 mensagens da IA da clínica contra 39 da
-- equipe, e de 19h às 7h a automação era 100% da saída. Não era configuração — era ausência
-- de trava: `owner_mode` 'ai'/'auto' respondia 24h e a antiga regra de horário comercial já
-- não existia no código.
--
-- Agora a janela é explícita e vale ao contrário do nome antigo: DENTRO dela quem atende é a
-- equipe (a IA cala e o vigia cobra quem tem de responder); FORA dela a IA assume o plantão.
--
-- `business_hours_start/end` NÃO servem para isto e ficam como estão: são a janela que
-- `find_first_appointment_slot` usa para sugerir horário de consulta (na clínica está
-- 08:00–23:59, que como turno de gente não faz sentido nenhum).
alter table public.crm_ai_configs
  add column if not exists ai_offhours_only boolean not null default false,
  add column if not exists ai_team_hours jsonb not null default
    '{"1":[["08:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]],"6":[["08:00","12:00"]]}'::jsonb;

comment on column public.crm_ai_configs.ai_offhours_only is
  'true = a IA só responde FORA de ai_team_hours (dentro da janela quem atende é a equipe). Vale para owner_mode ai e auto; human continua mudo sempre.';

comment on column public.crm_ai_configs.ai_team_hours is
  'Turno da equipe, fuso America/Sao_Paulo. Dia da semana 0=domingo..6=sábado -> lista de intervalos ["HH:MM","HH:MM"], fim exclusivo. Dia ausente = ninguém atende (a IA cobre o dia todo).';

-- Só a CLÍNICA liga a trava. O bot de vendas do Tricopill continua respondendo 24h: ele
-- vende, não faz plantão de atendimento, e calar-lho no horário comercial seria perder venda.
update public.crm_ai_configs
   set ai_offhours_only = true,
       ai_team_hours = '{"1":[["08:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]],"6":[["08:00","12:00"]]}'::jsonb,
       updated_at = now()
 where tenant_id = 'instituto-lorena'
   and id = 'default';
