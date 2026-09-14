/**
 * Avisa quando saiu versão nova do CRM enquanto a aba estava aberta.
 *
 * O `index.html` aberto continua apontando para o bundle antigo até alguém recarregar. Em
 * 14/set/2026 o financeiro passou a tarde trabalhando na tela velha de Gastos (a que voltava
 * para o topo a cada salvar), horas depois do redesenho estar no ar, sem nada dizer que existia
 * outra. Recarregar sozinho não serve: levaria junto formulário e filtro pela metade. Então
 * avisa, e a pessoa escolhe a hora.
 *
 * Como sabe: busca o `index.html` do servidor e compara o script de entrada com o desta página.
 * O hash muda a cada build, então diferente quer dizer versão nova.
 */

const ENTRADA = /src="([^"]*\/assets\/index-[^"]+\.js)"/

function entradaDestaPagina(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  return s ? new URL(s.src, window.location.href).pathname : null
}

export async function temVersaoNova(): Promise<boolean> {
  const atual = entradaDestaPagina()
  if (!atual) return false
  const res = await fetch(import.meta.env.BASE_URL, { cache: 'no-store', headers: { accept: 'text/html' } })
  if (!res.ok) return false
  const m = ENTRADA.exec(await res.text())
  if (!m) return false
  return new URL(m[1], window.location.href).pathname !== atual
}
