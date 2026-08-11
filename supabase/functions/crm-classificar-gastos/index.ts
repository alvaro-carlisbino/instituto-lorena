// SUGESTÃO DE CATEGORIA POR IA — para os lançamentos que regex nenhum resolve.
//
// A classificação automática que já existe é casamento de texto: pega "TRIBUTOS", "APLIC AUT",
// "TARIFA". Isso cobriu R$ 1,05 milhão e parou. O que sobra — R$ 2,35 milhões em 315 pagadores
// diferentes: fornecedor, médico, folha, aluguel — não tem palavra-chave: são nomes de empresa e
// de pessoa, e só quem conhece a operação sabe o que cada um é. É exatamente o tipo de tarefa que
// um LLM acerta bem e que regra fixa não alcança.
//
// TRÊS DECISÕES QUE FAZEM ISTO SER SEGURO:
//
// 1. A função NÃO ESCREVE NADA. Devolve sugestão; quem grava é o usuário aprovando na tela, e a
//    aprovação passa pelo mesmo caminho de sempre (fin_category_rules). IA que carimba sozinha
//    o razão de uma clínica é como não ter conferência nenhuma — e classificação errada aqui
//    contamina o DRE inteiro sem ninguém perceber.
//
// 2. O modelo escolhe DENTRO da lista de categorias que mandamos. Categoria inventada não tem
//    id, não vira regra, e o "Outros" existe justamente pra ele ter pra onde fugir em vez de
//    forçar uma classificação errada.
//
// 3. Só vai o PAGADOR AGREGADO — nome, quantas vezes, quanto somou. Não vai valor individual,
//    não vai data, não vai descrição de entrada (que traz nome de paciente). O modelo não
//    precisa disso pra dizer que "AGAVE MOVEIS" é fornecedor, e mandar menos dado é a diferença
//    entre uma chamada de IA e um vazamento.
//
// E TRÊS QUE FAZEM ISTO RESPONDER (a v1 morria de 504):
//
// 4. SEM RACIOCÍNIO. O modelo da casa é o glm-4.7, que pensa antes de responder. Pensar sobre 30
//    pagadores de uma vez gasta mais tempo em raciocínio invisível do que na resposta, e era
//    isso que estourava o gateway. Raciocínio serve pra atender paciente; aqui é casar nome com
//    uma lista de 11 categorias, então mandamos `thinking: disabled`. O modelo continua sendo o
//    mesmo que o resto do CRM usa (trocar por um menor é só setar `CLASSIFICAR_MODEL`): apostar
//    num nome de modelo que ninguém testou nesta conta seria trocar um jeito de quebrar por
//    outro.
//
// 5. EM LOTES DE 6, NÃO 30 DE UMA VEZ. Chamada curta responde rápido e, quando uma falha, só
//    aquele lote se perde em vez da tela inteira. Três lotes por vez, não mais: o z.ai limita
//    requisições simultâneas por conta (429 code 1302) e é a mesma conta que responde paciente
//    no WhatsApp.
//
// 6. PRAZO E RELÓGIO EM TUDO. Cada chamada tem timeout, e a função inteira tem um prazo menor
//    que o do gateway do Supabase. Estourou o prazo, ela devolve o que já conseguiu e diz
//    quantos ficaram de fora. Meia sugestão com aviso é útil; 504 depois de dois minutos de
//    "Pensando…" não é.
//
// 7. UMA FATIA POR CHAMADA, `total` NA RESPOSTA. São 315 pagadores diferentes sem categoria:
//    isso não cabe em requisição nenhuma, então a tela varre chamando aqui com `offset` até
//    cobrir o `total`. Fatiar do lado do servidor é o que permite barra de progresso, botão de
//    parar, e retomar de onde parou quando um pedaço falha.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Números medidos contra o z.ai em 11/08, não chutados.
//
// Um lote de 10 pagadores COM raciocínio: 95s e 4.128 tokens de resposta, dos quais 3.489 são
// raciocínio que ninguém lê. O MESMO lote com `thinking: disabled`: 416 tokens. Esse é o número
// que importa, e é por isso que 30 pagadores numa chamada só davam 504.
//
// Já o tempo varia bastante com o dia do provedor: o mesmo lote de 10 saiu em 44s numa medição e
// em 10s em três outras, feitas em paralelo (as três passaram juntas, sem 429 de concorrência).
// Por isso o dimensionamento aqui assume o caso RUIM, não o bom: lote de 6 no pior caso ~26s,
// 30 pagadores = 5 lotes, 3 de cada vez = 2 rodadas ≈ 52s. No dia bom fica perto de 15s.

/** O gateway do Supabase corta em ~150s. Paramos antes pra devolver parcial em vez de 504. */
const PRAZO_MS = Number(Deno.env.get('CLASSIFICAR_PRAZO_MS') ?? '') || 110_000
/** Folga sobre os ~30s medidos: o modelo às vezes se alonga, e retentar custa outros 30s. */
const TIMEOUT_CHAMADA_MS = Number(Deno.env.get('CLASSIFICAR_TIMEOUT_MS') ?? '') || 60_000
const POR_LOTE = 6
/** O z.ai limita requisições SIMULTÂNEAS por conta (429 code 1302), e o atendimento ao paciente
 *  divide a mesma conta. Três é o teto que acelera isto sem competir com quem está no WhatsApp. */
const LOTES_EM_PARALELO = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function normalizeApiRoot(raw: string): string {
  const t = (raw ?? '').trim().replace(/\/$/, '')
  if (!t || t.includes('/coding/')) return 'https://api.z.ai/api/paas/v4'
  return t
}

type LlmCfg = { apiKey: string; url: string; model: string; zai: boolean }

function llmConfig(): LlmCfg | null {
  const zai = (Deno.env.get('ZAI_API_KEY') ?? '').trim()
  if (zai) {
    const root = normalizeApiRoot(Deno.env.get('ZAI_API_BASE') ?? '')
    // Mesmo modelo do resto do CRM (é o que se sabe ativo nesta conta), só que sem raciocínio.
    // `CLASSIFICAR_MODEL` troca por um menor sem mexer no atendimento ao paciente.
    const model =
      (Deno.env.get('CLASSIFICAR_MODEL') ?? '').trim() || (Deno.env.get('ZAI_MODEL') ?? '').trim() || 'glm-4.6'
    return { apiKey: zai, url: `${root}/chat/completions`, model, zai: true }
  }
  const oa = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (oa) {
    const model = (Deno.env.get('CLASSIFICAR_MODEL') ?? '').trim() || 'gpt-4o-mini'
    return { apiKey: oa, url: 'https://api.openai.com/v1/chat/completions', model, zai: false }
  }
  return null
}

/** Tira verbo do PIX, data e número colados — mesma regra do lib/extratoPadrao do front. */
function assinatura(desc: string): string {
  return (desc || '')
    .replace(/^\s*(pix|ted|doc)\s+(enviado|recebido|transf|qrs)\s*/i, '')
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\d[\d.\-/]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Pagador = { padrao: string; qtd: number; cents: number }
type Linha = { description: string | null; counterparty: string | null; amount_cents: number | null }

/**
 * Lê os lançamentos sem categoria PAGINANDO. O PostgREST corta em 1.000 linhas e ignora limite
 * maior calado, então o `.limit(4000)` da v1 era uma promessa que o banco não cumpria: passando
 * de mil pendências, o "top 30 por valor" seria calculado sobre um pedaço da conta. Hoje são 887
 * e cresce a cada extrato importado.
 */
async function lerLancamentos(
  db: SupabaseClient,
  de: string,
  ate: string,
): Promise<{ linhas: Linha[] } | { erro: string }> {
  const PAGINA = 1000
  const linhas: Linha[] = []
  for (let inicio = 0; inicio < 20_000; inicio += PAGINA) {
    const { data, error } = await db
      .from('fin_transactions')
      .select('description, counterparty, amount_cents')
      .eq('direction', 'out')
      .is('category_id', null)
      .gte('date', de)
      .lte('date', ate)
      // Ordem estável (`id` desempata a data) senão a paginação repete e pula linha.
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(inicio, inicio + PAGINA - 1)
    if (error) return { erro: error.message }
    const pagina = (data ?? []) as Linha[]
    linhas.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return { linhas }
}

function montarPrompt(lote: Pagador[], listaCats: string, listaCentros: string): string {
  return `Você classifica despesas de uma CLÍNICA DE TRANSPLANTE CAPILAR no Brasil.

Para cada pagador abaixo, escolha a categoria mais provável DENTRE ESTAS (use o id exato):
${listaCats}

Centros de custo disponíveis: ${listaCentros}

Pagadores (nome como aparece no extrato, quantas vezes pagou, total no período):
${lote.map((p, i) => `${i + 1}. "${p.padrao}" — ${p.qtd}x — R$ ${(p.cents / 100).toFixed(2)}`).join('\n')}

Responda APENAS um JSON array, um objeto por pagador, nesta forma:
[{"padrao":"...","category_id":"...","cost_center":"...","confianca":0.0,"motivo":"..."}]

Regras:
- Um objeto para CADA pagador da lista, com o "padrao" copiado exatamente como está acima.
- category_id TEM que ser um dos ids listados. Nunca invente.
- cost_center tem que ser um dos disponíveis, ou "" se não souber.
- confianca de 0 a 1. Use ABAIXO de 0.7 quando o nome não deixar claro o que é — nome de
  pessoa física sem contexto, sigla, ou empresa de ramo ambíguo.
- motivo: no máximo 8 palavras, em português.
- Na dúvida entre duas categorias, prefira a mais genérica e baixe a confiança.
- Não escreva nada fora do JSON.`
}

/** Aceita o array mesmo vindo em cerca de crase, com texto em volta, ou cortado no meio. */
function extrairArray(conteudo: string): Array<Record<string, unknown>> | null {
  const bruto = conteudo.replace(/```json\s*|```/g, '').trim()
  const inicio = bruto.indexOf('[')
  if (inicio < 0) return null
  const fim = bruto.lastIndexOf(']')
  const recorte = fim > inicio ? bruto.slice(inicio, fim + 1) : bruto.slice(inicio)
  try {
    const v = JSON.parse(recorte)
    return Array.isArray(v) ? v : null
  } catch {
    // Resposta truncada no meio de um objeto: salva os que fecharam. Perder 2 de 10 é melhor
    // que perder o lote por causa do último.
    const ultimo = recorte.lastIndexOf('}')
    if (ultimo < 0) return null
    try {
      const v = JSON.parse(`${recorte.slice(0, ultimo + 1)}]`)
      return Array.isArray(v) ? v : null
    } catch {
      return null
    }
  }
}

type Resultado = { ok: true; itens: Array<Record<string, unknown>> } | { ok: false; erro: string }

/** Uma chamada com timeout e retentativa em erro transitório, sempre dentro do prazo global. */
async function classificarLote(cfg: LlmCfg, prompt: string, prazo: number): Promise<Resultado> {
  const TENTATIVAS = 3
  let semThinking = false
  let ultimoErro = 'sem resposta'

  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    const restante = prazo - Date.now()
    if (restante < 5_000) return { ok: false, erro: 'prazo esgotado' }

    const corpo: Record<string, unknown> = {
      model: cfg.model,
      temperature: 0.1,
      // Um lote inteiro cabe em ~250 tokens. O teto folgado existe pra impedir que um modelo que
      // insista em raciocinar fique moendo token até o timeout.
      max_tokens: 1600,
      messages: [{ role: 'user', content: prompt }],
    }
    if (cfg.zai && !semThinking) corpo.thinking = { type: 'disabled' }

    let transitorio = false
    try {
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(Math.min(TIMEOUT_CHAMADA_MS, restante)),
      })
      const texto = await res.text()

      if (res.ok) {
        let conteudo = ''
        try {
          const parsed = JSON.parse(texto) as Record<string, unknown>
          const choices = parsed.choices as Array<Record<string, unknown>> | undefined
          conteudo = String(((choices?.[0]?.message as Record<string, unknown> | undefined)?.content as string) ?? '')
        } catch {
          ultimoErro = 'json do provedor inválido'
          transitorio = true
        }
        if (conteudo) {
          const itens = extrairArray(conteudo)
          if (itens) return { ok: true, itens }
          ultimoErro = 'resposta fora do formato'
          transitorio = true
        } else if (!transitorio) {
          ultimoErro = 'resposta vazia'
          transitorio = true
        }
      } else {
        // Modelo que não conhece `thinking` recusa com 400. Repete sem o campo na hora, sem
        // gastar tentativa. Vale para QUALQUER 400 e não só os que citam "thinking": errar pro
        // lado de uma chamada a mais é barato, e ficar preso num campo opcional que o provedor
        // não aceita mataria a tela inteira por causa de uma otimização.
        if (res.status === 400 && cfg.zai && !semThinking) {
          semThinking = true
          tentativa -= 1
          continue
        }
        ultimoErro = `provedor ${res.status}`
        // 429 (concorrência/rate-limit) e 5xx limpam sozinhos em segundos. 4xx não.
        transitorio = res.status === 429 || res.status >= 500
        if (/"?code"?\s*:\s*"?1113/.test(texto)) {
          // 1113 é saldo zerado no z.ai: retentar não recarrega a conta.
          return { ok: false, erro: 'z.ai sem saldo' }
        }
      }
    } catch (e) {
      // Timeout do AbortSignal ou queda de rede.
      ultimoErro = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'rede'
      transitorio = true
    }

    if (!transitorio || tentativa >= TENTATIVAS - 1) break
    await sleep(1_200 * Math.pow(2, tentativa) + Math.floor(Math.random() * 400))
  }

  return { ok: false, erro: ultimoErro }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const t0 = Date.now()
  const prazo = t0 + PRAZO_MS

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'sem sessão' }, 401)

  // Cliente COM o token do usuário: a RLS continua valendo e `current_tenant_id()` funciona.
  // Usar service_role aqui daria à IA acesso aos dois polos de uma vez.
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  })

  const body = (await req.json().catch(() => ({}))) as {
    de?: string
    ate?: string
    limite?: number
    offset?: number
  }
  const de = body.de ?? '1900-01-01'
  const ate = body.ate ?? '2999-12-31'
  const limite = Math.min(60, Math.max(5, body.limite ?? 30))
  // A tela varre TUDO chamando isto em sequência: 300 pagadores não cabem numa requisição só,
  // e fatiar aqui é o que deixa o front mostrar progresso e o usuário poder parar no meio.
  const offset = Math.max(0, Math.floor(body.offset ?? 0))

  const [lidos, { data: cats, error: e2 }, { data: centros }] = await Promise.all([
    lerLancamentos(db, de, ate),
    db.from('fin_categories').select('id, name, kind').eq('kind', 'despesa').eq('active', true),
    db.from('fin_cost_centers').select('name').eq('active', true),
  ])
  if ('erro' in lidos) return json({ error: 'leitura', message: lidos.erro }, 500)
  if (e2) return json({ error: 'categorias', message: e2.message }, 500)
  if (!cats?.length) return json({ error: 'sem_categorias' }, 400)

  // Agrega por pagador: o modelo decide sobre "AGAVE MOVEIS", não sobre 4 linhas dela.
  const mapa = new Map<string, Pagador>()
  for (const t of lidos.linhas) {
    const p = assinatura(String(t.description ?? t.counterparty ?? ''))
    if (p.length < 3) continue
    const a = mapa.get(p) ?? { padrao: p, qtd: 0, cents: 0 }
    a.qtd += 1
    a.cents += Math.abs(Number(t.amount_cents ?? 0))
    mapa.set(p, a)
  }
  // Os que mexem mais dinheiro primeiro: é onde errar dói e onde acertar rende. O desempate por
  // nome não é capricho: sem ele, dois pagadores de mesmo valor podem trocar de lugar entre uma
  // fatia e a seguinte, e a varredura pularia um enquanto repete o outro.
  const ordenados = [...mapa.values()].sort((a, b) => b.cents - a.cents || a.padrao.localeCompare(b.padrao))
  const total = ordenados.length
  const pagadores = ordenados.slice(offset, offset + limite)
  if (pagadores.length === 0) {
    return json({
      ok: true,
      sugestoes: [],
      total,
      offset,
      nota: total === 0 ? 'nada sem categoria no período' : 'fim da lista',
    })
  }

  const cfg = llmConfig()
  if (!cfg) return json({ error: 'llm_nao_configurado' }, 503)

  const listaCats = (cats as { id: string; name: string }[]).map((c) => `${c.id} = ${c.name}`).join('\n')
  const listaCentros = (centros as { name: string }[] | null)?.map((c) => c.name).join(', ') ?? ''

  const lotes: Pagador[][] = []
  for (let i = 0; i < pagadores.length; i += POR_LOTE) lotes.push(pagadores.slice(i, i + POR_LOTE))

  const itens: Array<Record<string, unknown>> = []
  const erros: string[] = []
  let proximo = 0
  let lotesOk = 0

  const worker = async () => {
    for (;;) {
      const i = proximo++
      if (i >= lotes.length) return
      // Sem tempo pra mais um lote: para aqui. O que já veio vale, e o front avisa quantos ficaram.
      if (prazo - Date.now() < 20_000) return
      const r = await classificarLote(cfg, montarPrompt(lotes[i], listaCats, listaCentros), prazo)
      if (r.ok) {
        itens.push(...r.itens)
        lotesOk++
      } else {
        erros.push(r.erro)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOTES_EM_PARALELO, lotes.length) }, worker))

  // Valida contra o que EXISTE. O modelo alucinar um id é esperado; deixar passar não é.
  const idsValidos = new Set((cats as { id: string }[]).map((c) => c.id))
  const nomeCat = new Map((cats as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const centrosValidos = new Set((centros as { name: string }[] | null)?.map((c) => c.name) ?? [])
  const porPadrao = new Map(pagadores.map((p) => [p.padrao, p]))
  const jaVisto = new Set<string>()

  const sugestoes = itens
    .map((i) => {
      const padrao = String(i.padrao ?? '')
      const p = porPadrao.get(padrao)
      const categoryId = String(i.category_id ?? '')
      if (!p || !idsValidos.has(categoryId)) return null
      // Lote repetido ou modelo que devolveu o mesmo pagador duas vezes: fica a primeira.
      if (jaVisto.has(padrao)) return null
      jaVisto.add(padrao)
      const cc = String(i.cost_center ?? '')
      return {
        padrao,
        qtd: p.qtd,
        amountCents: p.cents,
        categoryId,
        categoria: nomeCat.get(categoryId) ?? '',
        costCenter: centrosValidos.has(cc) ? cc : '',
        confianca: Math.max(0, Math.min(1, Number(i.confianca ?? 0))),
        motivo: String(i.motivo ?? '').slice(0, 80),
      }
    })
    .filter(Boolean)

  const faltaram = pagadores.length - jaVisto.size
  // A v1 não logava nada: quando deu 504 não havia uma linha sequer pra dizer onde travou.
  console.log('crm-classificar-gastos', {
    model: cfg.model,
    offset,
    pagadores: pagadores.length,
    total,
    lotes: lotes.length,
    lotesOk,
    sugestoes: sugestoes.length,
    faltaram,
    ms: Date.now() - t0,
    erros: [...new Set(erros)].slice(0, 4),
  })

  return json({
    ok: true,
    pagadores: pagadores.length,
    // Quantos pagadores existem no período inteiro, pra tela saber até onde varrer.
    total,
    offset,
    sugestoes,
    // Diz o que o modelo devolveu e a gente recusou: silêncio aqui esconde alucinação.
    descartadas: itens.length - sugestoes.length,
    // E quantos nem chegaram a ter resposta (lote falhou ou o prazo acabou): sem isso a tela
    // mostraria 20 sugestões de 30 pagadores como se fosse o trabalho inteiro.
    faltaram,
    erros: [...new Set(erros)].slice(0, 4),
  })
})
