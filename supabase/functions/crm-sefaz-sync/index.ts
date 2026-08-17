/**
 * crm-sefaz-sync — o que a SEFAZ tem contra o CNPJ do polo entra sozinho, todo dia.
 *
 * Roda por cron, sem usuário. Faz três coisas, nesta ordem, e a ordem é o ponto:
 *
 * 1. CAPTURA (irreversível, por isso vem primeiro). Lista as notas e guarda em
 *    `sefaz_documentos`. Para toda nota com XML completo disponível, baixa e guarda o XML.
 *    A SEFAZ mantém o documento ~90 dias, mas o XML COMPLETO só existe se houve ciência da
 *    operação nos 10 dias da emissão — depois disso ele nunca mais volta. Guardar o arquivo
 *    é o único passo que não dá pra fazer depois.
 *
 * 2. LANÇA AS NOTAS EM RESUMO. Sem XML não há itens, então a nota vira fornecedor + documento
 *    + UMA parcela EM ABERTO vencendo na emissão. Em aberto porque o resumo não diz nada sobre
 *    pagamento, e marcar como paga seria inventar. Boa parte já saiu do banco: quem confere
 *    corrige contra o extrato. Carimbado errado, ninguém descobre.
 *
 * 3. NÃO lança as notas COMPLETAS. Elas exigem a cascata de casamento de item, lote e espelho
 *    no Bling que vive em `src/services/nfeImport.ts`, em cima do client do navegador. Duplicar
 *    isso aqui é exatamente o que queimou as cargas de julho e agosto (item repetido). O XML
 *    fica guardado e o painel lança inteiras num clique, sem prazo correndo.
 *
 * Nada aqui manifesta nada. Se um fornecedor emite nota indevida contra o CNPJ, a resposta certa
 * é "desconhecimento", não "ciência" — e isso é decisão de gente, não de cron.
 *
 * `tenant_id` vai EXPLÍCITO em todo insert: por service_role `auth.uid()` é nulo, então o default
 * `current_tenant_id()` das tabelas sairia nulo e a nota nasceria sem polo.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { DOMParser } from 'https://esm.sh/@xmldom/xmldom@0.9.6'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

type Recebida = {
  chave_nfe?: string
  nome_emitente?: string
  documento_emitente?: string
  valor_total?: string
  data_emissao?: string
  situacao?: string
  manifestacao_destinatario?: string
  nfe_completa?: boolean
}

type DocRow = {
  id: string
  chave: string
  numero: string | null
  emitente: string | null
  cnpj_emitente: string | null
  valor_cents: number
  data_emissao: string | null
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const reais = (v: unknown) => Number(String(v ?? '0').replace(',', '.')) || 0
const emCentavos = (v: unknown) => Math.round(reais(v) * 100)

/** Data pura do payload, sem passar por fuso: `new Date(...)` viraria o dia em UTC-3. */
const diaDe = (iso: unknown): string | null => {
  const d = String(iso ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/** O número da nota mora nas posições 26-34 da chave. Sem XML, é o único lugar de onde tirar. */
const numeroDaChave = (chave: string) => String(Number(chave.slice(25, 34) || '0')) || chave.slice(-6)

type Parcela = { numero: string; vencimento: string; centavos: number }

/**
 * Lê do XML só o CABEÇALHO e as DUPLICATAS. Os itens ficam de fora de propósito.
 *
 * Não é meio parser por preguiça: o que o servidor precisa pra montar a conta a pagar é o
 * total e o vencimento real de cada duplicata, e isso o layout da NF-e entrega em tags fixas.
 * Já transformar `det` em estoque exige a cascata de EAN → SKU → nome → alias contra o catálogo
 * do polo, que vive em `src/services/nfeImport.ts`. Ter DUAS implementações daquele casamento é
 * exatamente o que criou item duplicado nas cargas de julho e agosto. Uma só, no navegador.
 */
function parseNfeFinanceiro(xml: string): {
  numero: string
  serie: string | null
  emissao: string | null
  cnpj: string | null
  nome: string | null
  totalCents: number
  parcelas: Parcela[]
} {
  // deno-lint-ignore no-explicit-any
  const doc: any = new DOMParser().parseFromString(xml, 'text/xml')
  const infNFe = doc?.getElementsByTagName('infNFe')?.[0]
  if (!infNFe) throw new Error('XML sem infNFe')

  // deno-lint-ignore no-explicit-any
  const txt = (parent: any, tag: string): string | null => {
    const el = parent?.getElementsByTagName(tag)?.[0]
    const v = el?.textContent?.trim()
    return v ? v : null
  }
  const cents = (raw: string | null) => {
    const n = Number(raw ?? '')
    return Number.isFinite(n) ? Math.round(n * 100) : 0
  }
  // dhEmi vem ISO com fuso, dEmi (layout antigo) já vem yyyy-mm-dd. Cortar em 10 evita o
  // `new Date()` que jogaria o dia pra trás em UTC-3.
  const dia = (raw: string | null) => {
    const d = (raw ?? '').slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
  }

  const ide = infNFe.getElementsByTagName('ide')?.[0]
  const emit = infNFe.getElementsByTagName('emit')?.[0]
  const icmsTot = infNFe.getElementsByTagName('ICMSTot')?.[0]

  const parcelas: Parcela[] = []
  const cobr = infNFe.getElementsByTagName('cobr')?.[0]
  if (cobr) {
    const dups = cobr.getElementsByTagName('dup')
    for (let i = 0; i < dups.length; i += 1) {
      const dup = dups[i]
      const vencimento = dia(txt(dup, 'dVenc'))
      const centavos = cents(txt(dup, 'vDup'))
      if (vencimento && centavos > 0) {
        parcelas.push({ numero: txt(dup, 'nDup') ?? String(i + 1), vencimento, centavos })
      }
    }
  }

  return {
    numero: (ide ? txt(ide, 'nNF') : null) ?? '',
    serie: ide ? txt(ide, 'serie') : null,
    emissao: ide ? dia(txt(ide, 'dhEmi') ?? txt(ide, 'dEmi')) : null,
    cnpj: emit ? txt(emit, 'CNPJ') : null,
    nome: emit ? txt(emit, 'xNome') : null,
    totalCents: icmsTot ? cents(txt(icmsTot, 'vNF')) : 0,
    parcelas,
  }
}

/** Paginação por `versao`: a Focus devolve 100 por vez e o X-Max-Version diz onde continuar.
 *  Sem seguir isso, uma clínica com muita nota lê só as 100 primeiras e acha que acabou. */
async function listarRecebidas(cnpj: string, basic: string): Promise<Recebida[]> {
  const todas: Recebida[] = []
  let versao = 0
  for (let pagina = 0; pagina < 30; pagina++) {
    const url = `https://api.focusnfe.com.br/v2/nfes_recebidas?cnpj=${cnpj}${versao ? `&versao=${versao}` : ''}`
    const res = await fetch(url, { headers: { Authorization: basic } })
    if (!res.ok) throw new Error(`focus ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const lote = (await res.json()) as Recebida[]
    if (!Array.isArray(lote) || lote.length === 0) break
    todas.push(...lote)
    const max = Number(res.headers.get('x-max-version') ?? 0)
    if (!max || max <= versao) break
    versao = max
  }
  return todas
}

/** O sufixo é `.xml`, não `/xml` — o segundo devolve 404 e parece "nota sem XML". */
async function baixarXml(chave: string, basic: string): Promise<string | null> {
  const res = await fetch(`https://api.focusnfe.com.br/v2/nfes_recebidas/${chave}.xml`, {
    headers: { Authorization: basic },
  })
  const texto = await res.text()
  if (!res.ok || !texto.trimStart().startsWith('<')) return null
  return texto
}

/**
 * Lança UMA nota: fornecedor + documento + parcelas em aberto.
 *
 * Serve os dois casos, e a diferença está só nos `dados` que chegam:
 *   - resumo   → uma parcela, vencendo na emissão, porque a SEFAZ não mandou a duplicata;
 *   - completa → as duplicatas reais lidas do XML (`cobr/dup`).
 *
 * Em aberto nos dois casos. Nem o resumo nem o XML dizem se a nota foi paga — quem sabe isso é
 * o extrato do banco. Já houve o erro inverso aqui (dar um lote como vencido quando 15 parcelas
 * venciam no futuro): em aberto e visível, quem confere corrige; carimbado errado, ninguém acha.
 *
 * Idempotente pelo índice `purchase_invoices_nfe_key_uniq`: se a nota já entrou por outro
 * caminho (upload manual, ZIP do contador), a inserção falha e a gente adota a nota existente
 * em vez de criar uma segunda. Comparar por número não serviria — dois fornecedores com a mesma
 * "NF 3035" já derrubaram um lote inteiro em julho.
 */
async function lancarNota(
  admin: SupabaseClient,
  tenantId: string,
  doc: DocRow,
  fornecedores: Array<{ id: string; cnpj: string | null; name: string }>,
  dados: {
    numero: string
    emissao: string | null
    totalCents: number
    cnpj: string | null
    nome: string | null
    parcelas: Parcela[]
    nota: string
  },
): Promise<{ ok: boolean; invoiceId?: string; erro?: string }> {
  try {
    const cnpj = soDigitos(dados.cnpj) || soDigitos(doc.cnpj_emitente)

    // Fornecedor pelo CNPJ (só dígitos): o nome varia entre notas, o CNPJ não.
    let fornecedor = cnpj ? fornecedores.find((f) => soDigitos(f.cnpj) === cnpj) ?? null : null
    if (!fornecedor) {
      const { data, error } = await admin
        .from('stock_suppliers')
        .insert({
          tenant_id: tenantId,
          name: dados.nome?.trim() || doc.emitente?.trim() || `Fornecedor ${cnpj || doc.chave.slice(6, 20)}`,
          cnpj: cnpj || null,
          active: true,
        })
        .select('id, cnpj, name')
        .single()
      if (error) throw new Error(`fornecedor: ${error.message}`)
      fornecedor = data as { id: string; cnpj: string | null; name: string }
      fornecedores.push(fornecedor)
    }

    const numero = dados.numero || doc.numero || numeroDaChave(doc.chave)
    const emissao = dados.emissao ?? doc.data_emissao
    // O total do XML manda quando existe: o valor da listagem é o que a SEFAZ resumiu.
    const totalCents = dados.totalCents > 0 ? dados.totalCents : doc.valor_cents

    let invoiceId: string | null = null
    const { data: inv, error: invErr } = await admin
      .from('purchase_invoices')
      .insert({
        tenant_id: tenantId,
        number: numero,
        supplier_id: fornecedor.id,
        issue_date: emissao,
        total_cents: totalCents,
        nfe_key: doc.chave,
        note: dados.nota,
      })
      .select('id')
      .single()

    if (invErr) {
      if (!/duplicate|unique/i.test(invErr.message)) throw new Error(`nota: ${invErr.message}`)
      // Já existia: adota a nota que está lá em vez de criar uma segunda.
      const { data: achada } = await admin
        .from('purchase_invoices').select('id')
        .eq('tenant_id', tenantId).eq('nfe_key', doc.chave).maybeSingle()
      invoiceId = (achada as { id: string } | null)?.id ?? null
      if (!invoiceId) throw new Error('nota duplicada mas não encontrada')
    } else {
      invoiceId = (inv as { id: string }).id
    }

    // As parcelas são conferidas à parte porque a execução pode ter morrido entre os dois
    // inserts: sem isso, a reexecução veria a nota pronta e a conta a pagar nunca nasceria.
    const { count } = await admin
      .from('payable_installments').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('invoice_id', invoiceId)

    if (!count) {
      const linhas = dados.parcelas.length > 0
        ? dados.parcelas.map((p) => ({
            description: `NF ${numero} — parcela ${p.numero}`,
            due_date: p.vencimento,
            amount_cents: p.centavos,
            payment_method: 'boleto' as string | null,
            note: 'Duplicata do XML da NF-e. Conferir se já foi paga.',
          }))
        // Sem duplicata (compra à vista, balcão) o vencimento é a emissão. Sem isso a nota
        // entraria só como documento e o gasto sumiria do financeiro.
        : totalCents > 0 && emissao
          ? [{
              description: `NF ${numero} — ${fornecedor.name}`,
              due_date: emissao,
              amount_cents: totalCents,
              payment_method: null as string | null,
              note: 'Vencimento = emissão: a nota não traz duplicata. Conferir se já foi paga.',
            }]
          : []

      if (linhas.length > 0) {
        const { error: payErr } = await admin.from('payable_installments').insert(
          linhas.map((l) => ({
            ...l,
            tenant_id: tenantId,
            supplier_id: fornecedor.id,
            invoice_id: invoiceId,
            status: 'aberto',
            import_key: `sefaz:${doc.chave}`,
          })),
        )
        if (payErr) throw new Error(`parcela: ${payErr.message}`)
      }
    }

    return { ok: true, invoiceId: invoiceId! }
  } catch (e) {
    return { ok: false, erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, serviceRole)

  // Duas portas, porque são dois chamadores legítimos:
  //   cron    → x-cron-secret. Segredo em tabela (não em env) pelo mesmo motivo do cron de
  //             cirurgia: o cron do Postgres lê a tabela, e ligar um cron novo não exige
  //             redeploy pra publicar secret.
  //   painel  → sessão do usuário, pro botão "sincronizar agora". Nesse caso a rodada fica
  //             PRESA no polo dele: sem isso um usuário do Tricopill dispararia a captura da
  //             clínica, e polo não mistura nem na tela.
  const { data: segredo } = await admin
    .from('app_cron_secrets').select('secret').eq('key', 'sefaz').maybeSingle()
  const esperado = String((segredo as { secret?: string } | null)?.secret ?? '').trim()
  const recebido = (req.headers.get('x-cron-secret') ?? '').trim()

  let tenantDoUsuario: string | null = null
  if (!esperado || recebido !== esperado) {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'unauthorized' }, 401)
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'unauthorized' }, 401)
    const { data: tid } = await userClient.rpc('current_tenant_id')
    tenantDoUsuario = typeof tid === 'string' ? tid.trim() : ''
    if (!tenantDoUsuario) return json({ error: 'tenant_not_resolved' }, 400)
  }

  const token = (Deno.env.get('FOCUS_NFE_TOKEN_PRODUCAO') ?? '').trim()
  if (!token) return json({ error: 'focus_not_configured' }, 400)
  const basic = `Basic ${btoa(`${token}:`)}`

  let corpo: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    corpo = raw ? JSON.parse(raw) : {}
  } catch { /* sem corpo = rodada normal */ }
  // Conferência sem escrita: roda o parser real sobre um XML já guardado e devolve o que ele
  // leu. Existe pra dar pra comparar o resultado do servidor com o que o navegador lançou pela
  // mesma nota, antes de confiar no caminho automático. Não toca em nada.
  if (typeof corpo.conferirChave === 'string') {
    const chave = soDigitos(corpo.conferirChave)
    let q = admin.from('sefaz_documentos').select('tenant_id, chave, xml').eq('chave', chave)
    // Usuário só confere nota do próprio polo. Pelo cron (sem usuário) não há o que restringir.
    if (tenantDoUsuario) q = q.eq('tenant_id', tenantDoUsuario)
    const { data } = await q.maybeSingle()
    const xml = (data as { xml?: string } | null)?.xml
    if (!xml) return json({ error: 'sem_xml_guardado', chave }, 404)
    try {
      return json({ ok: true, chave, lido: parseNfeFinanceiro(xml) })
    } catch (e) {
      return json({ error: 'parse_falhou', detail: e instanceof Error ? e.message : String(e) }, 422)
    }
  }

  // Teto de tempo por rodada: a captura vem primeiro, então uma rodada curta nunca perde XML —
  // ela só adia lançamento, que não expira. O cron do dia seguinte continua de onde parou.
  const deadline = Date.now() + Math.min(Number(corpo.orcamentoMs ?? 0) || 110_000, 240_000)
  const lancar = corpo.lancar !== false

  // Só polo que tem Focus configurado. O Tricopill tem `focus` vazio e fica de fora sozinho.
  const { data: integracoes } = await admin
    .from('tenant_integrations').select('tenant_id, focus')

  const relatorio: Record<string, unknown>[] = []

  for (const row of (integracoes ?? []) as Array<{ tenant_id: string; focus: Record<string, unknown> | null }>) {
    const tenantId = row.tenant_id
    if (tenantDoUsuario && tenantId !== tenantDoUsuario) continue
    const cnpj = soDigitos(row.focus?.cnpj_prestador)
    if (!cnpj) continue

    const conta: Record<string, unknown> = { tenant: tenantId, cnpj }
    try {
      // ── 1. captura ────────────────────────────────────────────────────────────────────
      const notas = await listarRecebidas(cnpj, basic)
      conta.naSefaz = notas.length

      // Dedup por chave ANTES de gravar. A paginação por `versao` devolve a mesma nota mais de
      // uma vez quando ela mudou de versão na SEFAZ, e o Postgres recusa o lote inteiro com
      // "ON CONFLICT DO UPDATE command cannot affect row a second time". Fica a última versão,
      // que é a mais recente — é ela que traz `nfe_completa` já ligado.
      const porChave = new Map<string, Recebida>()
      for (const n of notas) {
        const chave = soDigitos(n.chave_nfe)
        if (chave.length === 44) porChave.set(chave, n)
      }

      const linhas = [...porChave.values()]
        .map((n) => ({
          tenant_id: tenantId,
          chave: soDigitos(n.chave_nfe),
          numero: numeroDaChave(soDigitos(n.chave_nfe)),
          emitente: n.nome_emitente ?? null,
          cnpj_emitente: soDigitos(n.documento_emitente) || null,
          valor_cents: emCentavos(n.valor_total),
          data_emissao: diaDe(n.data_emissao),
          situacao: n.situacao ?? null,
          manifestacao: n.manifestacao_destinatario ?? null,
          xml_completo: !!n.nfe_completa,
          updated_at: new Date().toISOString(),
        }))

      // `ignoreDuplicates: false` para o upsert refrescar situação/manifestação/xml_completo,
      // que mudam com o tempo. `xml` e `status` não estão na lista, então não são tocados —
      // no PostgREST, coluna omitida no upsert NÃO vira null, fica como está.
      for (let i = 0; i < linhas.length; i += 200) {
        const { error } = await admin
          .from('sefaz_documentos')
          .upsert(linhas.slice(i, i + 200), { onConflict: 'tenant_id,chave', ignoreDuplicates: false })
        if (error) throw new Error(`staging: ${error.message}`)
      }
      conta.capturadas = linhas.length

      // ── 1b. adota o que já entrou por fora ────────────────────────────────────────────
      // O painel, o upload manual de XML e o ZIP do contador lançam nota sem passar por aqui.
      // Sem esta conferência o staging continuaria marcando como pendente o que já está na
      // conta a pagar — e a rodada seguinte tentaria lançar de novo, tomando erro de chave
      // duplicada em vez de simplesmente reconhecer o serviço feito.
      const { data: jaLancadas } = await admin
        .from('purchase_invoices').select('id, nfe_key')
        .eq('tenant_id', tenantId).not('nfe_key', 'is', null)
      let adotadas = 0
      for (const inv of (jaLancadas ?? []) as Array<{ id: string; nfe_key: string }>) {
        const { data: upd } = await admin
          .from('sefaz_documentos')
          .update({ status: 'lancado', invoice_id: inv.id, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('chave', inv.nfe_key).eq('status', 'novo')
          .select('id')
        adotadas += (upd ?? []).length
      }
      conta.adotadasDeOutroCaminho = adotadas

      // ── 2. o XML, enquanto existe ─────────────────────────────────────────────────────
      const { data: semXml } = await admin
        .from('sefaz_documentos').select('id, chave')
        .eq('tenant_id', tenantId).eq('xml_completo', true).is('xml', null)
        .order('data_emissao', { ascending: false })
        .limit(200)
      let baixados = 0
      let semXmlNaFocus = 0
      for (const d of (semXml ?? []) as Array<{ id: string; chave: string }>) {
        if (Date.now() > deadline) break
        const xml = await baixarXml(d.chave, basic)
        if (!xml) {
          // A Focus marcou como completa mas não entrega. Não vira erro: na próxima rodada
          // tenta de novo, e enquanto a nota estiver na janela ainda dá tempo.
          semXmlNaFocus += 1
          continue
        }
        await admin.from('sefaz_documentos')
          .update({ xml, xml_baixado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', d.id)
        baixados += 1
      }
      conta.xmlBaixados = baixados
      conta.xmlNaoEntregue = semXmlNaFocus

      // ── 3. lança o que dá sem julgamento humano: as em resumo ─────────────────────────
      if (lancar) {
        const { data: fornecedoresRaw } = await admin
          .from('stock_suppliers').select('id, cnpj, name').eq('tenant_id', tenantId)
        const fornecedores = (fornecedoresRaw ?? []) as Array<{ id: string; cnpj: string | null; name: string }>

        const { data: pendentes } = await admin
          .from('sefaz_documentos')
          .select('id, chave, numero, emitente, cnpj_emitente, valor_cents, data_emissao')
          .eq('tenant_id', tenantId).eq('status', 'novo').eq('xml_completo', false)
          .order('data_emissao', { ascending: true })
          .limit(Math.min(Number(corpo.limiteLancamento ?? 0) || 400, 400))

        let lancadas = 0
        let falhas = 0
        // Sequencial de propósito: duas notas do mesmo fornecedor novo, em paralelo, criariam
        // dois cadastros. O `fornecedores` cresce durante o laço e a próxima nota já o enxerga.
        for (const doc of (pendentes ?? []) as DocRow[]) {
          if (Date.now() > deadline) break
          const r = await lancarNota(admin, tenantId, doc, fornecedores, {
            numero: doc.numero ?? '',
            emissao: doc.data_emissao,
            totalCents: doc.valor_cents,
            cnpj: doc.cnpj_emitente,
            nome: doc.emitente,
            parcelas: [],
            nota: 'Importada da SEFAZ (resumo, sem XML completo) — sem itens de estoque.',
          })
          await admin.from('sefaz_documentos').update({
            status: r.ok ? 'lancado' : 'erro',
            invoice_id: r.invoiceId ?? null,
            erro: r.erro ?? null,
            updated_at: new Date().toISOString(),
          }).eq('id', doc.id)
          if (r.ok) lancadas += 1
          else falhas += 1
        }
        conta.resumosLancados = lancadas
        conta.resumosComErro = falhas

        // ── 3b. as completas: financeiro agora, estoque depois ──────────────────────────
        // O XML já está guardado, então o vencimento real de cada duplicata entra certo. O que
        // fica pendente é só a entrada de estoque, que precisa do casamento de item.
        const { data: completas } = await admin
          .from('sefaz_documentos')
          .select('id, chave, numero, emitente, cnpj_emitente, valor_cents, data_emissao')
          .eq('tenant_id', tenantId).eq('status', 'novo').eq('xml_completo', true)
          .not('xml', 'is', null)
          .order('data_emissao', { ascending: true })
          .limit(Math.min(Number(corpo.limiteLancamento ?? 0) || 200, 200))

        let completasLancadas = 0
        let completasComErro = 0
        for (const doc of (completas ?? []) as DocRow[]) {
          if (Date.now() > deadline) break
          // O XML vem numa consulta por nota: uma NF-e passa de 100KB e trazer 200 de uma vez
          // estoura a memória da função.
          const { data: comXml } = await admin
            .from('sefaz_documentos').select('xml').eq('id', doc.id).maybeSingle()
          const xml = (comXml as { xml?: string } | null)?.xml
          if (!xml) continue

          let r: { ok: boolean; invoiceId?: string; erro?: string }
          try {
            const fin = parseNfeFinanceiro(xml)
            r = await lancarNota(admin, tenantId, doc, fornecedores, {
              numero: fin.numero,
              emissao: fin.emissao,
              totalCents: fin.totalCents,
              cnpj: fin.cnpj,
              nome: fin.nome,
              parcelas: fin.parcelas,
              nota: `Importada da SEFAZ (XML completo${fin.serie ? `, série ${fin.serie}` : ''}) — estoque pendente de conferência.`,
            })
          } catch (e) {
            r = { ok: false, erro: (e instanceof Error ? e.message : String(e)).slice(0, 300) }
          }

          await admin.from('sefaz_documentos').update({
            status: r.ok ? 'lancado' : 'erro',
            invoice_id: r.invoiceId ?? null,
            erro: r.erro ?? null,
            estoque_pendente: r.ok,
            updated_at: new Date().toISOString(),
          }).eq('id', doc.id)
          if (r.ok) completasLancadas += 1
          else completasComErro += 1
        }
        conta.completasLancadas = completasLancadas
        conta.completasComErro = completasComErro
      }

      // O que sobrou pra gente: nota já no financeiro, esperando entrada de estoque no painel.
      const { count: aguardando } = await admin
        .from('sefaz_documentos').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('estoque_pendente', true)
      conta.estoqueAguardandoPainel = aguardando ?? 0
    } catch (e) {
      conta.erro = (e instanceof Error ? e.message : String(e)).slice(0, 300)
    }
    relatorio.push(conta)
  }

  return json({ ok: true, polos: relatorio })
})
