/**
 * Config LLM por tenant — lê `tenant_integrations.llm.<provider>` e cai para
 * os secrets globais (env vars) quando o tenant não tem override próprio.
 *
 * Estrutura esperada em `tenant_integrations.llm`:
 *   {
 *     zai:    { api_key?: string, model?: string, api_root?: string },
 *     openai: { api_key?: string, model?: string }
 *   }
 *
 * Tenants sem config preenchida (inclusive a Instituto Lorena hoje) continuam
 * funcionando porque os secrets globais seguem como fallback.
 */

type SupabaseClientLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>
      }
    }
  }
  rpc?: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
}

export type ZaiConfig = {
  apiKey: string
  apiRoot: string
  model: string
}

export type OpenAiConfig = {
  apiKey: string
  model: string
}

function normalizeApiRoot(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '')
  if (!trimmed || trimmed.includes('/coding/')) return 'https://api.z.ai/api/paas/v4'
  return trimmed
}

async function readTenantLlmProvider(
  admin: SupabaseClientLike,
  tenantId: string,
  provider: 'zai' | 'openai',
): Promise<Record<string, unknown>> {
  if (!tenantId) return {}
  try {
    const { data } = await admin
      .from('tenant_integrations')
      .select('llm')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const llm = (data as { llm?: unknown } | null)?.llm
    if (!llm || typeof llm !== 'object') return {}
    const provCfg = (llm as Record<string, unknown>)[provider]
    if (!provCfg || typeof provCfg !== 'object') return {}
    return provCfg as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Z.ai config: tenant override > env. Devolve null se nenhuma fonte tiver api_key. */
export async function readZaiConfigForTenant(
  admin: SupabaseClientLike,
  tenantId: string,
): Promise<ZaiConfig | null> {
  const envKey = (Deno.env.get('ZAI_API_KEY') ?? '').trim()
  const envRoot = normalizeApiRoot(Deno.env.get('ZAI_API_BASE') ?? '')
  const envModel = (Deno.env.get('ZAI_MODEL') ?? '').trim() || 'glm-4.7'

  const t = await readTenantLlmProvider(admin, tenantId, 'zai')
  const apiKey = String(t.api_key ?? envKey ?? '').trim()
  if (!apiKey) return null

  const apiRoot = t.api_root ? normalizeApiRoot(String(t.api_root)) : envRoot
  const model = String(t.model ?? envModel).trim() || 'glm-4.7'

  return { apiKey, apiRoot, model }
}

/** OpenAI config: tenant override > env. Devolve null se nenhuma fonte tiver api_key. */
export async function readOpenAiConfigForTenant(
  admin: SupabaseClientLike,
  tenantId: string,
): Promise<OpenAiConfig | null> {
  const envKey = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  const envModel = (Deno.env.get('OPENAI_MODEL') ?? '').trim() || 'gpt-4o-mini'

  const t = await readTenantLlmProvider(admin, tenantId, 'openai')
  const apiKey = String(t.api_key ?? envKey ?? '').trim()
  if (!apiKey) return null

  const model = String(t.model ?? envModel).trim() || 'gpt-4o-mini'

  return { apiKey, model }
}
