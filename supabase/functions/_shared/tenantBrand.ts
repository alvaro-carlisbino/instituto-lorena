/**
 * Marca por polo — a fonte ÚNICA do que o cliente vê com o nome de uma das duas
 * empresas: domínio do link de pagamento, remetente de e-mail e site público.
 *
 * POR QUE ISSO EXISTE: até 11/ago/26 o link de pagamento vinha de uma constante
 * global (`APP_BASE_URL`, default `https://instituto-lorena.vercel.app`) e do
 * `window.location.origin` do operador. Resultado: as 174 cobranças do Tricopill
 * foram enviadas ao cliente como `instituto-lorena.vercel.app/pagar/<id>` — a marca
 * errada, num domínio interno, com o título "Instituto Lorena CRM · INTERNO" na aba.
 * O caminho inverso também vazava: o e-mail da clínica saía assinado como Tricopill.
 *
 * REGRA: nada aqui cai para o outro polo. Marca não configurada => ERRO (link) ou
 * canal desligado (e-mail). Mandar com a marca errada é pior que não mandar, porque
 * o cliente não confia e a venda morre no clique.
 *
 * Config em `tenants.brand_config`:
 *   {
 *     app_name:          "Tricopill",
 *     checkout_base_url: "https://pagar.tricopill.com.br",   // base do /pagar/<id>
 *     site_url:          "https://tricopill.com.br",         // site público da marca
 *     email_from:        "Tricopill <contato@tricopill.com.br>",  // null => e-mail off
 *     support_phone:     "+5544999067665"
 *   }
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Forma mínima que este módulo usa do client. `maybeSingle()` do supabase-js devolve um
 * PostgrestBuilder (thenable, não Promise), daí `PromiseLike`.
 *
 * O parâmetro público é o `SupabaseClient` real, não esta forma estrutural: casar a
 * tipagem genérica profunda do client contra um shape solto estoura o TS2589
 * ("type instantiation excessively deep") assim que o grafo de imports cresce. O teste
 * passa um duble com `as unknown as SupabaseClient`.
 */
type BrandQueryClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>
      }
    }
  }
}

export type TenantBrand = {
  tenantId: string
  appName: string
  /** Base pública do link que o CLIENTE recebe (`/pagar/<id>`). Sem barra final. */
  checkoutBaseUrl: string
  /** Site público da marca. Sem barra final. Vazio quando não configurado. */
  siteUrl: string
  /** Remetente dos e-mails ao cliente ("Nome <a@dominio>"). Vazio => canal desligado. */
  emailFrom: string
  supportPhone: string
}

/** Cache por isolate: a marca muda em deploy/config, não a cada requisição. */
const cache = new Map<string, TenantBrand>()

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function noTrailingSlash(v: string): string {
  return v.replace(/\/+$/, '')
}

/**
 * Lê a marca do polo. Nunca devolve dado do outro polo: campo ausente vem vazio,
 * e quem depende dele decide entre falhar (link de pagamento) ou desligar (e-mail).
 */
export async function getTenantBrand(admin: SupabaseClient, tenantId: string): Promise<TenantBrand> {
  const id = str(tenantId)
  if (!id) throw new Error('marca_sem_tenant')
  const hit = cache.get(id)
  if (hit) return hit

  // `as unknown as` de propósito: o cast direto faz o TS comparar a tipagem genérica
  // profunda do client com o shape mínimo e estourar TS2589.
  const q = admin as unknown as BrandQueryClient
  const { data, error } = await q.from('tenants').select('brand_config').eq('id', id).maybeSingle()
  if (error) {
    const msg = (error as { message?: string }).message ?? String(error)
    throw new Error(`marca_leitura_falhou:${id}:${msg}`)
  }
  const cfg = ((data as { brand_config?: Record<string, unknown> } | null)?.brand_config ?? {}) as Record<string, unknown>

  const brand: TenantBrand = {
    tenantId: id,
    appName: str(cfg.app_name) || id,
    checkoutBaseUrl: noTrailingSlash(str(cfg.checkout_base_url)),
    siteUrl: noTrailingSlash(str(cfg.site_url)),
    emailFrom: str(cfg.email_from),
    supportPhone: str(cfg.support_phone),
  }
  cache.set(id, brand)
  return brand
}

/**
 * Base do link de pagamento do polo. Estoura se não estiver configurada — é
 * exatamente o caso em que mandar o link errado custa a venda e mistura as marcas.
 * O operador vê o erro no painel e a IA não envia link nenhum.
 */
export async function getCheckoutBaseUrl(admin: SupabaseClient, tenantId: string): Promise<string> {
  const brand = await getTenantBrand(admin, tenantId)
  if (!brand.checkoutBaseUrl) {
    throw new Error(
      `marca_sem_checkout_base_url:${brand.tenantId} — configure tenants.brand_config.checkout_base_url deste polo`,
    )
  }
  return brand.checkoutBaseUrl
}

/** URL completa do checkout da cobrança, no domínio do polo dono dela. */
export async function buildCheckoutUrl(
  admin: SupabaseClient,
  tenantId: string,
  intentId: string,
): Promise<string> {
  const base = await getCheckoutBaseUrl(admin, tenantId)
  return `${base}/pagar/${intentId}`
}

/**
 * Remetente do polo. Vazio => o chamador NÃO deve enviar: um e-mail da clínica
 * assinado como Tricopill mistura as duas marcas na caixa de entrada do paciente.
 */
export async function getEmailFrom(admin: SupabaseClient, tenantId: string): Promise<string> {
  const brand = await getTenantBrand(admin, tenantId)
  return brand.emailFrom
}

/** Só para teste — o cache é por isolate e não expira sozinho. */
export function __clearTenantBrandCache(): void {
  cache.clear()
}
