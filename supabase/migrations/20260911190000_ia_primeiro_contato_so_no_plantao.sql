-- Primeiro contato da IA só no plantão (11/09/2026, pedido da clínica).
--
-- Desde 31/08 a IA fazia o primeiro atendimento mesmo dentro do turno da equipe, enquanto
-- nenhum humano tivesse falado na conversa. A clínica pediu o contrário: dentro do turno quem
-- abre a conversa é a equipe, e a IA só fica ativa de segunda a sexta das 18h às 8h (na
-- segunda, até as 7h) e do sábado ao meio-dia até segunda às 7h. Os follow-ups seguem como
-- estão (eles não passam por esta trava).
--
-- A regra de 31/08 vira chave, para dar para voltar pela tela sem mexer em código.

alter table public.crm_ai_configs
  add column if not exists ai_first_touch_in_team_hours boolean not null default true;

comment on column public.crm_ai_configs.ai_first_touch_in_team_hours is
  'Só vale com ai_offhours_only. true = dentro do turno a IA faz o primeiro atendimento até um humano falar (regra de 31/08/2026). false = dentro do turno a IA não abre conversa: não responde quem chega e a apresentação da fila de primeiro contato (formulário, landing) espera o fim do turno.';

-- Turno da clínica: segunda começa às 7h, o resto igual.
update public.crm_ai_configs
   set ai_first_touch_in_team_hours = false,
       ai_team_hours = '{"1":[["07:00","18:00"]],"2":[["08:00","18:00"]],"3":[["08:00","18:00"]],"4":[["08:00","18:00"]],"5":[["08:00","18:00"]],"6":[["08:00","12:00"]]}'::jsonb,
       updated_at = now()
 where tenant_id = 'instituto-lorena';
