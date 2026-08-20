/**
 * crm-bling-marketplace-fin — cria a CONTA A RECEBER que o pedido de marketplace não gera.
 *
 * O Bling só monta o financeiro sozinho quando o pedido nasce na TELA dele. Pedido que chega
 * por integração não gera nada: já sabíamos disso para o pedido criado pela nossa API
 * (`blingEnsureReceivable` existe por causa disso), e em 20/ago/2026 o Kauan esbarrou no mesmo
 * buraco pelo lado do marketplace — o caixa do dia não fechava porque o pedido 3696 (Mercado
 * Livre, 19/08, R$ 199,99) existia como venda e não existia no financeiro. O único outro pedido
 * de Mercado Livre que já entrou (3307, 07/07) estava igual. Dois de dois.
 *
 * Esta rotina varre os pedidos de marketplace da janela e lança o que ficou sem conta.
 *
 * ── O que ela NÃO faz, de propósito ──────────────────────────────────────────────────────────
 *
 * **Não toca em pedido da loja própria** (`loja.id = 0`). Esse já tem dois caminhos cuidando
 * dele (a tela do Bling e o `blingEnsureReceivable` da venda do site/bot); entrar aqui também
 * só criaria chance de conta duplicada.
 *
 * **Não baixa a conta.** O valor lançado é o BRUTO, que é o que o cliente pagou e o que sai na
 * NF-e. A comissão do marketplace é despesa financeira e entra como `tarifa` na baixa — mesma
 * decisão do Álvaro em 29/jul para a taxa da adquirente. Baixar pelo líquido faria a nota sair
 * por menos que o vendido. E a comissão do ML **não vem na API do pedido**: sem o número real,
 * a conta fica EM ABERTO para o financeiro baixar, nunca baixada com taxa chutada.
 *
 * **Não lança pedido cancelado, em digitação ou em devolução.** Não há o que receber.
 *
 * ── A trava que impede conta duplicada ───────────────────────────────────────────────────────
 *
 * O vínculo conta↔pedido é READ-ONLY no Bling (só ele preenche `idOrigem`, quando ele mesmo
 * gera o financeiro), e `numeroDocumento` — onde a gente grava o nº do pedido — **só vem no
 * DETALHE da conta, não na listagem**. Sobra casar por contato + valor + data de emissão, que é
 * o mesmo índice que o `settle_open_receivables` usa.
 *
 * E o índice só vale se o filtro de data tiver sido respeitado: `dataEmissaoInicial` e
 * `dataVencimentoInicial` são ACEITOS e IGNORADOS pelo Bling (conferido em 19 e 20/ago), e a
 * listagem volta do começo do histórico. Índice montado em cima disso não encontraria a conta
 * da janela e a rotina lançaria tudo de novo. Por isso: se a primeira página vier com emissão
 * anterior à janela, ela ABORTA sem escrever. Errar para o lado de não lançar é barato; lançar
 * duas vezes no financeiro do cliente não é.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { getValidBlingToken } from '../_shared/bling.ts'

const API = 'https://api.bling.com.br/Api/v3'

/** Cancelado, Em digitação, Em devolução: não há o que receber. */
const SITUACOES_SEM_RECEBER = new Set([12, 21, 814971])

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v).trim())

/** Dia no fuso de Brasília. A função roda em UTC; depois das 21h `toISOString()` vira amanhã. */
function diaSP(d: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

const cents = (v: unknown) => Math.round(Number(v ?? 0) * 100)

type Criada = {
  pedido: string
  canal: string
  valor: number
  vencimento: string
  contaId: string | null
  erro?: string
}

/**
 * A service_role que chega no Authorization nem sempre é byte a byte a que o runtime tem em
 * `SUPABASE_SERVICE_ROLE_KEY` — o projeto tem chave legada e chave nova convivendo, as duas
 * funcionam no PostgREST e os digests são diferentes. Comparar string dá 401 calado em script
 * externo. Aqui: lê a claim `role` e CONFIRMA a assinatura no PostgREST, porque esta função roda
 * com verify_jwt=false e a plataforma não validou nada antes. Claim sozinha não vale — JWT
 * forjado com `role: service_role` toma 401 lá.
 */
async function ehServiceRoleAssinada(supabaseUrl: string, bearer: string): Promise<boolean> {
  try {
    const partes = bearer.split('.')
    if (partes.length !== 3) return false
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))) as Record<string, unknown>
    if (claims.role !== 'service_role') return false
    const res = await fetch(`${supabaseUrl}/rest/v1/tenant_integrations?select=tenant_id&limit=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    })
    return res.ok
  } catch {
    return false
  }
}

async function blingGet(url: string, bh: Record<string, string>): Promise<Record<string, unknown> | null> {
  const r = await fetch(url, { headers: bh })
  if (!r.ok) return null
  try {
    return JSON.parse((await r.text()) || '{}') as Record<string, unknown>
  } catch {
    return null
  }
}

async function varrerPolo(
  admin: SupabaseClient,
  tenantId: string,
  dias: number,
  dry: boolean,
  limite: number,
): Promise<Record<string, unknown>> {
  const token = await getValidBlingToken(admin, tenantId)
  if (!token) return { tenantId, erro: 'bling_sem_token' }
  const bh = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }

  const hoje = diaSP(new Date())
  const desde = diaSP(new Date(Date.now() - dias * 86400000))

  // ── 1. Pedidos da janela ────────────────────────────────────────────────────────────────
  const pedidos: Array<Record<string, unknown>> = []
  for (let pagina = 1; pagina <= 10; pagina++) {
    const d = await blingGet(`${API}/pedidos/vendas?dataInicial=${desde}&dataFinal=${hoje}&limite=100&pagina=${pagina}`, bh)
    const linhas = (d?.data ?? []) as Array<Record<string, unknown>>
    pedidos.push(...linhas)
    if (linhas.length < 100) break
  }

  const alvo = pedidos.filter((p) => {
    const loja = str((p.loja as Record<string, unknown> | undefined)?.id, '0')
    if (loja === '0' || loja === '') return false
    const sit = Number((p.situacao as Record<string, unknown> | undefined)?.id ?? 0)
    return !SITUACOES_SEM_RECEBER.has(sit)
  })

  if (!alvo.length) {
    return { tenantId, janela: { desde, ate: hoje }, pedidos: pedidos.length, marketplace: 0, criadas: [] }
  }

  // ── 2. Índice das contas a receber da janela ────────────────────────────────────────────
  // Chave: contato | valor em centavos | data de emissão. Ver o cabeçalho para o porquê de não
  // dar pra usar `idOrigem` nem `numeroDocumento` aqui.
  const indice = new Set<string>()
  let filtroIgnorado = false
  for (let pagina = 1; pagina <= 20; pagina++) {
    const url = `${API}/contas/receber?pagina=${pagina}&limite=100`
      + `&dataInicial=${desde}&dataFinal=${hoje}&tipoFiltroData=E`
    const d = await blingGet(url, bh)
    if (!d) break
    const linhas = (d.data ?? []) as Array<Record<string, unknown>>
    for (const c of linhas) {
      const emissao = str(c.dataEmissao)
      // O Bling aceita e ignora alguns filtros de data. Emissão antes da janela = listagem
      // inteira, índice sem valor, e lançar em cima disso duplicaria conta.
      if (emissao && emissao < desde) { filtroIgnorado = true; break }
      const contatoId = str((c.contato as Record<string, unknown> | undefined)?.id)
      indice.add(`${contatoId}|${cents(c.valor)}|${emissao}`)
    }
    if (filtroIgnorado || linhas.length < 100) break
  }

  if (filtroIgnorado) {
    return {
      tenantId,
      janela: { desde, ate: hoje },
      pedidos: pedidos.length,
      marketplace: alvo.length,
      erro: 'filtro_de_data_ignorado',
      detalhe: 'A listagem de contas a receber voltou emissão anterior à janela. Sem índice confiável não se lança nada, senão duplica.',
      criadas: [],
    }
  }

  // ── 3. Lança o que ficou sem conta ──────────────────────────────────────────────────────
  const criadas: Criada[] = []
  const jaTem: string[] = []
  for (const p of alvo) {
    if (criadas.length >= limite) break
    const numero = str(p.numero)
    const contatoId = str((p.contato as Record<string, unknown> | undefined)?.id)
    const dataPedido = str(p.data)
    const valor = Number(p.total ?? 0)
    const canal = str((p.loja as Record<string, unknown> | undefined)?.id)
    if (!contatoId || !(valor > 0) || !dataPedido) continue

    if (indice.has(`${contatoId}|${cents(valor)}|${dataPedido}`)) { jaTem.push(numero); continue }

    // Vencimento real = a data em que o marketplace libera o dinheiro, que vem na parcela do
    // pedido (o ML solta ~30 dias depois). Só o DETALHE traz as parcelas.
    const det = await blingGet(`${API}/pedidos/vendas/${str(p.id)}`, bh)
    const parcelas = ((det?.data as Record<string, unknown> | undefined)?.parcelas ?? []) as Array<Record<string, unknown>>
    const parcela = parcelas[0] ?? null
    const vencimento = str(parcela?.dataVencimento) || dataPedido
    const formaPagamentoId = str((parcela?.formaPagamento as Record<string, unknown> | undefined)?.id)

    if (dry) {
      criadas.push({ pedido: numero, canal, valor, vencimento, contaId: null, erro: 'dry_run' })
      continue
    }

    const body: Record<string, unknown> = {
      vencimento,
      dataEmissao: dataPedido,
      valor,
      contato: { id: Number(contatoId) || contatoId },
      numeroDocumento: numero.slice(0, 20),
      historico: `Venda ${numero} — marketplace (automático). Valor bruto; comissão do canal entra como tarifa na baixa.`.slice(0, 200),
      ...(formaPagamentoId ? { formaPagamento: { id: Number(formaPagamentoId) || formaPagamentoId } } : {}),
    }
    const res = await fetch(`${API}/contas/receber`, { method: 'POST', headers: bh, body: JSON.stringify(body) })
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 200)
      console.warn('[bling-mkt-fin] conta a receber falhou', numero, res.status, txt)
      criadas.push({ pedido: numero, canal, valor, vencimento, contaId: null, erro: `http_${res.status}` })
      continue
    }
    let contaId: string | null = null
    try {
      contaId = str(((JSON.parse((await res.text()) || '{}') as Record<string, unknown>).data as Record<string, unknown>)?.id) || null
    } catch { /* a conta pode ter nascido mesmo assim; o índice pega na próxima rodada */ }

    criadas.push({ pedido: numero, canal, valor, vencimento, contaId })

    // Rastro no CRM. Lançamento em financeiro de produção feito por robô tem que aparecer em
    // algum lugar que não seja só o log da função, senão vira o mesmo buraco silencioso.
    await admin.from('audit_logs').insert({
      tenant_id: tenantId,
      action: 'bling.marketplace_receivable_created',
      target_table: 'bling.contas_receber',
      target_id: contaId,
      metadata: { pedido: numero, canal, valor, vencimento, data_emissao: dataPedido, contato_id: contatoId },
    })
  }

  return { tenantId, janela: { desde, ate: hoje }, pedidos: pedidos.length, marketplace: alvo.length, jaTem, criadas }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  let p: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    p = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  // verify_jwt=false: a autorização é o x-cron-secret (pg_cron não tem service_role à mão) ou
  // a própria service_role no Authorization, para rodar à mão.
  const segredoRecebido = str(req.headers.get('x-cron-secret'))
  const { data: seg } = await admin.from('app_cron_secrets').select('secret').eq('key', 'bling_marketplace_fin').maybeSingle()
  const esperado = str((seg as { secret?: string } | null)?.secret)
  const porCron = esperado.length > 0 && segredoRecebido === esperado
  const bearer = str(req.headers.get('Authorization')).replace(/^Bearer\s+/i, '')
  const porServiceRole = bearer.length > 0 && (bearer === serviceRole || await ehServiceRoleAssinada(supabaseUrl, bearer))
  if (!porCron && !porServiceRole) return json({ error: 'unauthorized' }, 401)

  const dias = Math.min(Math.max(Number(p.dias ?? 7), 1), 60)
  const dry = p.dry === true
  const limite = Math.min(Math.max(Number(p.limite ?? 50), 1), 200)

  // Sem polo no corpo, varre todo mundo que tem Bling ligado.
  let tenants = [str(p.tenantId)].filter(Boolean)
  if (!tenants.length) {
    const { data } = await admin.from('tenant_integrations').select('tenant_id, bling')
    tenants = ((data ?? []) as Array<{ tenant_id: string; bling: Record<string, unknown> | null }>)
      .filter((r) => str(r.bling?.access_token))
      .map((r) => r.tenant_id)
  }

  const resultados: Array<Record<string, unknown>> = []
  for (const t of tenants) resultados.push(await varrerPolo(admin, t, dias, dry, limite))

  return json({ ok: true, dry, dias, resultados })
})
