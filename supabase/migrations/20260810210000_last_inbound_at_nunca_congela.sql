-- `crm_conversation_states.last_inbound_at` congelava e a conversa virava um morto-vivo:
-- a mensagem entrava, mas a rede de segurança do `crm-ai-burst-flush` (passo 2, cron de
-- 2 min) achava que já tinha respondido e nunca retentava.
--
-- Mecanismo: `acquireAiReplyLock` grava a trava `ai_reply_lock_until` no registro ANTES de
-- `last_inbound_at` avançar, e os caminhos de falha da IA (429 do z.ai, resposta vazia com
-- finish_reason=length, invocação morta no wall-clock da Edge) saem sem gravar. Como o passo
-- 2 compara as COLUNAS DO ESTADO (`last_ai_reply_at > last_inbound_at`) em vez das
-- interactions reais, o lead ficava mudo para sempre. Medido em 10/ago/2026: 25+ conversas
-- assim, a pior com 861 horas de defasagem (estado dizia 29/jun, mensagem real de 04/ago).
--
-- Conserto no BANCO de propósito: são 3 webhooks (wapi, whatsapp, manychat) mais o próprio
-- burst-flush escrevendo esse campo. Remendar caminho por caminho deixa o próximo de fora.
-- Aqui o invariante vale para qualquer origem, inclusive falha no meio da resposta.
--
-- FORWARD-ONLY, de propósito. Só mexe em inbound NOVO. As conversas já congeladas continuam
-- como estão até a pessoa escrever de novo, e aí são atendidas certo. Consertar pelo lado da
-- leitura (o passo 2 olhar as interactions reais) destravaria 93 conversas de uma vez, 89
-- delas paradas há mais de 7 dias e a pior há 77 dias. Isso é rajada, queima o número e vai
-- contra a regra de 20-30/dia com jitter. Fica como decisão de reengajamento, não como efeito
-- colateral de deploy.

create or replace function public._advance_last_inbound_at()
returns trigger
language plpgsql
as $function$
begin
  if new.direction = 'in' and new.channel in ('whatsapp', 'meta') then
    -- Só UPDATE, nunca INSERT. Lead sem linha de estado hoje é invisível para a rede de
    -- segurança, e criar a linha aqui o tornaria elegível a resposta automática que ele
    -- nunca teve. Ausência de estado já significa auto/ai_enabled na leitura do gate.
    --
    -- greatest() porque o caminho normal do webhook também grava este campo: mensagem que
    -- chega fora de ordem não pode puxar o relógio para trás.
    update public.crm_conversation_states
       set last_inbound_at = greatest(
             coalesce(last_inbound_at, new.happened_at),
             new.happened_at
           ),
           updated_at = now()
     where lead_id = new.lead_id
       and (last_inbound_at is null or last_inbound_at < new.happened_at);
  end if;
  return new;
end;
$function$;

comment on function public._advance_last_inbound_at() is
  'Garante que toda mensagem recebida avance last_inbound_at, mesmo se a IA falhar depois.';

drop trigger if exists interactions_advance_last_inbound_at on public.interactions;
create trigger interactions_advance_last_inbound_at
  after insert on public.interactions
  for each row
  execute function public._advance_last_inbound_at();
