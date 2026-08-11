import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  __clearTenantBrandCache,
  buildCheckoutUrl,
  getCheckoutBaseUrl,
  getEmailFrom,
  getTenantBrand,
} from './tenantBrand.ts'

/**
 * O que estes testes protegem: nenhum polo pode herdar o domínio, o site ou o remetente
 * do outro. O bug real foi um default global (`instituto-lorena.vercel.app`) valendo para
 * os dois negócios — 174 cobranças do Tricopill saíram no domínio da clínica.
 */

const TENANTS: Record<string, Record<string, unknown> | null> = {
  tricopill: {
    app_name: 'Tricopill',
    checkout_base_url: 'https://pagar.tricopill.com.br',
    site_url: 'https://tricopill.com.br',
    email_from: 'Tricopill <contato@tricopill.com.br>',
    support_phone: '+5544999067665',
  },
  'instituto-lorena': {
    app_name: 'Instituto Lorena Visentainer',
    checkout_base_url: 'https://pagar.institutolorenavisentainer.com.br',
    site_url: 'https://institutolorenavisentainer.com.br',
    email_from: '',
  },
  // Polo novo, ainda sem marca preenchida: precisa FALHAR, não cair no vizinho.
  'polo-novo': {},
}

function fakeAdmin(): SupabaseClient {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: () =>
            Promise.resolve({
              data: TENANTS[val] === undefined ? null : { brand_config: TENANTS[val] },
              error: null,
            }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

function setup() {
  __clearTenantBrandCache()
  return fakeAdmin()
}

Deno.test('cada polo carrega o próprio domínio de cobrança', async () => {
  const admin = setup()
  assertEquals(await getCheckoutBaseUrl(admin, 'tricopill'), 'https://pagar.tricopill.com.br')
  assertEquals(await getCheckoutBaseUrl(admin, 'instituto-lorena'), 'https://pagar.institutolorenavisentainer.com.br')
})

Deno.test('link de pagamento nasce no domínio do polo dono da cobrança', async () => {
  const admin = setup()
  assertEquals(await buildCheckoutUrl(admin, 'tricopill', 'abc123'), 'https://pagar.tricopill.com.br/pagar/abc123')
  assertEquals(
    await buildCheckoutUrl(admin, 'instituto-lorena', 'abc123'),
    'https://pagar.institutolorenavisentainer.com.br/pagar/abc123',
  )
})

Deno.test('nenhum domínio de cobrança carrega a marca do outro negócio', async () => {
  const admin = setup()
  const tri = await getCheckoutBaseUrl(admin, 'tricopill')
  const clin = await getCheckoutBaseUrl(admin, 'instituto-lorena')
  assertEquals(tri.includes('institutolorena'), false)
  assertEquals(tri.includes('visentainer'), false)
  assertEquals(tri.includes('instituto-lorena'), false)
  assertEquals(clin.includes('tricopill'), false)
  // E nenhum dos dois pode voltar a apontar para o domínio interno da Vercel.
  assertEquals(tri.includes('vercel.app'), false)
  assertEquals(clin.includes('vercel.app'), false)
})

Deno.test('polo sem domínio configurado ESTOURA em vez de cair no outro polo', async () => {
  const admin = setup()
  await assertRejects(
    () => getCheckoutBaseUrl(admin, 'polo-novo'),
    Error,
    'marca_sem_checkout_base_url:polo-novo',
  )
})

Deno.test('polo inexistente não herda marca de ninguém', async () => {
  const admin = setup()
  await assertRejects(() => getCheckoutBaseUrl(admin, 'nao-existe'), Error, 'marca_sem_checkout_base_url')
})

Deno.test('remetente vazio significa canal desligado, nunca o remetente do outro polo', async () => {
  const admin = setup()
  assertEquals(await getEmailFrom(admin, 'tricopill'), 'Tricopill <contato@tricopill.com.br>')
  // Clínica sem domínio verificado no Resend: vazio = não manda. Se algum dia isso voltar
  // a devolver o remetente do Tricopill, o paciente recebe e-mail da marca errada.
  assertEquals(await getEmailFrom(admin, 'instituto-lorena'), '')
  assertEquals(await getEmailFrom(admin, 'polo-novo'), '')
})

Deno.test('site do polo não vaza para o outro (atribuição de conversão)', async () => {
  const admin = setup()
  assertEquals((await getTenantBrand(admin, 'tricopill')).siteUrl, 'https://tricopill.com.br')
  assertEquals((await getTenantBrand(admin, 'instituto-lorena')).siteUrl, 'https://institutolorenavisentainer.com.br')
})

Deno.test('barra final na config não duplica na URL final', async () => {
  __clearTenantBrandCache()
  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { brand_config: { checkout_base_url: 'https://pagar.tricopill.com.br/' } }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
  assertEquals(await buildCheckoutUrl(admin, 'tricopill', 'x1'), 'https://pagar.tricopill.com.br/pagar/x1')
})

Deno.test('tenant vazio não resolve marca nenhuma', async () => {
  const admin = setup()
  await assertRejects(() => getTenantBrand(admin, ''), Error, 'marca_sem_tenant')
})
