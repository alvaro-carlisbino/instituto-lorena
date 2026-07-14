-- Garante 1 lead por formulário da Meta (leadgen_id): duas execuções concorrentes
-- da varredura/recuperação de Lead Ads criaram 13 leads duplicados em 13/jul
-- (upsertLeadByPhone é checa-depois-insere, sem trava). O índice único faz o
-- segundo insert do mesmo leadgen falhar em vez de duplicar; a varredura registra
-- upsert_failed e segue (não reprocessa, pois o leadgen já tem status lead_%).
-- Já aplicado em produção em 14/jul/2026 via Management API.
create unique index if not exists leads_leadform_leadgen_uniq
  on leads ((custom_fields -> 'lead_form' ->> 'leadgen_id'))
  where custom_fields -> 'lead_form' ->> 'leadgen_id' is not null;
