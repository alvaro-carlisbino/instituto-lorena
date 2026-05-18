import { supabase } from '@/lib/supabaseClient'

export type TenantBrand = {
  app_name: string
  logo_url: string | null
  primary_color: string
  accent_color: string
  support_phone: string | null
  support_email: string | null
}

export type Tenant = {
  id: string
  name: string
  brand: TenantBrand
  active: boolean
}

/**
 * Branding default — usado enquanto a migration `tenants` da Fase 0 não estiver aplicada,
 * ou enquanto o app está rodando sem Supabase configurado (modo mock).
 */
export const DEFAULT_TENANT: Tenant = {
  id: 'instituto-lorena',
  name: 'Instituto Lorena Visentainer',
  brand: {
    app_name: 'Instituto Lorena CRM',
    logo_url: null,
    primary_color: '#0ea5e9',
    accent_color: '#22d3ee',
    support_phone: null,
    support_email: null,
  },
  active: true,
}

function normalizeBrand(raw: unknown): TenantBrand {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    app_name: typeof obj.app_name === 'string' && obj.app_name.trim() ? obj.app_name : DEFAULT_TENANT.brand.app_name,
    logo_url: typeof obj.logo_url === 'string' && obj.logo_url.trim() ? obj.logo_url : null,
    primary_color: typeof obj.primary_color === 'string' && obj.primary_color.trim()
      ? obj.primary_color
      : DEFAULT_TENANT.brand.primary_color,
    accent_color: typeof obj.accent_color === 'string' && obj.accent_color.trim()
      ? obj.accent_color
      : DEFAULT_TENANT.brand.accent_color,
    support_phone: typeof obj.support_phone === 'string' && obj.support_phone.trim() ? obj.support_phone : null,
    support_email: typeof obj.support_email === 'string' && obj.support_email.trim() ? obj.support_email : null,
  }
}

/**
 * Carrega o tenant do usuário logado. Estratégia:
 * 1) Chama `current_tenant_id()` RPC (criada na Fase 0). Devolve o slug do tenant.
 * 2) Faz `select * from tenants where id = ?`. RLS já restringe ao próprio tenant.
 *
 * Falhas comuns toleradas — devolvem `DEFAULT_TENANT`:
 *  - Migration da Fase 0 ainda não aplicada (tabela/função inexistente)
 *  - Usuário sem `app_users.tenant_id` (não logado, ou conta nova ainda sem registro)
 *  - Modo mock (sem Supabase)
 */
export async function fetchCurrentTenant(): Promise<Tenant> {
  if (!supabase) return DEFAULT_TENANT
  try {
    const { data: tenantIdData, error: rpcErr } = await supabase.rpc('current_tenant_id')
    if (rpcErr) {
      // RPC inexistente (Fase 0 ainda não aplicada) ou usuário sem sessão.
      console.warn('[tenant] current_tenant_id RPC failed, using default:', rpcErr.message)
      return DEFAULT_TENANT
    }
    const tenantId = typeof tenantIdData === 'string' ? tenantIdData.trim() : ''
    if (!tenantId) return DEFAULT_TENANT

    const { data, error } = await supabase
      .from('tenants')
      .select('id, name, brand_config, active')
      .eq('id', tenantId)
      .maybeSingle()
    if (error || !data) {
      console.warn('[tenant] tenants row not found, using default. id=%s err=%s', tenantId, error?.message)
      return DEFAULT_TENANT
    }
    return {
      id: String(data.id),
      name: String(data.name),
      brand: normalizeBrand(data.brand_config),
      active: Boolean(data.active),
    }
  } catch (e) {
    console.warn('[tenant] fetch failed, using default:', e instanceof Error ? e.message : String(e))
    return DEFAULT_TENANT
  }
}

/** Aplica as cores do tenant ao :root via CSS vars para que tailwind/tema consumam. */
export function applyTenantBrandToCssVars(brand: TenantBrand) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.style.setProperty('--tenant-primary', brand.primary_color)
  root.style.setProperty('--tenant-accent', brand.accent_color)
  // Atualiza o <title> do documento para refletir a marca do tenant.
  document.title = brand.app_name
}

export type TenantIntegrations = {
  manychat: {
    api_key?: string
    instagram?: { field_id?: number; flow_ns?: string; message_tag?: string }
    whatsapp?: { field_id?: number; flow_ns?: string; message_tag?: string }
  }
  evolution: Record<string, unknown>
}

/** Lê todos os tenants visíveis (super_admin vê todos; usuários comuns só o próprio). */
export async function fetchAllTenants(): Promise<Tenant[]> {
  if (!supabase) return [DEFAULT_TENANT]
  const { data, error } = await supabase
    .from('tenants')
    .select('id, name, brand_config, active')
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    brand: normalizeBrand(row.brand_config),
    active: Boolean(row.active),
  }))
}

/** Cria uma nova clínica. RLS exige super_admin. Aciona `seed_tenant_defaults` em seguida. */
export async function createTenant(payload: {
  id: string
  name: string
  brand: TenantBrand
  seedFromTemplate?: boolean
}): Promise<Tenant> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const slug = payload.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!slug) throw new Error('Slug inválido.')

  const { data, error } = await supabase
    .from('tenants')
    .insert({
      id: slug,
      name: payload.name.trim(),
      brand_config: payload.brand,
      active: true,
    })
    .select('id, name, brand_config, active')
    .single()
  if (error) throw new Error(error.message)

  if (payload.seedFromTemplate !== false) {
    const { error: seedErr } = await supabase.rpc('seed_tenant_defaults', {
      p_new_tenant_id: slug,
      p_template_tenant_id: 'instituto-lorena',
    })
    if (seedErr) {
      console.warn('[tenant] seed_tenant_defaults falhou (tenant criado, mas sem template):', seedErr.message)
    }
  }

  return {
    id: String(data.id),
    name: String(data.name),
    brand: normalizeBrand(data.brand_config),
    active: Boolean(data.active),
  }
}

/** Atualiza a marca de um tenant. RLS exige super_admin. */
export async function updateTenantBrand(tenantId: string, brand: TenantBrand): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { error } = await supabase
    .from('tenants')
    .update({ brand_config: brand })
    .eq('id', tenantId)
  if (error) throw new Error(error.message)
}

/** Lê a config de integrações (ManyChat/Evolution) de um tenant. */
export async function fetchTenantIntegrations(tenantId: string): Promise<TenantIntegrations> {
  if (!supabase) return { manychat: {}, evolution: {} }
  const { data, error } = await supabase
    .from('tenant_integrations')
    .select('manychat, evolution')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = (data ?? {}) as { manychat?: unknown; evolution?: unknown }
  return {
    manychat: (row.manychat && typeof row.manychat === 'object'
      ? (row.manychat as TenantIntegrations['manychat'])
      : {}),
    evolution: (row.evolution && typeof row.evolution === 'object'
      ? (row.evolution as Record<string, unknown>)
      : {}),
  }
}

export async function updateTenantIntegrations(
  tenantId: string,
  patch: Partial<TenantIntegrations>,
): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const current = await fetchTenantIntegrations(tenantId)
  const next = {
    manychat: { ...current.manychat, ...(patch.manychat ?? {}) },
    evolution: { ...current.evolution, ...(patch.evolution ?? {}) },
  }
  const { error } = await supabase
    .from('tenant_integrations')
    .upsert({ tenant_id: tenantId, ...next })
  if (error) throw new Error(error.message)
}

/** Indica se o usuário logado é super_admin (pode gerenciar tenants). */
export async function fetchIsSuperAdmin(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data, error } = await supabase.rpc('is_super_admin')
    if (error) return false
    return Boolean(data)
  } catch {
    return false
  }
}
