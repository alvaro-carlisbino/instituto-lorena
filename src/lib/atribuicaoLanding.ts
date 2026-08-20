/**
 * De onde veio quem chegou na landing.
 *
 * O Google Ads devolve `gclid` e a Meta devolve `fbclid` na URL do clique, e os dois
 * somem no primeiro clique interno. Sem guardar na sessão, a pessoa que entra pelo
 * anúncio, navega e só depois preenche vira "lead orgânico" no CRM, e aí o relatório
 * jura que o Ads não vendeu nada (ver crm_meta_attribution).
 *
 * As funções puras recebem URL, referrer e um armazenamento: assim o teste roda em
 * Node, sem DOM, e a regra de first-touch fica visível em vez de escondida no efeito.
 */

export type AtribuicaoLanding = {
  gclid?: string
  fbclid?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  referrer?: string
  landing_path?: string
  landing_url?: string
}

export type ArmazenamentoSimples = {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
}

const CHAVE = 'lorena-landing-atribuicao'
const CHAVE_SESSAO = 'lorena-landing-sessao'
const CAMPOS = ['gclid', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

function hostSeguro(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ' '
  }
}

/** Lê os parâmetros de campanha da URL. Vazio quando a pessoa entrou digitando o endereço. */
export function atribuicaoDaUrl(url: string, referrer = ''): AtribuicaoLanding {
  let params: URLSearchParams
  let caminho = '/consulta'
  try {
    const u = new URL(url)
    params = u.searchParams
    caminho = u.pathname
  } catch {
    return {}
  }
  const saida: AtribuicaoLanding = {}
  for (const campo of CAMPOS) {
    const v = params.get(campo)
    if (v && v.trim()) saida[campo] = v.trim().slice(0, 200)
  }
  const ref = referrer.trim()
  // Referrer do próprio site não é origem: só polui o relatório.
  if (ref && !ref.includes(hostSeguro(url))) saida.referrer = ref.slice(0, 300)
  saida.landing_path = caminho
  saida.landing_url = url.slice(0, 300)
  return saida
}

/**
 * First-touch: o que já estava guardado na sessão vence o que chega depois. Quem
 * clicou no anúncio, saiu para o Instagram e voltou continua sendo lead do anúncio.
 */
export function resolverAtribuicao(
  atual: AtribuicaoLanding,
  armazenamento: ArmazenamentoSimples | null,
): AtribuicaoLanding {
  if (!armazenamento) return atual
  let guardada: AtribuicaoLanding = {}
  try {
    guardada = JSON.parse(armazenamento.getItem(CHAVE) ?? '{}') as AtribuicaoLanding
  } catch {
    guardada = {}
  }
  const temCampanhaGuardada = CAMPOS.some((c) => guardada[c])
  const temCampanhaAgora = CAMPOS.some((c) => atual[c])
  const final: AtribuicaoLanding =
    temCampanhaGuardada && !temCampanhaAgora
      ? {
          ...guardada,
          landing_path: atual.landing_path ?? guardada.landing_path,
          landing_url: atual.landing_url ?? guardada.landing_url,
        }
      : { ...guardada, ...atual }
  try {
    armazenamento.setItem(CHAVE, JSON.stringify(final))
  } catch {
    // navegador em modo privado: segue sem guardar
  }
  return final
}

/** Id de sessão para amarrar os passos do funil da mesma visita. */
export function resolverSessao(armazenamento: ArmazenamentoSimples | null, gerar: () => string): string {
  if (!armazenamento) return gerar()
  const atual = armazenamento.getItem(CHAVE_SESSAO)
  if (atual && atual.length >= 8) return atual
  const nova = gerar()
  try {
    armazenamento.setItem(CHAVE_SESSAO, nova)
  } catch {
    // sem armazenamento a sessão vira uma por carregamento; o evento ainda chega
  }
  return nova
}

/** Atalho para o navegador: URL atual + referrer + sessionStorage. */
export function capturarAtribuicaoDoNavegador(): { atribuicao: AtribuicaoLanding; sessao: string } {
  if (typeof window === 'undefined') return { atribuicao: {}, sessao: 'sem-sessao' }
  let store: ArmazenamentoSimples | null = null
  try {
    store = window.sessionStorage
  } catch {
    store = null
  }
  const atribuicao = resolverAtribuicao(atribuicaoDaUrl(window.location.href, document.referrer ?? ''), store)
  const sessao = resolverSessao(
    store,
    () => `s-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
  )
  return { atribuicao, sessao }
}
