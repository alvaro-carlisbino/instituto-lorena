// Guarda de polo do roteamento de saída. Rode com:
//   deno test --allow-env supabase/functions/_shared/whatsapp/resolveProvider.test.ts
//
// O caso que originou o teste: em 11/ago/26 dois lembretes de cirurgia saíram na
// conversa de vendas do Tricopill, porque o lead da clínica estava amarrado na linha
// de vendas (a pessoa é paciente aqui e cliente lá, e escreveu por último por lá).

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { resolveOutboundProviderForLead } from './resolveProvider.ts'

const cred = { wapi_instance_id: 'LITE-FAKE', wapi_token: 'tok', wapi_base_url: null, wapi_webhook_secret: null, active: true }
const INSTANCIAS: Record<string, Record<string, unknown>> = {
  'tricopill-wapi': { channel_provider: 'wapi', tenant_id: 'tricopill', bot_kind: 'sales', ...cred },
  'wa-clinica': { channel_provider: 'wapi', tenant_id: 'instituto-lorena', bot_kind: 'clinic', ...cred },
  'wa-morta': { channel_provider: 'wapi', tenant_id: 'instituto-lorena', bot_kind: 'clinic', ...cred, active: false },
}

/** Cliente fake: só o suficiente para o resolver ler instâncias e tentar amarrar o lead. */
function fakeAdmin() {
  const updates: Array<Record<string, unknown>> = []
  const client = {
    from(table: string) {
      if (table === 'leads') {
        return { update: (v: Record<string, unknown>) => { updates.push(v); return { eq: () => Promise.resolve({}) } } }
      }
      // whatsapp_channel_instances
      const q = {
        _id: null as string | null,
        _tenant: null as string | null,
        select: () => q,
        eq(col: string, val: string) {
          if (col === 'id') q._id = val
          if (col === 'tenant_id') q._tenant = val
          return q
        },
        order: () => q,
        limit: () => q,
        maybeSingle() {
          if (q._id) {
            const inst = INSTANCIAS[q._id]
            return Promise.resolve({ data: inst ? { id: q._id, ...inst } : null })
          }
          const achou = Object.entries(INSTANCIAS).find(
            ([, i]) => i.tenant_id === q._tenant && i.active !== false,
          )
          return Promise.resolve({ data: achou ? { id: achou[0], ...achou[1] } : null })
        },
      }
      return q
    },
  }
  return { client, updates }
}

async function resolverLinha(lead: { id: string; whatsapp_instance_id: string | null; tenant_id: string }) {
  const { client, updates } = fakeAdmin()
  // deno-lint-ignore no-explicit-any
  const r = await resolveOutboundProviderForLead(client as any, lead)
  return {
    instanceId: r.instanceId,
    botKind: r.botKind,
    ignorada: r.crossTenantInstanceIgnored,
    inativaIgnorada: r.inactiveInstanceIgnored,
    updates,
  }
}

Deno.test('linha do outro polo é descartada: lead da clínica não sai pela linha do Tricopill', async () => {
  const r = await resolverLinha({
    id: 'lead-c7de3839-9fe',
    whatsapp_instance_id: 'tricopill-wapi',
    tenant_id: 'instituto-lorena',
  })
  assertEquals(r.ignorada, 'tricopill-wapi')
  assertEquals(r.instanceId, 'wa-clinica')
  assertEquals(r.botKind, 'clinic')
  // O vínculo original conta onde a pessoa conversa: não pode ser sobrescrito aqui.
  assertEquals(r.updates.length, 0)
})

Deno.test('linha do próprio polo é respeitada', async () => {
  const r = await resolverLinha({
    id: 'lead-1',
    whatsapp_instance_id: 'wa-clinica',
    tenant_id: 'instituto-lorena',
  })
  assertEquals(r.ignorada, null)
  assertEquals(r.instanceId, 'wa-clinica')
  assertEquals(r.botKind, 'clinic')
})

Deno.test('linha desativada no painel sai do ar mesmo para quem já estava fixado nela', async () => {
  const r = await resolverLinha({
    id: 'lead-preso',
    whatsapp_instance_id: 'wa-morta',
    tenant_id: 'instituto-lorena',
  })
  assertEquals(r.inativaIgnorada, 'wa-morta')
  assertEquals(r.instanceId, 'wa-clinica')
  assertEquals(r.botKind, 'clinic')
  // Mesma regra da linha de outro polo: o vínculo antigo NÃO é sobrescrito. Ele conta
  // onde a pessoa conversava, e religar a instância no painel tem que devolver a
  // conversa para ela sem precisar de remendo no banco.
  assertEquals(r.updates.length, 0)
})

Deno.test('lead sem linha cai no padrão do próprio tenant e fica amarrado', async () => {
  const r = await resolverLinha({ id: 'lead-2', whatsapp_instance_id: null, tenant_id: 'tricopill' })
  assertEquals(r.instanceId, 'tricopill-wapi')
  assertEquals(r.botKind, 'sales')
  assertEquals(r.updates, [{ whatsapp_instance_id: 'tricopill-wapi' }])
})
