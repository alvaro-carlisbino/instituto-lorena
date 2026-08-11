import { useEffect, useState, type RefObject } from 'react'

/**
 * Renderiza só as linhas que cabem na tela, mais uma folga acima e abaixo.
 *
 * A lista de leads passou de 2.680 registros. Montar isso de uma vez custa dezenas de
 * milhares de nós no DOM — cada linha tem checkbox, etiquetas e um link do router — e
 * o navegador refaz o layout de todos eles a cada re-render. Com a janela, o DOM fica
 * do tamanho da tela (~30 linhas) e para de crescer com a base.
 *
 * O espaço das linhas que não foram montadas vira preenchimento (`padTop`/`padBottom`),
 * então a barra de rolagem continua do tamanho certo e o scroll não "pula".
 *
 * Exige ALTURA FIXA de linha — o que é verdade nesta tela porque toda célula corta em
 * uma linha (truncate/line-clamp). Se algum dia uma linha puder crescer, o cálculo
 * abaixo deixa de valer e a rolagem fica torta.
 */
type Options = {
  /** Quantos itens a lista tem no total. */
  count: number
  /** Altura de cada linha em px. Precisa bater com o CSS, senão o scroll desalinha. */
  rowHeight: number
  /** Elemento que embrulha as linhas — usado para achar o container que rola. */
  containerRef: RefObject<HTMLElement | null>
  /** Linhas extras fora da tela, para a rolagem não mostrar buraco branco. */
  overscan?: number
  /** Desliga a janela (ex.: layout que não está visível). */
  enabled?: boolean
}

type VirtualWindow = {
  start: number
  end: number
  padTop: number
  padBottom: number
}

/**
 * O `<main>` do AppLayout é quem rola (`overflow-y-auto`), não a janela. Como a lista
 * não tem referência a ele, subimos na árvore até achar quem rola de verdade. Se
 * ninguém rolar, o container é a própria janela.
 */
const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
  let node = el?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

export function useVirtualRows({
  count,
  rowHeight,
  containerRef,
  overscan = 8,
  enabled = true,
}: Options): VirtualWindow {
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 })

  useEffect(() => {
    if (!enabled) return
    const el = containerRef.current
    if (!el) return

    const scroller = findScrollParent(el)

    const measure = () => {
      const node = containerRef.current
      if (!node) return
      // Quanto da lista já passou por cima da borda de cima da área visível.
      const listTop = node.getBoundingClientRect().top
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0
      const viewHeight = scroller ? scroller.clientHeight : window.innerHeight
      const scrolledPast = viewTop - listTop

      const first = Math.max(0, Math.floor(scrolledPast / rowHeight) - overscan)
      const visible = Math.ceil(viewHeight / rowHeight) + overscan * 2
      const last = Math.min(count, first + visible)

      setRange((prev) => (prev.start === first && prev.end === last ? prev : { start: first, end: last }))
    }

    // rAF: a rolagem dispara dezenas de eventos por segundo e só um por quadro importa.
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    measure()
    const target: HTMLElement | Window = scroller ?? window
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [count, rowHeight, overscan, enabled, containerRef])

  if (!enabled) return { start: 0, end: count, padTop: 0, padBottom: 0 }

  const start = Math.min(range.start, Math.max(0, count - 1))
  const end = Math.min(count, Math.max(range.end, start))
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  }
}
