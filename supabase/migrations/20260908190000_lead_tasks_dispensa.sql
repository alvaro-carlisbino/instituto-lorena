-- Follow-up automático dispensado: a tarefa continua existindo, o que sai é a COBRANÇA.
--
-- 08/set/2026. O sino do cabeçalho mostrava "99+" desde sempre e a equipe pediu para zerar.
-- O número não era fila de gente: das 2.881 tarefas abertas, 2.874 estavam ATRASADAS e
-- nenhuma jamais foi concluída (status='done' era zero em toda a tabela). Elas nascem
-- sozinhas em `automation_rules` do tipo `stage_entered` — todo lead que entra numa etapa
-- do funil ganha uma tarefa com prazo de 2h a 48h — e ninguém trabalha pela tela /tarefas.
-- Resultado: as ~10 pessoas realmente esperando resposta ficavam enterradas embaixo de
-- 2.874 lembretes de maio, e o sino virou papel de parede.
--
-- Mesmo padrão de `clinic_sales.no_date_dismissed_*` e `lead_followups.dismissed_*`:
-- nada é apagado, a dispensa carimba quem/quando/por quê, é por linha e é reversível.
alter table public.lead_tasks
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by text,
  add column if not exists dismissed_reason text;

comment on column public.lead_tasks.dismissed_at is
  'Quando a tarefa saiu da cobrança (sino e abas de atrasadas). Null = continua cobrando. A tarefa NÃO é apagada nem concluída.';
comment on column public.lead_tasks.dismissed_by is
  'auth.users.id de quem dispensou. Null quando a dispensa veio por carga em lote.';
comment on column public.lead_tasks.dismissed_reason is
  'Motivo escrito na hora de dispensar, para quem for ler pendência histórica depois.';

-- O boot do CRM lê esta tabela sem limite e esbarrava no teto de 1.000 linhas do PostgREST
-- com tarefa morta. O índice serve o filtro que passa a valer em toda cobrança.
create index if not exists lead_tasks_cobranca_idx
  on public.lead_tasks (tenant_id, due_at)
  where status = 'open' and dismissed_at is null;
