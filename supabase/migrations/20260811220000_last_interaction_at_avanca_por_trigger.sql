-- `leads.last_interaction_at` congelado: 1.759 cards com mensagem mais nova do que o
-- carimbo. O card do Álvaro no ManyChat marcava 27/jul enquanto recebia áudio no dia 11/ago.
--
-- A causa é que cada caminho de entrada carimba o campo por conta própria: os webhooks
-- W-API e WhatsApp atualizam, `crm-send-message` atualiza, mas o webhook do ManyChat só
-- carimba em alguns ramos (auto-reply e handoff), e os caminhos `ingest`/`record_outbound`
-- não tocam no campo. Quem lê (ficha do cliente, ordenação do Shosp, fila de "sem
-- resposta") acaba com uma verdade diferente da tabela de mensagens.
--
-- Carimbar em mais um lugar no código só adiciona mais um ponto para esquecer no próximo
-- caminho novo. A regra passa a viver ao lado do dado: qualquer interaction que entre,
-- por qualquer rota, empurra o carimbo do lead.
--
-- FORWARD-ONLY, igual a `_advance_last_inbound_at`: importação de histórico antigo e
-- backfill do Shosp inserem mensagens com `happened_at` no passado, e elas não podem
-- puxar o card para trás.
--
-- `channel = 'system'` fica de fora: nota de reposicionamento no quadro e aviso de lead
-- duplicado são registro interno, não conversa. Se contassem, todo card arrastado no
-- quadro pareceria ter acabado de falar com o paciente.

create or replace function public._advance_lead_last_interaction_at()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.channel, '') <> 'system' then
    update public.leads
       set last_interaction_at = new.happened_at,
           updated_at = now()
     where id = new.lead_id
       and (last_interaction_at is null or last_interaction_at < new.happened_at);
  end if;
  return new;
end;
$$;

drop trigger if exists interactions_advance_lead_last_interaction_at on public.interactions;
create trigger interactions_advance_lead_last_interaction_at
after insert on public.interactions
for each row
execute function public._advance_lead_last_interaction_at();

-- Backfill do atraso acumulado. Só avança (o `<` no where), então nenhum card anda para trás.
--
-- Verificado antes de rodar que isto não dispara mensagem para ninguém:
--   * `crm-followup-worker` dispara quando o carimbo está VELHO; empurrar para a frente
--     só reduz follow-up, nunca cria.
--   * `crm-dispatch-inbox` avisa a equipe sobre lead em `waiting_human` carimbado nas
--     últimas 4h — hoje seriam 0 cards, e mesmo assim é notificação interna, não WhatsApp.
-- `leads` tem o trigger `enforce_role_write()`, que barra escrita de quem não é
-- service_role — inclusive a conexão que roda esta migração. Sem a claim abaixo o
-- backfill morre com "forbidden: requires can_route_leads".
set local request.jwt.claims = '{"role":"service_role"}';

with ultima as (
  select lead_id, max(happened_at) as real_ultima
    from public.interactions
   where coalesce(channel, '') <> 'system'
   group by lead_id
)
update public.leads l
   set last_interaction_at = u.real_ultima
  from ultima u
 where l.id = u.lead_id
   and l.deleted_at is null
   and (l.last_interaction_at is null or l.last_interaction_at < u.real_ultima);
