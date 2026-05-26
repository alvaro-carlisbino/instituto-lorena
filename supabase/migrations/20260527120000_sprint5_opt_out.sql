-- =============================================================================
-- Sprint 5 — Opt-out de WhatsApp (guardrail anti-banimento)
-- =============================================================================
-- Adiciona coluna `leads.opted_out_at` e índice. Quando preenchida, é proibido
-- enviar qualquer mensagem outbound pra esse lead (humano OU IA). Edge functions
-- de envio devem checar esta flag antes de chamar ManyChat / Evolution.
--
-- O preenchimento é automático via detector de inbound: quando o paciente envia
-- "SAIR", "PARAR", "STOP", "CANCELAR", etc., o webhook chama um helper que
-- carimba `opted_out_at = now()` e registra um interaction explicativo.
--
-- Pra reativar (paciente pediu de volta): admin/gestor limpa via UI.
-- =============================================================================

alter table public.leads
  add column if not exists opted_out_at timestamptz null;

comment on column public.leads.opted_out_at is
  'Quando preenchido, lead optou por não receber mais mensagens. Edge functions de envio devem bloquear outbound. Atende LGPD art. 18 IV (revogação de consentimento).';

create index if not exists leads_opted_out_idx
  on public.leads(tenant_id)
  where opted_out_at is not null;

-- RPC pra marcar opt-out (chamada pelos webhooks). SECURITY DEFINER pra
-- service_role poder gravar; trigger de RLS continua respeitado.
create or replace function public.mark_lead_opted_out(
  p_lead_id text,
  p_reason text default 'inbound_opt_out_keyword'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_lead_id is null or length(trim(p_lead_id)) = 0 then
    return;
  end if;
  update public.leads
     set opted_out_at = now(),
         conversation_status = case
           when conversation_status in ('archived','closed') then conversation_status
           else 'archived'
         end
   where id = p_lead_id
     and opted_out_at is null;
end;
$$;

revoke all on function public.mark_lead_opted_out(text, text) from public;
grant execute on function public.mark_lead_opted_out(text, text) to service_role;
grant execute on function public.mark_lead_opted_out(text, text) to authenticated;

-- Reativar lead (admin/gestor após contato manual).
create or replace function public.clear_lead_opt_out(p_lead_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads
     set opted_out_at = null
   where id = p_lead_id
     and tenant_id = public.current_tenant_id();
end;
$$;

revoke all on function public.clear_lead_opt_out(text) from public;
grant execute on function public.clear_lead_opt_out(text) to authenticated;
