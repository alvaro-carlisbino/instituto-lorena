// SUGESTÃO DE CATEGORIA POR IA — para os lançamentos que regex nenhum resolve.
//
// A classificação automática que já existe é casamento de texto: pega "TRIBUTOS", "APLIC AUT",
// "TARIFA". Isso cobriu R$ 1,05 milhão e parou. O que sobra — R$ 2,19 milhões em fornecedor,
// médico, folha, aluguel — não tem palavra-chave: são nomes de empresa e de pessoa, e só quem
// conhece a operação sabe o que cada um é. É exatamente o tipo de tarefa que um LLM acerta bem
// e que regra fixa não alcança.
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function normalizeApiRoot(raw: string): string {
  const t = (raw ?? '').trim().replace(/\/$/, '')
  if (!t || t.includes('/coding/')) return 'https://api.z.ai/api/paas/v4'
  return t
}

function llmConfig(): { apiKey: string; url: string; model: string } | null {
  const zai = (Deno.env.get('ZAI_API_KEY') ?? '').trim()
  if (zai) {
    const root = normalizeApiRoot(Deno.env.get('ZAI_API_BASE') ?? '')
    return { apiKey: zai, url: `${root}/chat/completions`, model: (Deno.env.get('ZAI_MODEL') ?? '').trim() || 'glm-4.5-air' }
  }
  const oa = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (oa) return { apiKey: oa, url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth) return json({ error: 'sem sessão' }, 401)

  // Cliente COM o token do usuário: a RLS continua valendo e `current_tenant_id()` funciona.
  // Usar service_role aqui daria à IA acesso aos dois polos de uma vez.
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: auth } },
  })

  const body = (await req.json().catch(() => ({}))) as { de?: string; ate?: string; limite?: number }
  const de = body.de ?? '1900-01-01'
  const ate = body.ate ?? '2999-12-31'
  const limite = Math.min(60, Math.max(5, body.limite ?? 30))

  const [{ data: txns, error: e1 }, { data: cats, error: e2 }, { data: centros }] = await Promise.all([
    db
      .from('fin_transactions')
      .select('description, counterparty, amount_cents, direction, category_id, date')
      .eq('direction', 'out')
      .is('category_id', null)
      .gte('date', de)
      .lte('date', ate)
      .limit(4000),
    db.from('fin_categories').select('id, name, kind').eq('kind', 'despesa').eq('active', true),
    db.from('fin_cost_centers').select('name').eq('active', true),
  ])
  if (e1) return json({ error: 'leitura', message: e1.message }, 500)
  if (e2) return json({ error: 'categorias', message: e2.message }, 500)
  if (!cats?.length) return json({ error: 'sem_categorias' }, 400)

  // Agrega por pagador: o modelo decide sobre "AGAVE MOVEIS", não sobre 4 linhas dela.
  const mapa = new Map<string, Pagador>()
  for (const t of txns ?? []) {
    const p = assinatura(String(t.description ?? t.counterparty ?? ''))
    if (p.length < 3) continue
    const a = mapa.get(p) ?? { padrao: p, qtd: 0, cents: 0 }
    a.qtd += 1
    a.cents += Math.abs(Number(t.amount_cents ?? 0))
    mapa.set(p, a)
  }
  // Os que mexem mais dinheiro primeiro: é onde errar dói e onde acertar rende.
  const pagadores = [...mapa.values()].sort((a, b) => b.cents - a.cents).slice(0, limite)
  if (pagadores.length === 0) return json({ ok: true, sugestoes: [], nota: 'nada sem categoria no período' })

  const cfg = llmConfig()
  if (!cfg) return json({ error: 'llm_nao_configurado' }, 503)

  const listaCats = (cats as { id: string; name: string }[]).map((c) => `${c.id} = ${c.name}`).join('\n')
  const listaCentros = (centros as { name: string }[] | null)?.map((c) => c.name).join(', ') ?? ''

  const prompt = `Você classifica despesas de uma CLÍNICA DE TRANSPLANTE CAPILAR no Brasil.

Para cada pagador abaixo, escolha a categoria mais provável DENTRE ESTAS (use o id exato):
${listaCats}

Centros de custo disponíveis: ${listaCentros}

Pagadores (nome como aparece no extrato, quantas vezes pagou, total no período):
${pagadores.map((p, i) => `${i + 1}. "${p.padrao}" — ${p.qtd}x — R$ ${(p.cents / 100).toFixed(2)}`).join('\n')}

Responda APENAS um JSON array, um objeto por pagador, nesta forma:
[{"padrao":"...","category_id":"...","cost_center":"...","confianca":0.0,"motivo":"..."}]

Regras:
- category_id TEM que ser um dos ids listados. Nunca invente.
- cost_center tem que ser um dos disponíveis, ou "" se não souber.
- confianca de 0 a 1. Use ABAIXO de 0.7 quando o nome não deixar claro o que é — nome de
  pessoa física sem contexto, sigla, ou empresa de ramo ambíguo.
- motivo: no máximo 8 palavras, em português.
- Na dúvida entre duas categorias, prefira a mais genérica e baixe a confiança.`

  let res: Response
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (e) {
    return json({ error: 'llm_indisponivel', message: e instanceof Error ? e.message : String(e) }, 502)
  }
  if (!res.ok) return json({ error: 'llm_erro', status: res.status, message: await res.text() }, 502)

  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const choices = parsed.choices as Array<Record<string, unknown>> | undefined
  const conteudo = String(
    ((choices?.[0]?.message as Record<string, unknown> | undefined)?.content as string) ?? '',
  )
  const bruto = conteudo.replace(/```json\s*|```/g, '').trim()
  let itens: Array<Record<string, unknown>> = []
  try {
    const inicio = bruto.indexOf('[')
    itens = JSON.parse(inicio >= 0 ? bruto.slice(inicio, bruto.lastIndexOf(']') + 1) : bruto)
  } catch {
    return json({ error: 'resposta_invalida', amostra: bruto.slice(0, 400) }, 502)
  }

  // Valida contra o que EXISTE. O modelo alucinar um id é esperado; deixar passar não é.
  const idsValidos = new Set((cats as { id: string }[]).map((c) => c.id))
  const nomeCat = new Map((cats as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const centrosValidos = new Set((centros as { name: string }[] | null)?.map((c) => c.name) ?? [])
  const porPadrao = new Map(pagadores.map((p) => [p.padrao, p]))

  const sugestoes = itens
    .map((i) => {
      const padrao = String(i.padrao ?? '')
      const p = porPadrao.get(padrao)
      const categoryId = String(i.category_id ?? '')
      if (!p || !idsValidos.has(categoryId)) return null
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

  return json({
    ok: true,
    pagadores: pagadores.length,
    sugestoes,
    // Diz o que o modelo devolveu e a gente recusou: silêncio aqui esconde alucinação.
    descartadas: itens.length - sugestoes.length,
  })
})
