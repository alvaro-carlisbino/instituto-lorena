// Guarda anti-ban das linhas não-oficiais. Rode com:
//   deno test --allow-env supabase/functions/_shared/whatsapp/antiBan.test.ts
//
// O que estes casos protegem: a regra do dia 20/08/2026, quando o WhatsApp da SDR da
// clínica saiu do ManyChat e passou a viver numa sessão W-API — "responder como sempre
// respondemos; para contato novo, todo o cuidado do mundo". Se um destes testes ficar
// vermelho, ou o atendimento parou de responder, ou a linha voltou a poder disparar.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  capFrioComAquecimento,
  DEFAULT_LINE_POLICY,
  guardWhatsappOutbound,
  hashTexto,
  typingDelaySeconds,
  type LinePolicy,
} from './antiBan.ts'

const POLICY: LinePolicy = { ...DEFAULT_LINE_POLICY, instance_id: 'wa-clinica', tenant_id: 'instituto-lorena' }

type Cenario = {
  policy?: Partial<LinePolicy>
  health?: { status?: string; connected?: boolean | null } | null
  /** Última entrada da pessoa. null = nunca escreveu (contato novo). */
  ultimoInboundIso?: string | null
  optedOutAt?: string | null
  /** Quando o lead entrou no CRM. Decide se ele tem direito à reserva do dia. */
  leadCriadoEm?: string | null
  /** Quantas linhas o livro-caixa devolve para as contagens (count exact). */
  contagens?: Record<string, number>
  ultimoProativoIso?: string | null
}

/**
 * Cliente falso: responde só o que a guarda pergunta. A ordem das chamadas não importa —
 * cada consulta é reconhecida pela tabela e pelos filtros aplicados.
 */
function fakeAdmin(cen: Cenario) {
  const contagens = cen.contagens ?? {}
  // deno-lint-ignore no-explicit-any
  const client: any = {
    from(table: string) {
      if (table === 'whatsapp_channel_instances') {
        return chain({
          data: { id: 'wa-clinica', tenant_id: 'instituto-lorena', channel_provider: 'wapi', label: 'Clínica' },
        })
      }
      if (table === 'whatsapp_line_policy') {
        return chain({ data: { ...POLICY, ...(cen.policy ?? {}) } })
      }
      if (table === 'whatsapp_line_health') {
        return chain({ data: cen.health === undefined ? null : cen.health })
      }
      if (table === 'crm_conversation_states') {
        return chain({ data: { last_inbound_at: cen.ultimoInboundIso ?? null } })
      }
      if (table === 'interactions') {
        return chain({ data: cen.ultimoInboundIso ? { happened_at: cen.ultimoInboundIso } : null })
      }
      if (table === 'leads') {
        return chain({
          data: { opted_out_at: cen.optedOutAt ?? null, id: 'lead-1', created_at: cen.leadCriadoEm ?? null },
        })
      }
      if (table === 'whatsapp_outbound_log') {
        return logChain()
      }
      return chain({ data: null })
    },
  }

  /** Encadeamento genérico de PostgREST: tudo devolve `this` até um terminal. */
  function chain(resultado: { data: unknown }) {
    // deno-lint-ignore no-explicit-any
    const c: any = {
      select: () => c,
      eq: () => c,
      in: () => c,
      gte: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(resultado),
      then: (r: (v: { data: unknown }) => unknown) => Promise.resolve(resultado).then(r),
    }
    return c
  }

  /**
   * Livro-caixa: as consultas ou pedem `count` (tetos) ou a última linha (ritmo/insistência).
   * O cenário informa os números por uma chave que descreve o filtro combinado.
   */
  function logChain() {
    let contaTipos: string[] = []
    let ehPorLead = false
    let desdeMs = 0
    // deno-lint-ignore no-explicit-any
    const c: any = {
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        c._count = Boolean(opts?.count)
        return c
      },
      eq: (col: string, v: unknown) => {
        if (col === 'lead_id') ehPorLead = true
        if (col === 'kind') contaTipos = [String(v)]
        return c
      },
      in: (_col: string, vals: string[]) => {
        contaTipos = vals
        return c
      },
      gte: (_col: string, v: string) => {
        desdeMs = new Date(v).getTime()
        return c
      },
      order: () => c,
      limit: () => c,
      maybeSingle: () =>
        Promise.resolve({
          data: cen.ultimoProativoIso ? { created_at: cen.ultimoProativoIso } : null,
        }),
      then: (r: (v: { data: unknown; count?: number }) => unknown) => {
        // A consulta da HORA e a do DIA têm os mesmos filtros; o que as separa é a janela.
        const janelaMs = Date.now() - desdeMs
        const ehHora = desdeMs > 0 && janelaMs <= 2 * 3_600_000
        const chave = ehPorLead
          ? 'por_lead'
          : contaTipos.length === 1 && contaTipos[0] === 'cold'
            ? 'frios'
            : contaTipos.length === 1 && contaTipos[0] === 'optin'
              ? 'optin'
              : ehHora
                ? 'proativos_hora'
                : 'proativos'
        if (c._count) return Promise.resolve({ data: null, count: contagens[chave] ?? 0 }).then(r)
        // Consulta de texto repetido devolve linhas com lead_id.
        return Promise.resolve({ data: [] as unknown[] }).then(r)
      },
    }
    return c
  }

  return client
}

const AGORA_UTIL = () => {
  // Uma terça-feira às 14h em São Paulo (17h UTC): dentro de qualquer janela padrão.
  const d = new Date()
  d.setUTCFullYear(2026, 7, 18) // 18/ago/2026 = terça
  d.setUTCHours(17, 0, 0, 0)
  return d
}

/**
 * Congela o relógio. A guarda decide por hora local de São Paulo e por distância entre
 * envios: sem relógio fixo, o mesmo teste passaria de dia e falharia de madrugada.
 */
function comRelogio<T>(quando: Date, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date
  // deno-lint-ignore no-explicit-any
  const Fake: any = function (this: unknown, ...args: unknown[]) {
    // deno-lint-ignore no-explicit-any
    return args.length ? new (RealDate as any)(...args) : new RealDate(quando.getTime())
  }
  Fake.prototype = RealDate.prototype
  Fake.now = () => quando.getTime()
  Fake.parse = RealDate.parse
  Fake.UTC = RealDate.UTC
  // deno-lint-ignore no-explicit-any
  ;(globalThis as any).Date = Fake
  return fn().finally(() => {
    // deno-lint-ignore no-explicit-any
    ;(globalThis as any).Date = RealDate
  })
}

const BASE = {
  instanceId: 'wa-clinica',
  tenantId: 'instituto-lorena',
  leadId: 'lead-1',
  phone: '5544999990000',
  text: 'Oi! Tudo bem?',
  source: 'teste',
}

Deno.test('resposta dentro de 24h passa sempre — inclusive de madrugada e no domingo', async () => {
  const madrugadaDomingo = new Date('2026-08-16T06:00:00Z') // 03h de domingo em SP
  await comRelogio(madrugadaDomingo, async () => {
    const admin = fakeAdmin({ ultimoInboundIso: new Date('2026-08-16T05:00:00Z').toISOString() })
    const d = await guardWhatsappOutbound(admin, BASE)
    assertEquals(d.kind, 'reply')
    assertEquals(d.allow, true)
  })
})

Deno.test('quem pediu para parar continua sendo respondido, mas não recebe proativo', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const optOut = { optedOutAt: '2026-08-01T12:00:00Z' }
    const resposta = await guardWhatsappOutbound(
      fakeAdmin({ ...optOut, ultimoInboundIso: new Date(AGORA_UTIL().getTime() - 3600_000).toISOString() }),
      BASE,
    )
    assertEquals(resposta.allow, true)
    assertEquals(resposta.kind, 'reply')

    const proativo = await guardWhatsappOutbound(
      fakeAdmin({ ...optOut, ultimoInboundIso: '2026-07-01T12:00:00Z' }),
      BASE,
    )
    assertEquals(proativo.allow, false)
    assertEquals(proativo.reason, 'opt_out')
  })
})

Deno.test('contato novo: teto do dia trava, e o clique humano NÃO fura esse teto', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const cen: Cenario = { ultimoInboundIso: null, contagens: { frios: 20, proativos: 20, por_lead: 0 } }
    const rotina = await guardWhatsappOutbound(fakeAdmin(cen), BASE)
    assertEquals(rotina.kind, 'cold')
    assertEquals(rotina.allow, false)
    assertEquals(rotina.reason, 'cap_frio_dia')

    const humano = await guardWhatsappOutbound(fakeAdmin(cen), { ...BASE, humanOverride: true })
    assertEquals(humano.allow, false)
    assertEquals(humano.reason, 'cap_frio_dia')

    // Só o "assumo o risco" explícito passa.
    const assumindo = await guardWhatsappOutbound(fakeAdmin(cen), { ...BASE, coldOverride: true })
    assertEquals(assumindo.allow, true)
  })
})

Deno.test('primeira mensagem a desconhecido não leva link', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const admin = fakeAdmin({ ultimoInboundIso: null, contagens: { frios: 0, proativos: 0, por_lead: 0 } })
    const d = await guardWhatsappOutbound(admin, { ...BASE, text: 'Olá! Veja em https://institutolorena.com.br' })
    assertEquals(d.allow, false)
    assertEquals(d.reason, 'link_primeiro_contato')
  })
})

Deno.test('proativo de madrugada é recusado; a mesma mensagem passa às 14h', async () => {
  const cen: Cenario = { ultimoInboundIso: '2026-07-01T12:00:00Z', contagens: { proativos: 0, por_lead: 0 } }
  await comRelogio(new Date('2026-08-18T05:00:00Z'), async () => {
    const d = await guardWhatsappOutbound(fakeAdmin(cen), BASE)
    assertEquals(d.allow, false)
    assertEquals(d.reason, 'fora_da_janela')
  })
  await comRelogio(AGORA_UTIL(), async () => {
    const d = await guardWhatsappOutbound(fakeAdmin(cen), BASE)
    assertEquals(d.allow, true)
    assertEquals(d.kind, 'proactive')
  })
})

Deno.test('sessão caída para o proativo, mas deixa a resposta tentar', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const caida = { status: 'disconnected', connected: false }
    const proativo = await guardWhatsappOutbound(
      fakeAdmin({ health: caida, ultimoInboundIso: '2026-07-01T12:00:00Z' }),
      BASE,
    )
    assertEquals(proativo.allow, false)
    assertEquals(proativo.reason, 'sessao_caida')

    const resposta = await guardWhatsappOutbound(
      fakeAdmin({ health: caida, ultimoInboundIso: new Date(AGORA_UTIL().getTime() - 600_000).toISOString() }),
      BASE,
    )
    assertEquals(resposta.allow, true)
  })
})

Deno.test('linha pausada não deixa passar nem resposta', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const admin = fakeAdmin({
      policy: { pausado_ate: new Date(AGORA_UTIL().getTime() + 3600_000).toISOString(), pausa_motivo: 'sessao_caiu' },
      ultimoInboundIso: new Date(AGORA_UTIL().getTime() - 600_000).toISOString(),
    })
    const d = await guardWhatsappOutbound(admin, BASE)
    assertEquals(d.allow, false)
    assertEquals(d.reason, 'linha_pausada')
  })
})

Deno.test('ritmo: dois proativos colados são recusados', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const admin = fakeAdmin({
      ultimoInboundIso: '2026-07-01T12:00:00Z',
      contagens: { proativos: 1, por_lead: 0 },
      ultimoProativoIso: new Date(AGORA_UTIL().getTime() - 5_000).toISOString(),
    })
    const d = await guardWhatsappOutbound(admin, BASE)
    assertEquals(d.allow, false)
    assertEquals(d.reason, 'ritmo')
  })
})

Deno.test('linha oficial da Meta não é policiada por esta guarda', async () => {
  const admin = fakeAdmin({})
  // deno-lint-ignore no-explicit-any
  const original = (admin as any).from
  // deno-lint-ignore no-explicit-any
  ;(admin as any).from = (t: string) => {
    if (t === 'whatsapp_channel_instances') {
      // deno-lint-ignore no-explicit-any
      const c: any = {
        select: () => c,
        eq: () => c,
        maybeSingle: () =>
          Promise.resolve({ data: { id: 'x', tenant_id: 'instituto-lorena', channel_provider: 'official', label: 'Meta' } }),
      }
      return c
    }
    return original(t)
  }
  const d = await guardWhatsappOutbound(admin, BASE)
  assertEquals(d.allow, true)
  assertEquals(d.bypassed, true)
})

Deno.test('quem preencheu o formulário é chamado: passa mesmo com o teto semanal estourado', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const admin = fakeAdmin({
      ultimoInboundIso: null,
      // 5 proativas para esta pessoa na semana barrariam um proativo comum; primeiro
      // contato não olha esse teto, porque é a PRIMEIRA mensagem.
      contagens: { optin: 3, proativos: 3, por_lead: 5 },
    })
    const d = await guardWhatsappOutbound(admin, { ...BASE, kind: 'optin' })
    assertEquals(d.allow, true)
    assertEquals(d.kind, 'optin')
  })
})

Deno.test('primeiro contato tem teto próprio, mais folgado que o de contato frio', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    // 25 já enviados: passaria do teto de frio (20) e ainda cabe no de opt-in (40).
    const cabe = await guardWhatsappOutbound(
      fakeAdmin({ ultimoInboundIso: null, contagens: { optin: 25, proativos: 25, por_lead: 0 } }),
      { ...BASE, kind: 'optin' },
    )
    assertEquals(cabe.allow, true)

    const estourou = await guardWhatsappOutbound(
      fakeAdmin({ ultimoInboundIso: null, contagens: { optin: 40, proativos: 40, por_lead: 0 } }),
      { ...BASE, kind: 'optin' },
    )
    assertEquals(estourou.allow, false)
    assertEquals(estourou.reason, 'cap_optin_dia')
  })
})

Deno.test('as últimas vagas do teto de 1.º contato são de quem preencheu hoje', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    // Teto 40, reserva 30% = 12. Com 30 gastos, restam 10: já é zona de reserva.
    const hoje = new Date(AGORA_UTIL().getTime() - 2 * 3_600_000).toISOString()
    const anteontem = new Date(AGORA_UTIL().getTime() - 3 * 86_400_000).toISOString()

    const doDia = await guardWhatsappOutbound(
      fakeAdmin({
        ultimoInboundIso: null,
        leadCriadoEm: hoje,
        contagens: { optin: 30, proativos: 30, por_lead: 0 },
      }),
      { ...BASE, kind: 'optin' },
    )
    assertEquals(doDia.allow, true)

    const doBacklog = await guardWhatsappOutbound(
      fakeAdmin({
        ultimoInboundIso: null,
        leadCriadoEm: anteontem,
        contagens: { optin: 30, proativos: 30, por_lead: 0 },
      }),
      { ...BASE, kind: 'optin' },
    )
    assertEquals(doBacklog.allow, false)
    assertEquals(doBacklog.reason, 'cap_optin_reserva')

    // Fora da zona de reserva (28 é o limite do backlog), o lead antigo passa como sempre.
    const backlogCedo = await guardWhatsappOutbound(
      fakeAdmin({
        ultimoInboundIso: null,
        leadCriadoEm: anteontem,
        contagens: { optin: 27, proativos: 27, por_lead: 0 },
      }),
      { ...BASE, kind: 'optin' },
    )
    assertEquals(backlogCedo.allow, true)
  })
})

Deno.test('reserva em 0 devolve o teto inteiro ao backlog', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const d = await guardWhatsappOutbound(
      fakeAdmin({
        ultimoInboundIso: null,
        policy: { optin_reserva_pct: 0 },
        leadCriadoEm: new Date(AGORA_UTIL().getTime() - 10 * 86_400_000).toISOString(),
        contagens: { optin: 39, proativos: 39, por_lead: 0 },
      }),
      { ...BASE, kind: 'optin' },
    )
    assertEquals(d.allow, true)
  })
})

Deno.test('a mensagem de apresentação não leva link', async () => {
  await comRelogio(AGORA_UTIL(), async () => {
    const admin = fakeAdmin({ ultimoInboundIso: null, contagens: { optin: 0, proativos: 0, por_lead: 0 } })
    const d = await guardWhatsappOutbound(admin, {
      ...BASE,
      kind: 'optin',
      text: 'Oi! Agende em institutolorena.com.br',
    })
    assertEquals(d.allow, false)
    assertEquals(d.reason, 'link_primeiro_contato')
  })
})

Deno.test('aquecimento sobe em rampa e depois entrega o teto cheio', () => {
  const inicio = new Date('2026-08-20T12:00:00Z')
  const pol: LinePolicy = {
    ...POLICY,
    cap_frio_dia: 20,
    aquecimento_cap_inicial: 5,
    aquecimento_dias: 14,
    aquecimento_inicio: inicio.toISOString(),
  }
  assertEquals(capFrioComAquecimento(pol, inicio), 5)
  assertEquals(capFrioComAquecimento(pol, new Date('2026-08-27T12:00:00Z')), 12)
  assertEquals(capFrioComAquecimento(pol, new Date('2026-09-10T12:00:00Z')), 20)
})

Deno.test('texto igual gera o mesmo hash; espaço e acento não contam', () => {
  assertEquals(hashTexto('Olá,  tudo bem?'), hashTexto('ola, tudo bem?'))
})

Deno.test('digitação cresce com o texto, com teto humano', () => {
  const curto = typingDelaySeconds('oi', 'reply')
  const longo = typingDelaySeconds('x'.repeat(2000), 'reply')
  assertEquals(curto >= 1 && curto <= 3, true)
  assertEquals(longo <= 12, true)
  assertEquals(typingDelaySeconds('seu código é 123456', 'transactional'), 0)
})
