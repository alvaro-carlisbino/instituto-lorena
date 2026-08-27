/**
 * Pixel da Meta, SÓ na landing pública.
 *
 * Ele não mora no `index.html` de propósito: aquele HTML é o do CRM interno, e
 * carregá-lo lá mandaria para a Meta o passeio da equipe pelo painel, incluindo
 * telas de paciente. Quem chama isto é a `ConsultaLandingPage`, e mais ninguém.
 *
 * Por que existe: sem evento de conversão, um anúncio para o site só sabe comprar
 * CLIQUE. É assim que a conta enche de lead de fora da praça, que foi o diagnóstico
 * de [[crm_trafego_nacional_venda_local]]. Com o `Lead` disparando aqui, a Meta
 * aprende quem preenche a triagem inteira, não quem toca no anúncio.
 *
 * O que NÃO vai: nome, telefone, e-mail. A correspondência avançada mandaria dado
 * de saúde para a Meta e isso é decisão do dono, não default de código. O `eventID`
 * é o protocolo da triagem, para o dia em que o CAPI mandar o mesmo evento pelo
 * servidor e os dois precisarem se reconhecer como um só.
 */

const PIXEL_ID = '1191608098555930' // PIXEL - Lorena Visentainer

type Fbq = ((...args: unknown[]) => void) & {
  /** A fbevents.js instala ISTO ao carregar. Enquanto não existe, tudo vai para a fila. */
  callMethod?: (...args: unknown[]) => void
  push?: unknown
  queue?: unknown[]
  loaded?: boolean
  version?: string
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

/** Injeta o script uma vez e dispara o PageView. Devolve uma função de limpeza. */
export function iniciarPixelMeta(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (!window.fbq) {
    // Este stub tem de ser o do snippet oficial, letra por letra na parte que
    // importa: a fbevents.js NÃO substitui `window.fbq`, ela pendura um
    // `callMethod` nele e reatribui `push`. Uma versão que só empilha em `queue`
    // entrega o PageView (drenado no load) e engole TODOS os eventos seguintes em
    // silêncio — o pixel aparece verde no Gerenciador e o anúncio otimiza para
    // nada. Foi exatamente o que aconteceu aqui antes desta correção.
    const fbq: Fbq = function (...args: unknown[]) {
      const f = window.fbq as Fbq
      // `f.callMethod(...)` já entra com `this === f`, que é o que o
      // `callMethod.apply(n, arguments)` do snippet original garante.
      if (f.callMethod) f.callMethod(...args)
      else f.queue?.push(args)
    }
    fbq.push = fbq
    fbq.queue = []
    fbq.loaded = true
    fbq.version = '2.0'
    window.fbq = fbq
    window._fbq = fbq

    const s = document.createElement('script')
    s.async = true
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(s)
  }

  window.fbq?.('init', PIXEL_ID)
  window.fbq?.('track', 'PageView')

  return () => {
    // Sem `fbq('consent','revoke')` aqui: a landing é a única tela que carrega o
    // pixel e ela não desmonta em uso normal. Deixar a função existir mantém o
    // contrato do useEffect honesto.
  }
}

/** A pessoa terminou as perguntas e viu a estimativa. É o meio do funil. */
export function pixelTriagemCompleta(objetivo?: string): void {
  window.fbq?.('track', 'ViewContent', {
    content_name: 'triagem_consulta',
    content_category: objetivo || 'nao_informado',
  })
}

/** Deixou nome e WhatsApp. É ISTO que o anúncio compra. */
export function pixelLead(protocolo: string): void {
  window.fbq?.('track', 'Lead', { content_name: 'landing_consulta' }, { eventID: protocolo })
}
