import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { EvolutionProvider } from './evolution.ts'
import type { WhatsappProvider } from './types.ts'

function envOrThrow(key: string): string {
  const v = (Deno.env.get(key) ?? '').trim()
  if (!v) throw new Error(`missing_env_${key}`)
  return v
}

export type WhatsappInstanceRow = {
  id: string
  evolution_instance_name: string
  meta_phone_number_id?: string | null
}

export async function loadWhatsappInstanceByEvolutionName(
  admin: SupabaseClient,
  evolutionInstanceName: string,
): Promise<WhatsappInstanceRow | null> {
  const name = evolutionInstanceName.trim()
  if (!name) return null
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select('id, evolution_instance_name, meta_phone_number_id')
    .eq('evolution_instance_name', name)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: String((data as { id: unknown }).id),
    evolution_instance_name: String((data as { evolution_instance_name: unknown }).evolution_instance_name),
    meta_phone_number_id: (data as { meta_phone_number_id?: string | null }).meta_phone_number_id ?? null,
  }
}

export async function loadWhatsappInstanceByMetaPhoneNumberId(
  admin: SupabaseClient,
  metaPhoneNumberId: string,
): Promise<WhatsappInstanceRow | null> {
  const id = metaPhoneNumberId.trim()
  if (!id) return null
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select('id, evolution_instance_name, meta_phone_number_id')
    .eq('meta_phone_number_id', id)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: String((data as { id: unknown }).id),
    evolution_instance_name: String((data as { evolution_instance_name: unknown }).evolution_instance_name),
    meta_phone_number_id: (data as { meta_phone_number_id?: string | null }).meta_phone_number_id ?? null,
  }
}

export async function loadDefaultWhatsappInstance(
  admin: SupabaseClient,
): Promise<WhatsappInstanceRow | null> {
  const { data, error } = await admin
    .from('whatsapp_channel_instances')
    .select('id, evolution_instance_name, meta_phone_number_id')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return {
    id: String((data as { id: unknown }).id),
    evolution_instance_name: String((data as { evolution_instance_name: unknown }).evolution_instance_name),
    meta_phone_number_id: (data as { meta_phone_number_id?: string | null }).meta_phone_number_id ?? null,
  }
}

/**
 * Picks the DB instance row: exact name match, else first active, else null.
 */
export async function resolveWhatsappInstanceRow(
  admin: SupabaseClient,
  evolutionInstanceName: string,
): Promise<WhatsappInstanceRow | null> {
  const fromName = await loadWhatsappInstanceByEvolutionName(admin, evolutionInstanceName)
  if (fromName) return fromName
  return loadDefaultWhatsappInstance(admin)
}

export async function resolveWhatsappInstanceRowForProvider(
  admin: SupabaseClient,
  options: { provider: string; evolutionInstanceName?: string; metaPhoneNumberId?: string },
): Promise<WhatsappInstanceRow | null> {
  const p = (options.provider || 'evolution').trim().toLowerCase()
  if (p === 'official') {
    const byMeta = await loadWhatsappInstanceByMetaPhoneNumberId(admin, options.metaPhoneNumberId ?? '')
    if (byMeta) return byMeta
    return loadDefaultWhatsappInstance(admin)
  }
  return resolveWhatsappInstanceRow(admin, options.evolutionInstanceName ?? '')
}

/**
 * Build Evolution API provider for a given instance name in DB (or env default).
 */
export function createEvolutionProviderForInstanceName(instanceName: string): WhatsappProvider {
  const baseUrl = envOrThrow('EVOLUTION_API_BASE').replace(/\/$/, '')
  const apiKey = envOrThrow('EVOLUTION_API_KEY')
  const fallback = (Deno.env.get('EVOLUTION_INSTANCE') ?? '').trim()
  const name = instanceName.trim() || fallback
  if (!name) throw new Error('missing_evolution_instance_name')
  return new EvolutionProvider({
    baseUrl,
    apiKey,
    instance: name,
    webhookSecret: (Deno.env.get('EVOLUTION_WEBHOOK_SECRET') ?? '').trim(),
  })
}

export function createEvolutionProviderFromEnv(): WhatsappProvider {
  return createEvolutionProviderForInstanceName((Deno.env.get('EVOLUTION_INSTANCE') ?? '').trim())
}

export async function getEvolutionProviderForLead(
  admin: SupabaseClient,
  leadWhatsappInstanceId: string | null,
): Promise<WhatsappProvider> {
  if (leadWhatsappInstanceId) {
    const { data } = await admin
      .from('whatsapp_channel_instances')
      .select('evolution_instance_name, active')
      .eq('id', leadWhatsappInstanceId)
      .maybeSingle()
    const row = data as { evolution_instance_name?: string; active?: boolean } | null
    if (row && row.active !== false && row.evolution_instance_name) {
      return createEvolutionProviderForInstanceName(String(row.evolution_instance_name))
    }
  }
  const def = await loadDefaultWhatsappInstance(admin)
  if (def) return createEvolutionProviderForInstanceName(def.evolution_instance_name)
  return createEvolutionProviderFromEnv()
}

export async function getOfficialProviderForLead(
  admin: SupabaseClient,
  leadWhatsappInstanceId: string | null,
): Promise<WhatsappProvider> {
  const { OfficialWhatsappProvider } = await import('./official.ts')
  if (leadWhatsappInstanceId) {
    const { data } = await admin
      .from('whatsapp_channel_instances')
      .select('meta_phone_number_id, active')
      .eq('id', leadWhatsappInstanceId)
      .maybeSingle()
    const row = data as { meta_phone_number_id?: string; active?: boolean } | null
    if (row && row.active !== false) {
      const pid = String(row.meta_phone_number_id ?? '').trim()
      if (pid) return new OfficialWhatsappProvider({ phoneNumberId: pid })
    }
  }
  const def = await loadDefaultWhatsappInstance(admin)
  if (def?.meta_phone_number_id && String(def.meta_phone_number_id).trim()) {
    return new OfficialWhatsappProvider({ phoneNumberId: String(def.meta_phone_number_id).trim() })
  }
  return new OfficialWhatsappProvider()
}

export async function getWhatsappProviderForEvent(
  admin: SupabaseClient,
  options: { evolutionInstanceName: string; provider: string; metaPhoneNumberId?: string },
): Promise<WhatsappProvider> {
  const p = (options.provider || 'evolution').trim().toLowerCase()
  if (p === 'official') {
    const { OfficialWhatsappProvider } = await import('./official.ts')
    const mid = (options.metaPhoneNumberId ?? '').trim()
    if (mid) {
      const row = await loadWhatsappInstanceByMetaPhoneNumberId(admin, mid)
      const pid = String(row?.meta_phone_number_id ?? mid).trim()
      return new OfficialWhatsappProvider({ phoneNumberId: pid })
    }
    return new OfficialWhatsappProvider()
  }
  const row = await resolveWhatsappInstanceRow(admin, options.evolutionInstanceName)
  if (row) return createEvolutionProviderForInstanceName(row.evolution_instance_name)
  return createEvolutionProviderFromEnv()
}
