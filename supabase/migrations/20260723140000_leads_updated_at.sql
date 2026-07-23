-- leads.updated_at NUNCA existiu no schema, mas ~25 chamadas `.from('leads').update({ ... updated_at })`
-- espalhadas pelas edge functions mandam a coluna no payload. O PostgREST rejeita o payload INTEIRO
-- (400 PGRST204 "Could not find the 'updated_at' column of 'leads' in the schema cache") e nenhuma
-- das outras colunas é gravada. Como o resultado do `.update()` não é conferido em lugar nenhum, a
-- falha é 100% silenciosa.
--
-- Efeito em produção (22-23/jul/2026): o paciente escolhe a opção 1-5 da triagem, a Sofia confirma,
-- mas o lead NUNCA sai de "Novo lead" — logo toda repetição da opção re-dispara a mesma mensagem
-- (caso Aline 22/jul, ack duplicado) e a equipa vê o quadro mentindo. Mesma causa derruba
-- disableAiOnHandoff (stage de handoff), crm-confirm-sale (stage pago), shospSync (stage da agenda),
-- conversation_status='ai_triaging' e last_interaction_at nos webhooks.
--
-- Fix: criar a coluna de verdade (uma mudança conserta todos os call sites de uma vez, inclusive os
-- de outros repos) e carimbá-la por trigger, para o valor ser real e não depender de quem escreve.

alter table public.leads
  add column if not exists updated_at timestamptz not null default now();

-- Backfill honesto: sem histórico real, o melhor proxy é a última interação (ou a criação).
-- `enforce_role_write` exige service_role para DML em leads; a migration roda como postgres.
set local request.jwt.claims = '{"role":"service_role"}';

update public.leads
set updated_at = coalesce(last_interaction_at, created_at)
where updated_at is distinct from coalesce(last_interaction_at, created_at);

create or replace function public._stamp_lead_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists leads_stamp_updated_at on public.leads;
create trigger leads_stamp_updated_at
  before update on public.leads
  for each row execute function public._stamp_lead_updated_at();

-- Sem isto o PostgREST segue com o schema cache antigo e continua devolvendo PGRST204.
notify pgrst, 'reload schema';
