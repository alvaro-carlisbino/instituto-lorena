-- Atribuição de campanha (Meta Ads) por lead.
--
-- Captura de qual anúncio/campanha veio o lead nos anúncios de conversa
-- (Click-to-WhatsApp / Click-to-Instagram) e, futuramente, nos Lead Ads.
-- Tudo nullable e aditivo — leads existentes seguem sem atribuição.
--
-- `attribution` (jsonb): bloco bruto do anúncio (headline, body, source_url,
--   ctwa_clid, etc.), para auditoria/enriquecimento futuro via Graph API.
-- `attribution_channel`: ctwa_whatsapp | ctwa_instagram | lead_ads
-- `attribution_campaign` / `attribution_ad_id`: indexados, base para o
--   agrupamento "leads por campanha" no dashboard.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS attribution           jsonb,
  ADD COLUMN IF NOT EXISTS attribution_channel   text,
  ADD COLUMN IF NOT EXISTS attribution_campaign  text,
  ADD COLUMN IF NOT EXISTS attribution_ad_id     text;

CREATE INDEX IF NOT EXISTS idx_leads_attribution_campaign
  ON leads (attribution_campaign)
  WHERE attribution_campaign IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_attribution_ad_id
  ON leads (attribution_ad_id)
  WHERE attribution_ad_id IS NOT NULL;

COMMENT ON COLUMN leads.attribution IS 'Bloco bruto de atribuição do anúncio Meta (referral CTWA ou Lead Ads).';
COMMENT ON COLUMN leads.attribution_channel IS 'Superfície de origem: ctwa_whatsapp | ctwa_instagram | lead_ads.';
COMMENT ON COLUMN leads.attribution_campaign IS 'Campanha de origem (quando disponível). Indexada para agrupar leads por campanha.';
COMMENT ON COLUMN leads.attribution_ad_id IS 'ID do anúncio Meta de origem. Indexado.';
