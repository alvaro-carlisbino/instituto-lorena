import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Tenant default — usado quando o webhook não traz `tenant_slug` e nenhuma outra
 * via de identificação resolve. Configurável via env `FALLBACK_TENANT_ID` (default
 * `instituto-lorena` por compatibilidade com o cliente piloto). Quando vazio, a
 * resolução passa a exigir tenant explícito — qualquer webhook sem identificação
 * receberá `''` e a edge function deve falhar com erro claro.
 *
 * Para um deploy multi-cliente estrito: setar `FALLBACK_TENANT_ID=` (vazio) e
 * exigir que toda integração externa envie `tenant_slug`.
 */
export const DEFAULT_TENANT_ID = (Deno.env.get('FALLBACK_TENANT_ID') ?? 'instituto-lorena').trim()

async function tenantExists(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  if (!tenantId) return false
  const { data, error } = await admin
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .eq('active', true)
    .maybeSingle()
  if (error) {
    console.warn('[tenantResolve] check failed:', error.message)
    return false
  }
  return Boolean(data)
}

/**
 * Webhook ManyChat. O ManyChat External Request deve incluir `tenant_slug` no body —
 * cada clínica configura seu próprio valor (ex.: "clinica-x").
 *
 * Aliases aceitos: `tenant_slug`, `tenant_id`, `clinic_slug`, `clinic_id`.
 */
export async function resolveTenantFromManychatBody(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<string> {
  const raw =
    body.tenant_slug ??
    body.tenant_id ??
    body.clinic_slug ??
    body.clinic_id ??
    body.tenant ??
    null
  const candidate = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (candidate && (await tenantExists(admin, candidate))) return candidate
  if (candidate) {
    console.warn(`[tenantResolve] body tenant_slug "${candidate}" não existe — usando default`)
  }
  return DEFAULT_TENANT_ID
}

/**
 * Webhook WhatsApp Evolution. Cada `evolution_instance_name` está atrelado a um
 * tenant em `whatsapp_channel_instances.tenant_id`. Procuramos por essa associação
 * (busca por instance OU phone_e164, dependendo do payload).
 */
export async function resolveTenantFromEvolutionInstance(
  admin: SupabaseClient,
  evolutionInstanceName: string,
): Promise<string> {
  const name = evolutionInstanceName.trim()
  if (!name) return DEFAULT_TENANT_ID
  const { data } = await admin
    .from('whatsapp_channel_instances')
    .select('tenant_id')
    .eq('evolution_instance_name', name)
    .maybeSingle()
  const tid = (data as { tenant_id?: string | null } | null)?.tenant_id
  if (typeof tid === 'string' && tid.length > 0) return tid
  return DEFAULT_TENANT_ID
}

/**
 * Quando temos um leadId em mãos (ex.: crm-send-message), o tenant correto é
 * o do próprio lead — não há ambiguidade.
 */
export async function resolveTenantFromLead(
  admin: SupabaseClient,
  leadId: string,
): Promise<string> {
  if (!leadId) return DEFAULT_TENANT_ID
  const { data } = await admin
    .from('leads')
    .select('tenant_id')
    .eq('id', leadId)
    .maybeSingle()
  const tid = (data as { tenant_id?: string | null } | null)?.tenant_id
  if (typeof tid === 'string' && tid.length > 0) return tid
  return DEFAULT_TENANT_ID
}
