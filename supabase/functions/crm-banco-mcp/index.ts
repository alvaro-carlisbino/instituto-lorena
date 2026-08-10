import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Open Finance via Banco MCP (api.mcp.ai/api/openfinance) — alternativa/complemento ao Pluggy.
// Lê BANCOMCP_ACCESS_TOKEN (JWT agent-auth) ou BANCOMCP_TOKEN (sk_live).
// Actions: status | link | sync

const OF = 'https://api.mcp.ai/api/openfinance'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

function bearer(): string {
  const access = (Deno.env.get('BANCOMCP_ACCESS_TOKEN') ?? '').trim()
  const sk = (Deno.env.get('BANCOMCP_TOKEN') ?? '').trim()
  return access || sk
}

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function ofPost(
  path: string,
  body: Record<string, unknown> = {},
  tentativa = 1,
): Promise<Record<string, unknown>> {
  const token = bearer()
  if (!token) {
    throw new Error('Banco MCP sem credencial: falta o secret BANCOMCP_ACCESS_TOKEN (ou BANCOMCP_TOKEN) no Supabase.')
  }
  const res = await fetch(`${OF}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  // `String(obj)` vira "[object Object]" e some com o motivo. A api.mcp.ai devolve `error`
  // como OBJETO em parte das rotas (/connections/status é uma delas), então o diagnóstico
  // que a gente mais precisa era justamente o que chegava ilegível na tela.
  const texto = (v: unknown): string => {
    if (v == null) return ''
    if (typeof v === 'string') return v
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      const dentro = o.message ?? o.detail ?? o.description ?? o.code
      if (dentro != null && typeof dentro !== 'object') return String(dentro)
      try {
        return JSON.stringify(v).slice(0, 300)
      } catch {
        return String(v)
      }
    }
    return String(v)
  }
  const err = texto(data.error)
  const upstreamMsg = texto(data.message)

  // O teto do MCP.AI é 2 req/s e a paginação do extrato estoura isso fácil. Sem retry, um
  // 429 no meio virava "conta falhou" e o dia inteiro ficava sem extrato.
  if (res.status === 429 && tentativa <= 3) {
    await dorme(1200 * tentativa)
    return ofPost(path, body, tentativa + 1)
  }

  // O MCP.AI devolve 200 com { error, message } em caso de assinatura vencida / chave
  // inválida — sem `ok:false`. Sem esta checagem isso passava como "resultado" e virava
  // "nenhuma conexão" mais adiante, escondendo o motivo real.
  if (!res.ok || data.ok === false || err) {
    const detail = upstreamMsg || err || `http_${res.status}`
    if (res.status === 401 || res.status === 403 || err === 'unauthorized') {
      throw new Error(`Banco MCP recusou a credencial (${res.status}). Atualize o secret BANCOMCP_ACCESS_TOKEN. Detalhe: ${detail}`)
    }
    throw new Error(`Banco MCP ${path}: ${detail}`)
  }
  return (data.result as Record<string, unknown>) ?? data
}

/** Chamada que NÃO pode derrubar o sync (força de atualização, status extra). */
async function ofPostSoft(path: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
  try {
    return await ofPost(path, body)
  } catch {
    return null
  }
}

// A api.mcp.ai não publica catálogo de rotas, e chutar path em produção vira dado faltando
// calado. `action=probe` bate em cada candidato e diz qual respondeu, pra quem for mexer
// aqui descobrir o path certo sem adivinhar. Diagnóstico, não roda no sync.
const PROBE: Record<string, string[]> = {
  bills: [
    '/credit-card-bills/list',
    '/credit_card_bills/list',
    '/bills/list',
    '/credit-cards/bills/list',
    '/cards/bills/list',
    '/credit-card/bills/list',
  ],
  balance: ['/accounts/balance', '/accounts/balances', '/accounts/get-balance', '/balance/get'],
  detail: ['/accounts/detail', '/accounts/get', '/accounts/details'],
}

async function ofProbe(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = bearer()
  try {
    const res = await fetch(`${OF}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const raw = await res.text()
    return { path, http: res.status, sample: raw.slice(0, 1200) }
  } catch (e) {
    return { path, http: 0, sample: e instanceof Error ? e.message : String(e) }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

type OfAccount = {
  id?: string
  account_id?: string
  name?: string
  marketingName?: string
  number?: string
  type?: string
  subtype?: string
  owner?: string
  currencyCode?: string
  /**
   * Vem como string ("48224.32"). Em conta CRÉDITO o significado MUDA por conector: uns
   * mandam a fatura aberta, outros a dívida total com parcelas futuras. Por isso o cartão
   * não usa mais este campo como "fatura" — ver lerFatura().
   */
  balance?: string | number
  /** Carimbo do provedor quando o saldo veio do endpoint de tempo real. */
  balanceAt?: string
  realtime?: boolean
  creditData?: Record<string, unknown>
  bankData?: Record<string, unknown>
}

/** Situação da conexão + quando o BANCO foi lido de verdade (não quando a gente gravou). */
type Frescor = { status: string; exec: string; dadoEm: string | null }

/** Números padronizados da fatura, que o `balance` do cartão não garante. */
type Fatura = {
  abertaCents: number | null
  aVencerCents: number | null
  dividaTotalCents: number | null
  fechamento: string | null
  vencimento: string | null
  /** Por que não veio número, em português, pra tela não fingir que veio. */
  nota?: string
  /** Amostra do retorno quando o formato não bate com o esperado — pra acertar sem adivinhar. */
  debug?: string
}

const centavos = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const dataCurta = (v: unknown): string | null => {
  const s = String(v ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * Manda o provedor buscar no banco e ESPERA terminar, até 60s.
 *
 * O refresh do provedor é assíncrono. Sem esperar, a leitura logo em seguida devolve o
 * retrato antigo — que é como o saldo da tela ficava horas atrasado parecendo novo.
 * Se o pedido não for aceito (o teto é 1x/hora por conexão), não espera nada: lê o que há
 * e o carimbo devolvido já diz a idade real.
 */
async function atualizarEEsperar(item: string): Promise<Frescor> {
  const ler = async (): Promise<Frescor> => {
    const st = await ofPostSoft('/connections/status', { item })
    return {
      status: String(st?.status ?? ''),
      exec: String(st?.executionStatus ?? ''),
      dadoEm: (st?.lastUpdatedAt ?? st?.updatedAt) ? String(st.lastUpdatedAt ?? st.updatedAt) : null,
    }
  }

  const antes = await ler()
  const pedido = await ofPostSoft('/connections/sync', { item })
  if (!pedido) return antes

  let atual = antes
  for (let i = 0; i < 12; i += 1) {
    await dorme(5000)
    atual = await ler()
    // Terminou quando o carimbo do provedor andou e ele não está mais atualizando.
    if (atual.status !== 'UPDATING' && atual.dadoEm && atual.dadoEm !== antes.dadoEm) return atual
    // LOGIN_ERROR / pedido de MFA não termina sozinho: para de esperar e deixa o status falar.
    if (atual.status && atual.status !== 'UPDATING' && atual.status !== 'UPDATED') return atual
  }
  return atual
}

const VAZIO: Fatura = {
  abertaCents: null,
  aVencerCents: null,
  dividaTotalCents: null,
  fechamento: null,
  vencimento: null,
}

/**
 * Lê os números da fatura do retorno de /credit-card-bills/list.
 *
 * Formato observado (modo bulk): { results: [{ id, ok, data: { total, results: [faturas] } }] }.
 * A api.mcp.ai não publica schema, então em vez de fixar um caminho a gente procura as
 * chaves conhecidas na linha e um nível abaixo, e guarda amostra em `debug` quando o
 * formato não bate — é o que permite acertar depois sem chutar em produção.
 *
 * Atenção ao caso que o Itaú Empresas devolve hoje: `ok: true` com `total: 0`, ou seja,
 * conexão de pé e NENHUMA fatura compartilhada. Isso não é erro nem fatura zerada, e a
 * diferença importa: a tela precisa dizer "o banco não mandou a fatura" em vez de mostrar
 * R$ 0,00, que seria mentira tranquilizadora.
 */
function lerFatura(linha: Record<string, unknown>): Fatura {
  if (linha.ok === false) {
    return { ...VAZIO, nota: `O banco recusou a fatura: ${String(linha.error ?? 'motivo não informado')}` }
  }

  const fontes: Record<string, unknown>[] = [linha]
  for (const chave of ['result', 'data', 'bill', 'summary']) {
    const filho = linha[chave]
    if (filho && typeof filho === 'object' && !Array.isArray(filho)) fontes.push(filho as Record<string, unknown>)
  }
  const busca = (...chaves: string[]): unknown => {
    for (const f of fontes) for (const c of chaves) if (f[c] !== undefined && f[c] !== null) return f[c]
    return null
  }

  const aberta = numero(busca('open_bill', 'openBill', 'open_bill_amount'))
  const divida = numero(busca('total_pending_debt', 'totalPendingDebt', 'pending_debt'))

  // A fatura fechada a vencer é a mais recente ainda não paga da lista de faturas.
  const listas = fontes.flatMap((f) => {
    const l = f.results ?? f.bills ?? f.items
    return Array.isArray(l) ? (l as Record<string, unknown>[]) : []
  })
  const naoPagas = listas.filter((b) => String(b.status ?? '').toUpperCase() !== 'PAID')
  const proxima = naoPagas.sort((a, b) => String(a.dueDate ?? a.due_date ?? '').localeCompare(String(b.dueDate ?? b.due_date ?? '')))[0] ?? null
  const aVencer = proxima ? numero(proxima.totalAmount ?? proxima.total_amount ?? proxima.amount) : null

  const achouAlgo = aberta != null || divida != null || aVencer != null
  const semFatura = !achouAlgo && listas.length === 0
  return {
    abertaCents: aberta != null ? Math.round(aberta * 100) : null,
    aVencerCents: aVencer != null ? Math.round(aVencer * 100) : null,
    dividaTotalCents: divida != null ? Math.round(divida * 100) : null,
    fechamento: dataCurta(proxima?.closeDate ?? proxima?.close_date ?? busca('close_date', 'closeDate')),
    vencimento: dataCurta(proxima?.dueDate ?? proxima?.due_date ?? busca('due_date', 'dueDate')),
    ...(semFatura ? { nota: 'O banco não compartilha a lista de faturas deste cartão.' } : {}),
    ...(achouAlgo || semFatura ? {} : { debug: JSON.stringify(linha).slice(0, 400) }),
  }
}

/** O que a tela mostra do banco além do saldo: fechamento/vencimento da fatura, titular. */
function metaDaConta(a: OfAccount, fatura?: Fatura | null): Record<string, unknown> {
  return {
    subtype: a.subtype ?? null,
    owner: a.owner ?? null,
    currency: a.currencyCode ?? null,
    credit: a.creditData ?? null,
    bank: a.bankData ?? null,
    // Diz de onde veio o saldo: tempo real (bateu no banco agora) ou o retrato guardado.
    realtime: a.realtime ?? false,
    ...(fatura?.nota ? { billNote: fatura.nota } : {}),
    ...(fatura?.debug ? { billDebug: fatura.debug } : {}),
  }
}

// Conexão UPDATED com 0 contas quase sempre é consentimento incompleto no banco, e o
// motivo exato vem em código dentro de statusDetail.<produto>.warnings. Traduz pra uma
// instrução que a clínica consegue executar — "sem contas compartilhadas" não ajuda.
const WARNING_PT: Record<string, string> = {
  ACCT_001:
    'o consentimento foi criado SEM a permissão de contas (ACCOUNTS_ALL): refaça a autorização marcando "dados de conta / saldos e lançamentos"',
  ACCT_002:
    'a conta está PENDENTE DE APROVAÇÃO no banco: em conta PJ com múltipla alçada, o outro administrador precisa aprovar o compartilhamento no app do Itaú',
  CC_002: 'o cartão de crédito está pendente de aprovação no banco',
  TXN_002: 'sem conta compartilhada não há lançamentos para puxar',
  LOAN_001: 'sem permissão de operações de crédito (não atrapalha o extrato)',
}

function warningsNotice(statusDetail: unknown): string | null {
  if (!statusDetail || typeof statusDetail !== 'object') return null
  const codes = new Set<string>()
  for (const produto of Object.values(statusDetail as Record<string, unknown>)) {
    const warns = (produto as { warnings?: Array<{ code?: string }> } | null)?.warnings
    for (const w of warns ?? []) if (w?.code) codes.add(String(w.code))
  }
  // LOAN_001 sozinho não explica extrato vazio — só entra se houver outro aviso junto.
  const relevantes = [...codes].filter((c) => c !== 'LOAN_001' || codes.size === 1)
  const frases = relevantes.map((c) => WARNING_PT[c] ?? `aviso ${c} do banco`)
  if (frases.length === 0) return null
  return `O banco respondeu, mas ${frases.join('; ')}.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  // Secret próprio do Banco MCP: o OPENFINANCE_CRON_SECRET (Pluggy) está VAZIO em prod de
  // propósito — o cron do Pluggy manda o header em branco e passaria a tomar 401 se alguém
  // o preenchesse. Por isso o sync automático daqui tem chave separada.
  const cronSecrets = [
    (Deno.env.get('BANCOMCP_CRON_SECRET') ?? '').trim(),
    (Deno.env.get('OPENFINANCE_CRON_SECRET') ?? '').trim(),
  ].filter(Boolean)
  const providedCron = (req.headers.get('x-cron-secret') ?? '').trim()
  const isCron = Boolean(providedCron && cronSecrets.includes(providedCron))

  let payload: { action?: string; item?: string; tenant_id?: string; from?: string } = {}
  try {
    payload = await req.json()
  } catch {
    // ok
  }
  const action = payload.action ?? 'status'

  try {
    if (action === 'status') {
      const connections = await ofPost('/connections/list')
      const item = payload.item
      let accounts: Record<string, unknown> | null = null
      let status: Record<string, unknown> | null = null
      try {
        accounts = await ofPost('/accounts/list', item ? { item } : {})
      } catch (e) {
        accounts = { error: e instanceof Error ? e.message : String(e) }
      }
      try {
        status = await ofPost('/connections/status', item ? { item } : {})
      } catch (e) {
        status = { error: e instanceof Error ? e.message : String(e) }
      }
      const totalContas = Number(accounts?.total ?? (accounts?.results as unknown[] | undefined)?.length ?? 0)
      const notice = totalContas === 0 ? warningsNotice(status?.statusDetail) : null
      return json({ ok: true, connections, accounts, status, notice })
    }

    if (action === 'probe') {
      const grupo = String((payload as { group?: string }).group ?? 'bills')
      const alvo = String((payload as { account_id?: string }).account_id ?? '')
      const corpo: Record<string, unknown> = { ...(payload.item ? { item: payload.item } : {}) }
      if (alvo) {
        corpo.account_id = alvo
        corpo.account_ids = [alvo]
      }
      const results = []
      for (const p of PROBE[grupo] ?? []) results.push(await ofProbe(p, corpo))
      return json({ ok: true, group: grupo, body: corpo, results })
    }

    // link + sync precisam de JWT de usuário (RLS) OU cron+service_role+tenant_id
    if (!url) return json({ error: 'server_misconfigured' }, 500)

    if (action === 'link' || action === 'sync') {
      const authHeader = req.headers.get('Authorization') ?? ''
      let db
      let tenantId: string | null = payload.tenant_id ?? null

      if (isCron) {
        if (!serviceRole) return json({ error: 'server_misconfigured' }, 500)
        db = createClient(url, serviceRole)
        if (!tenantId) tenantId = 'instituto-lorena'
      } else {
        if (!anon || !authHeader) return json({ error: 'unauthorized' }, 401)
        db = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
      }

      if (action === 'link') {
        const item = payload.item
        const connections = await ofPost('/connections/list')
        const list = (connections.connections as Array<Record<string, unknown>>) ?? []
        // Sem `item`, liga TODAS as conexões — não só a primeira. É por aqui que o cron
        // conserta sozinho conta nova e reconexão: reconectar cria um item_id novo, e o
        // `sync` puro (que só varre o que já está ligado) nunca enxergaria essa conta.
        const alvos = item
          ? list.filter(
              (c) =>
                String(c.item_id) === item ||
                String(c.connector_id) === item ||
                String(c.connector_name).toLowerCase() === item.toLowerCase(),
            )
          : list
        const conn = alvos[0] ?? null
        if (!conn) {
          return json({
            ok: false,
            accountsLinked: 0,
            inserted: 0,
            notice: 'Nenhum banco conectado no Banco MCP. Conecte pelo widget e tente de novo.',
            addConnectionUrl: connections.add_connection_url ?? null,
          })
        }

        const itemId = String(conn.item_id)
        const bankName = String(conn.connector_name ?? 'Open Finance')

        // Uma passada por conexão, guardando o que cada banco devolveu.
        const porBanco: Array<{ itemId: string; bankName: string; contas: OfAccount[]; notice: string | null }> = []
        for (const c of alvos) {
          const cItem = String(c.item_id)
          const cNome = String(c.connector_name ?? 'Open Finance')
          const res = await ofPost('/accounts/list', { item: cItem })
          porBanco.push({
            itemId: cItem,
            bankName: cNome,
            contas: (res.results as OfAccount[]) ?? [],
            notice: res.notice ? String(res.notice) : null,
          })
        }
        const results = porBanco.flatMap((b) => b.contas)
        const notice = porBanco.find((b) => b.notice)?.notice ?? null

        if (results.length === 0) {
          // Sem conta compartilhada não há o que ligar. O motivo verdadeiro está no status
          // da conexão (ex.: LOGIN_ERROR / USER_AUTHORIZATION_NOT_GRANTED) — devolve junto,
          // senão a tela só diz "sem contas" e ninguém sabe o que fazer.
          let itemStatus: Record<string, unknown> | null = null
          try {
            itemStatus = await ofPost('/connections/status', { item: itemId })
          } catch {
            // status é extra — não derruba o link por causa dele
          }
          const st = String(itemStatus?.status ?? '')
          const exec = String(itemStatus?.executionStatus ?? '')
          const precisaLogin = st === 'LOGIN_ERROR' || exec.includes('AUTHORIZATION_NOT_GRANTED')
          const avisos = warningsNotice(itemStatus?.statusDetail)
          const motivo = precisaLogin
            ? `${bankName}: o banco não concedeu a autorização (${st}${exec ? ` / ${exec}` : ''}). Refaça o login pelo "Reautorizar no banco" e MARQUE as contas no consentimento.`
            : avisos
              ? `${bankName}: ${avisos} Use "Reautorizar no banco" para refazer o consentimento.`
              : (notice ??
                'Conexão ativa, mas sem contas compartilhadas. Autorize as contas no app do banco (Open Finance / múltipla alçada) ou reconecte selecionando as contas.')
          return json({
            ok: false,
            bankName,
            itemId,
            accountsLinked: 0,
            inserted: 0,
            itemStatus: st || null,
            executionStatus: exec || null,
            notice: motivo,
            reconnectUrl: conn.reconnect_url ?? null,
            addConnectionUrl: connections.add_connection_url ?? null,
          })
        }

        let linked = 0
        const paraLigar = porBanco.flatMap((b) => b.contas.map((a) => ({ banco: b, a })))
        for (const { banco, a } of paraLigar) {
          const ofAccountId = String(a.id ?? a.account_id ?? '')
          if (!ofAccountId) continue
          const kind = String(a.type ?? '').toUpperCase().includes('CREDIT') ? 'carteira' : 'banco'
          const label = a.marketingName || a.name || banco.bankName
          const row = {
            name: `${banco.bankName} · ${label}`.slice(0, 120),
            kind,
            bank_name: banco.bankName,
            number: a.number ?? null,
            of_provider: 'mcp_ai',
            of_item_id: banco.itemId,
            of_account_id: ofAccountId,
            active: true,
            updated_at: new Date().toISOString(),
            ...(tenantId && isCron ? { tenant_id: tenantId } : {}),
          }
          // Erro de escrita aqui NÃO pode passar batido: sem isso a tela dizia
          // "banco conectado, N contas" com o banco de dados vazio (RLS barrando, coluna
          // faltando) e ninguém descobria até o extrato não chegar.
          let busca = db.from('fin_accounts').select('id').eq('of_account_id', ofAccountId)
          // service_role enxerga todos os polos: sem este filtro a conta de um polo
          // poderia ser reescrita pelo sync do outro.
          if (isCron && tenantId) busca = busca.eq('tenant_id', tenantId)
          const { data: existing, error: selErr } = await busca.maybeSingle()
          if (selErr) throw new Error(`fin_accounts (busca ${ofAccountId}): ${selErr.message}`)
          if (existing) {
            const { error: updErr } = await db
              .from('fin_accounts')
              .update(row)
              .eq('id', (existing as { id: string }).id)
            if (updErr) throw new Error(`fin_accounts (atualizar ${ofAccountId}): ${updErr.message}`)
          } else {
            const { error: insErr } = await db.from('fin_accounts').insert(row)
            if (insErr) throw new Error(`fin_accounts (criar ${ofAccountId}): ${insErr.message}`)
          }
          linked += 1
        }

        // `item` vazio = ligou todas as conexões, então sincroniza todas também.
        const synced = await syncMcpAccounts(db, item ? itemId : null, payload.from ?? null, tenantId, isCron)
        return json({
          ok: true,
          bankName,
          itemId,
          accountsLinked: linked,
          banks: porBanco.map((b) => ({ bankName: b.bankName, itemId: b.itemId, accounts: b.contas.length })),
          ...synced,
        })
      }

      // sync
      const synced = await syncMcpAccounts(db, payload.item ?? null, payload.from ?? null, tenantId, isCron)
      return json({ ok: true, ...synced })
    }

    return json({ error: 'unknown_action' }, 400)
  } catch (e) {
    return json({ error: 'failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})

async function syncMcpAccounts(
  db: SupabaseClient,
  itemId: string | null,
  fromOverride: string | null,
  tenantId: string | null,
  isCron: boolean,
): Promise<{ inserted: number; accounts: number; results: Array<Record<string, unknown>> }> {
  let query = db
    .from('fin_accounts')
    .select('id, tenant_id, of_account_id, of_item_id, of_last_sync_at')
    .eq('of_provider', 'mcp_ai')
    .not('of_account_id', 'is', null)
  if (itemId) query = query.eq('of_item_id', itemId)
  if (isCron && tenantId) query = query.eq('tenant_id', tenantId)
  const { data: accs, error } = await query
  if (error) throw new Error(error.message)

  const contas = (accs ?? []) as Array<{
    id: string
    tenant_id: string
    of_account_id: string
    of_item_id: string | null
    of_last_sync_at: string | null
  }>

  // Saldo e situação vêm por CONEXÃO, não por conta: uma chamada por item serve todas as
  // contas dele. Sem isso a tela só teria a soma dos lançamentos, que nunca bate com o
  // extrato (o saldo de abertura fica de fora).
  const itens = [...new Set(contas.map((c) => c.of_item_id).filter(Boolean))] as string[]
  const saldos = new Map<string, OfAccount>()
  const situacao = new Map<string, Frescor>()
  const faturas = new Map<string, Fatura>()
  const avisoProvedor = new Map<string, string | null>()

  for (const it of itens) {
    // PEDE ANTES DE LER. Este pedido ficava no FIM da rodada, e como o refresh do provedor
    // é assíncrono, cada rodada colhia o retrato que a rodada ANTERIOR mandou buscar. Com
    // 3 rodadas por dia isso deixava o saldo da tela até 7h velho — em 10/ago o banco tinha
    // R$ 82.644,32 e a tela mostrava R$ 67.644,32, faltando dois PIX já creditados.
    situacao.set(it, await atualizarEEsperar(it))

    const res = await ofPostSoft('/accounts/list', { item: it })
    const doItem: string[] = []
    for (const a of ((res?.results as OfAccount[]) ?? [])) {
      const id = String(a.id ?? a.account_id ?? '')
      if (!id) continue
      saldos.set(id, a)
      doItem.push(id)
    }

    // O provedor avisa quando está degradado ("limite pode vir zerado, não é valor real").
    // A gente descartava esse aviso e mostrava o número como se fosse verdade.
    const incidente = res?.provider_incident as { degraded?: boolean; note?: string } | undefined
    avisoProvedor.set(it, incidente?.degraded ? String(incidente.note ?? 'Provedor com incidente aberto.') : null)

    // Saldo em tempo real (endpoint próprio, bate no banco na hora). É melhor que o
    // /accounts/list, que sempre devolve o último retrato guardado. Best effort: quando o
    // provedor está fora, cai no retrato mesmo.
    const rt = await ofPostSoft('/accounts/balance', { account_ids: doItem })
    for (const linha of ((rt?.results as Array<Record<string, unknown>>) ?? [])) {
      const id = String(linha.id ?? linha.account_id ?? '')
      const valor = numero(linha.balance ?? linha.amount ?? linha.value)
      const atual = id ? saldos.get(id) : null
      if (!id || !atual || valor == null) continue
      atual.balance = valor
      atual.balanceAt = String(linha.updatedAt ?? linha.updated_at ?? '') || undefined
      atual.realtime = linha.realtime !== false
    }

    const cartoes = doItem.filter((id) => String(saldos.get(id)?.type ?? '').toUpperCase().includes('CREDIT'))
    if (cartoes.length > 0) {
      const bills = await ofPostSoft('/credit-card-bills/list', { account_ids: cartoes })
      for (const linha of ((bills?.results as Array<Record<string, unknown>>) ?? [])) {
        const id = String(linha.id ?? linha.account_id ?? '')
        if (id) faturas.set(id, lerFatura(linha))
      }
    }
  }

  let inserted = 0
  const results: Array<Record<string, unknown>> = []

  for (const acc of contas) {
    try {
      const fromDate = fromOverride
        ? new Date(`${fromOverride}T00:00:00Z`)
        : acc.of_last_sync_at
          ? new Date(new Date(acc.of_last_sync_at).getTime() - 3 * 86400_000)
          : new Date(Date.now() - 90 * 86400_000)
      const from = dayStr(fromDate)
      const to = dayStr(new Date())

      const rows: Record<string, unknown>[] = []
      let page = 1
      let totalPages = 1
      do {
        const pageRes = await ofPost('/transactions/list', {
          account_id: acc.of_account_id,
          from,
          to,
          page,
          page_size: 200,
        })
        const list = (pageRes.results as Array<Record<string, unknown>>) ??
          (pageRes.transactions as Array<Record<string, unknown>>) ??
          []
        totalPages = Number(pageRes.total_pages ?? pageRes.totalPages ?? 1)
        for (const t of list) {
          const id = String(t.id ?? t.transaction_id ?? '')
          if (!id) continue
          const amtRaw = Number(
            (t.amount as number | undefined) ??
              (t.transactionAmount as { amount?: string } | undefined)?.amount ??
              0,
          )
          const type = String(t.type ?? t.creditDebitType ?? '').toUpperCase()
          const isCredit =
            type.includes('CREDIT') || type.includes('CREDITO') || (!type && amtRaw >= 0)
          const magnitude = Math.abs(Math.round(amtRaw * 100))
          if (magnitude === 0) continue
          const date = String(t.date ?? t.transactionDateTime ?? '').slice(0, 10) || from
          rows.push({
            tenant_id: acc.tenant_id,
            account_id: acc.id,
            date,
            amount_cents: isCredit ? magnitude : -magnitude,
            direction: isCredit ? 'in' : 'out',
            description: String(t.description ?? t.transactionName ?? 'Lançamento'),
            counterparty: (t.counterparty as string | null) ?? (t.description as string | null) ?? null,
            source: 'openfinance',
            external_id: id,
          })
        }
        page += 1
      } while (page <= totalPages && page <= 30)

      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        const { data: ins, error: insErr } = await db
          .from('fin_transactions')
          .upsert(chunk, { onConflict: 'tenant_id,account_id,external_id', ignoreDuplicates: true })
          .select('id')
        if (insErr) throw insErr
        inserted += (ins ?? []).length
      }
      const saldo = saldos.get(acc.of_account_id)
      const sit = acc.of_item_id ? situacao.get(acc.of_item_id) : null
      const fatura = faturas.get(acc.of_account_id) ?? null
      const credito = (saldo?.creditData ?? {}) as Record<string, unknown>
      // A HORA DO BANCO, não a nossa. Carimbar new Date() aqui era o que fazia a tela dizer
      // "atualizado agora" sobre número velho: o dado podia ser da rodada anterior e nada
      // na interface deixava isso aparecer.
      const lidoEm = saldo?.balanceAt ?? sit?.dadoEm ?? null
      await db
        .from('fin_accounts')
        .update({
          of_last_sync_at: new Date().toISOString(),
          // Zera o erro: enquanto isso não existia, uma falha antiga nunca "sarava" e o
          // alerta ficaria tocando pra sempre depois que o banco voltasse.
          of_last_error: null,
          of_provider_note: (acc.of_item_id ? avisoProvedor.get(acc.of_item_id) : null) ?? null,
          ...(saldo
            ? {
                of_balance_cents: centavos(saldo.balance),
                of_balance_at: lidoEm,
                of_meta: metaDaConta(saldo, fatura),
              }
            : {}),
          ...(fatura
            ? {
                of_bill_open_cents: fatura.abertaCents,
                of_bill_due_cents: fatura.aVencerCents,
                of_debt_total_cents: fatura.dividaTotalCents,
                of_bill_close_date: fatura.fechamento ?? dataCurta(credito.balanceCloseDate),
                of_bill_due_date: fatura.vencimento ?? dataCurta(credito.balanceDueDate),
              }
            : saldo && String(saldo.type ?? '').toUpperCase().includes('CREDIT')
              ? {
                  // Fatura não veio (provedor fora do ar). Mantém o que já havia e só
                  // atualiza as datas, que vêm junto com a conta.
                  of_bill_close_date: dataCurta(credito.balanceCloseDate),
                  of_bill_due_date: dataCurta(credito.balanceDueDate),
                }
              : {}),
          ...(sit ? { of_status: [sit.status, sit.exec].filter(Boolean).join(' / ') } : {}),
        })
        .eq('id', acc.id)
      results.push({ account: acc.id, rows: rows.length })
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e)
      // Grava o motivo na conta. Antes o erro só voltava no corpo da resposta, que o cron
      // joga fora — o extrato podia estar parado há semanas com tudo "ok:true" na tela.
      await db.from('fin_accounts').update({ of_last_error: motivo.slice(0, 500) }).eq('id', acc.id)
      results.push({ account: acc.id, ok: false, note: motivo })
    }
  }

  // O pedido de atualização subiu para o INÍCIO da rodada (atualizarEEsperar): aqui no fim
  // ele fazia cada rodada colher o retrato que a anterior pediu.

  return { inserted, accounts: contas.length, results }
}
