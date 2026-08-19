-- ─────────────────────────────────────────────────────────────────────────────
-- O motivo de a fila ter esvaziado de uma vez
--
-- A fila de pós-consulta, que fica na aba ao lado, já pergunta o motivo ao zerar
-- ("Backlog anterior ao início da fila") e guarda com a data. As filas de venda
-- nasceram sem isso: quem abrir daqui a seis meses e vir 71 vendas fora da fila
-- ia achar data e usuário, e nenhuma linha dizendo por quê.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clinic_sales
  add column if not exists no_date_dismissed_reason    text,
  add column if not exists no_patient_dismissed_reason text;

comment on column public.clinic_sales.no_date_dismissed_reason is
  'Por que esta venda saiu da fila "sem data". Fica com no_date_dismissed_at/_by.';
comment on column public.clinic_sales.no_patient_dismissed_reason is
  'Por que esta venda saiu da fila "sem paciente". Fica com no_patient_dismissed_at/_by.';

-- Mesmo gatilho de antes, agora limpando o motivo junto: pendência que volta a
-- existir volta limpa, sem carregar a justificativa de uma decisão antiga.
create or replace function public.clinic_sales_reabre_pendencia()
returns trigger language plpgsql as $$
begin
  if new.scheduled_at is not null and old.scheduled_at is null then
    new.no_date_dismissed_at := null;
    new.no_date_dismissed_by := null;
    new.no_date_dismissed_reason := null;
  end if;
  if new.lead_id is not null and old.lead_id is null then
    new.no_patient_dismissed_at := null;
    new.no_patient_dismissed_by := null;
    new.no_patient_dismissed_reason := null;
  end if;
  return new;
end $$;
