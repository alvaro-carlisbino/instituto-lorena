/**
 * Notas da versão: o que mudou no CRM, escrito para a equipe.
 *
 * O aviso de versão nova (ver novaVersao.ts) dizia só "saiu uma versão nova". Enfermagem,
 * financeiro e recepção ficam com a aba aberta o dia todo; atualizavam sem saber o que tinha
 * mudado nem onde clicar, e a tela nova passava batida. Agora o aviso conta a novidade.
 *
 * Fonte única: src/config/notasDaVersao.json, do MAIS NOVO para o mais antigo. O mesmo arquivo
 * entra no bundle (o que ESTA aba conhece) e sai como `notas-da-versao.json` na raiz do app (o
 * que o SERVIDOR já tem), pelo plugin do vite.config.ts. A diferença entre as duas listas é o
 * que a pessoa ainda não viu. Comparar por id, e não por data, porque podem sair duas notas no
 * mesmo dia.
 */

import notasJson from '@/config/notasDaVersao.json'

export type NotaDaVersao = {
  id: string
  /** AAAA-MM-DD */
  data: string
  titulo: string
  itens: string[]
}

export const CHAVE_NOTA_VISTA = 'crm-nota-versao-vista'
export const MAX_NOTAS_NO_AVISO = 2
export const MAX_ITENS_POR_NOTA = 3

const texto = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/**
 * Aceita só notas bem formadas. O JSON do servidor chega de fora do bundle: se o arquivo não
 * existir, o rewrite do Vercel devolve a página (HTML) e o parse já falha antes; se vier algo
 * torto, melhor mostrar menos do que quebrar o aviso.
 */
export function lerNotas(bruto: unknown): NotaDaVersao[] {
  if (!Array.isArray(bruto)) return []
  return bruto.flatMap((n): NotaDaVersao[] => {
    if (!n || typeof n !== 'object') return []
    const { id, data, titulo, itens } = n as Record<string, unknown>
    if (!texto(id) || !texto(data) || !texto(titulo) || !Array.isArray(itens)) return []
    return [{ id, data, titulo, itens: itens.filter(texto) }]
  })
}

/** O que este build conhece. Usado para saber o que o servidor tem de novo. */
export const NOTAS_DESTE_BUILD: NotaDaVersao[] = lerNotas(notasJson)

/**
 * Notas do servidor mais novas que a mais nova que este build conhece: tudo antes do primeiro
 * id conhecido. Se nenhum id bate (build muito antigo, ou id renomeado), devolve só a primeira,
 * para não despejar o histórico inteiro num aviso.
 */
export function notasNovas(doServidor: NotaDaVersao[], conhecidas: NotaDaVersao[]): NotaDaVersao[] {
  const ids = new Set(conhecidas.map((n) => n.id))
  const i = doServidor.findIndex((n) => ids.has(n.id))
  return i === -1 ? doServidor.slice(0, 1) : doServidor.slice(0, i)
}

/**
 * Notas publicadas depois da última que a pessoa viu. Sem id visto, ou com id que esta lista
 * não tem, devolve vazio: não dá para saber o que ela já leu, e repetir novidade velha ensina
 * a fechar o aviso sem ler.
 */
export function notasDesde(lista: NotaDaVersao[], ultimaVistaId: string | null | undefined): NotaDaVersao[] {
  if (!ultimaVistaId) return []
  const i = lista.findIndex((n) => n.id === ultimaVistaId)
  return i === -1 ? [] : lista.slice(0, i)
}

export type ResumoDoAviso = {
  notas: NotaDaVersao[]
  /** "e mais N novidades" quando passou do limite; null quando cabe tudo. */
  resto: string | null
}

/** Corta para caber num aviso lido no celular: até 2 notas e 3 itens de cada. */
export function resumoDoAviso(notas: NotaDaVersao[]): ResumoDoAviso {
  const visiveis = notas.slice(0, MAX_NOTAS_NO_AVISO).map((n) => ({ ...n, itens: n.itens.slice(0, MAX_ITENS_POR_NOTA) }))
  const sobra = notas.length - visiveis.length
  return {
    notas: visiveis,
    resto: sobra > 0 ? `e mais ${sobra} ${sobra === 1 ? 'novidade' : 'novidades'}` : null,
  }
}

// ── Efeitos (rede e navegador) ─────────────────────────────────────────────────────────────

/** Notas que o servidor já publicou. Qualquer falha vira lista vazia e o aviso sai sem notas. */
export async function buscarNotasDoServidor(): Promise<NotaDaVersao[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}notas-da-versao.json`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return []
    return lerNotas(await res.json())
  } catch {
    return []
  }
}

/** Id da última nota que este navegador mostrou. null também quando o storage está bloqueado. */
export function lerNotaVista(): string | null {
  try {
    return localStorage.getItem(CHAVE_NOTA_VISTA)
  } catch {
    return null
  }
}

export function gravarNotaVista(id: string): void {
  try {
    localStorage.setItem(CHAVE_NOTA_VISTA, id)
  } catch {
    // Navegação privada sem storage: o aviso só não lembra o que já mostrou.
  }
}
