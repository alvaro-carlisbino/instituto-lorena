/**
 * crm-focus-recebidas — o que a SEFAZ tem contra o CNPJ da clínica, e o que disso falta aqui.
 *
 * Autenticado (painel). Só LÊ e COMPARA: não importa nada e não manifesta nada. É de propósito.
 *
 * Duas coisas que a operação precisa saber e que o código respeita:
 *
 * 1. A SEFAZ guarda os documentos por ~90 DIAS. Isto nunca vai trazer o backlog antigo — o que
 *    é velho continua vindo do ZIP de XML do contador. Ver a carga de 27/jul e a de 05/ago.
 *
 * 2. A SEFAZ só entrega o XML COMPLETO (com itens) de nota que teve "ciência da operação"
 *    registrada — e ciência tem prazo de **10 dias** a partir da emissão. Passou disso, a SEFAZ
 *    responde "Evento apresentado após o prazo permitido" e o XML nunca mais existe: sobra o
 *    resumo (emitente, chave, valor, data). Medido em 14/ago contra a base real da clínica.
 *    Consequência: nota velha em resumo vira conta a pagar, NÃO vira entrada de estoque.
 *
 * Por isso `nfe_completa` vem no relatório — é ele que diz o que ainda dá pra importar inteiro.
 *
 * Esta função não manifesta nada, e não é preguiça: se um fornecedor emitir nota indevida
 * contra o CNPJ, a resposta certa é "desconhecimento", não "ciência". Dar ciência em lote no
 * escuro carimba como reconhecida uma nota que ninguém olhou.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  versao?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const { data: intg } = await admin
    .from('tenant_integrations').select('focus').eq('tenant_id', tenantId).maybeSingle()
  const cnpj = String(((intg as { focus?: Record<string, unknown> } | null)?.focus?.cnpj_prestador ?? '')).replace(/\D/g, '')
  const token = (Deno.env.get('FOCUS_NFE_TOKEN_PRODUCAO') ?? '').trim()
  if (!cnpj || !token) return json({ error: 'focus_not_configured' }, 400)

  const basic = `Basic ${btoa(`${token}:`)}`

  // ── xml: entrega o XML cru de uma nota recebida ──
  // Existe para a tela poder jogar a nota no MESMO `parseNfeXml` + `importNfe` que o upload
  // manual já usa. Reimplementar o import aqui do lado do servidor duplicaria a cascata de
  // casamento de item, o de-para de fornecedor e a geração de parcelas — e foi justamente
  // duplicata de item que queimou as duas cargas anteriores. Um caminho só.
  let corpo: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    corpo = raw ? JSON.parse(raw) : {}
  } catch { /* sem corpo = listar */ }

  if (String(corpo.action ?? '') === 'xml') {
    const chave = String(corpo.chave ?? '').replace(/\D/g, '')
    if (chave.length !== 44) return json({ error: 'chave_invalida' }, 400)
    const res = await fetch(`https://api.focusnfe.com.br/v2/nfes_recebidas/${chave}.xml`, {
      headers: { Authorization: basic },
    })
    const texto = await res.text()
    if (!res.ok || !texto.trimStart().startsWith('<')) {
      // Sem "ciência da operação" no prazo (10 dias da emissão) a SEFAZ nunca libera o XML
      // completo — fica só o resumo. Dizer isso aqui evita a tela ficar tentando para sempre.
      return json({ error: 'xml_indisponivel', chave, detail: texto.slice(0, 200) }, 404)
    }
    return json({ ok: true, chave, xml: texto })
  }

  // Paginação por `versao`: a Focus devolve 100 por vez e o X-Max-Version diz onde continuar.
  // Sem seguir isso, uma clínica com muita nota lê só as 100 primeiras e acha que acabou.
  const todas: Recebida[] = []
  let versao = 0
  for (let pagina = 0; pagina < 30; pagina++) {
    const url = `https://api.focusnfe.com.br/v2/nfes_recebidas?cnpj=${cnpj}${versao ? `&versao=${versao}` : ''}`
    const res = await fetch(url, { headers: { Authorization: basic } })
    if (!res.ok) {
      return json({ error: 'focus_erro', status: res.status, detail: (await res.text()).slice(0, 300) }, 502)
    }
    const lote = (await res.json()) as Recebida[]
    if (!Array.isArray(lote) || lote.length === 0) break
    todas.push(...lote)
    const max = Number(res.headers.get('x-max-version') ?? 0)
    if (!max || max <= versao) break
    versao = max
  }

  // O que já está aqui. A chave é a única comparação confiável: número de nota se repete
  // entre fornecedores (dois "NF 3035" diferentes já derrubaram um lote inteiro em julho).
  const chaves = todas.map((n) => String(n.chave_nfe ?? '')).filter(Boolean)
  const jaTemos = new Set<string>()
  for (let i = 0; i < chaves.length; i += 200) {
    const { data } = await admin
      .from('purchase_invoices').select('nfe_key')
      .eq('tenant_id', tenantId).in('nfe_key', chaves.slice(i, i + 200))
    for (const r of (data ?? []) as Array<{ nfe_key: string }>) jaTemos.add(r.nfe_key)
  }

  const faltando = todas.filter((n) => n.chave_nfe && !jaTemos.has(n.chave_nfe))
  const reais = (v: unknown) => Number(String(v ?? '0').replace(',', '.')) || 0

  return json({
    ok: true,
    cnpj,
    // Cortesia com quem lê: a SEFAZ só guarda ~90 dias, então "total" nunca é "tudo que já
    // existiu" — é "tudo que ainda dá pra buscar".
    aviso: 'A SEFAZ disponibiliza documentos por ~90 dias. Notas mais antigas não aparecem aqui.',
    total: todas.length,
    jaNoSistema: todas.length - faltando.length,
    faltando: faltando.length,
    valorFaltando: Math.round(faltando.reduce((s, n) => s + reais(n.valor_total), 0) * 100) / 100,
    // Sem XML completo não dá pra dar entrada no estoque — só conta a pagar.
    faltandoSemXmlCompleto: faltando.filter((n) => !n.nfe_completa).length,
    notas: faltando.map((n) => ({
      chave: n.chave_nfe,
      emitente: n.nome_emitente,
      documentoEmitente: n.documento_emitente,
      valor: reais(n.valor_total),
      dataEmissao: n.data_emissao,
      situacao: n.situacao,
      manifestacao: n.manifestacao_destinatario,
      xmlCompleto: !!n.nfe_completa,
    })),
  })
})
