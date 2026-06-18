-- Trava por-lead da resposta da IA (anti resposta/cobrança dupla).
-- Dois flushes concorrentes do mesmo lead (z.ai lento + cliente manda 2 msgs) geravam
-- resposta e cobrança duplicadas (caso Debora 18/jun: 2 Pix R$594 com 23s). A coluna é um
-- lease: enquanto ai_reply_lock_until > now() há uma resposta em curso e os demais flushes
-- desistem; é liberada (null) ao concluir. Lease ~150s no código cobre a duração do z.ai.
ALTER TABLE public.crm_conversation_states
  ADD COLUMN IF NOT EXISTS ai_reply_lock_until timestamptz;

COMMENT ON COLUMN public.crm_conversation_states.ai_reply_lock_until IS
  'Trava por-lead da resposta da IA: enquanto > now(), há uma resposta em curso; flushes concorrentes desistem. Lease ~150s cobre a duração do z.ai; liberada (null) ao concluir.';
