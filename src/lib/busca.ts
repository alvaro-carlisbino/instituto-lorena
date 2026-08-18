/**
 * Busca de tela: acha o paciente do jeito que a Aline digita.
 *
 * Ela digita "jose" e o cadastro tem "José"; digita "sobrancelha" e o rótulo é
 * "Sobrancelha + nanofat"; digita "44 99" e o telefone está gravado como
 * "5544999...". Comparar string crua contra string crua faz a busca não achar
 * ninguém e a tela parecer vazia — e tela vazia em clínica vira "o sistema
 * perdeu o paciente", não "eu digitei com acento diferente".
 *
 * Então tudo passa por aqui: minúscula, sem acento, sem pontuação de telefone.
 */

/** Minúscula e sem acento. É o que compara nome contra nome. */
export function normalizarBusca(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Só os dígitos. Telefone que a pessoa digita nunca tem a mesma pontuação do banco. */
const soDigitos = (valor: string) => valor.replace(/\D/g, '')

/**
 * O termo aparece em algum dos campos?
 *
 * Cada palavra do termo precisa aparecer em ALGUM campo — não no mesmo. É o que
 * faz "aline sobrancelha" achar a venda de sobrancelha que a Aline fechou, sem
 * exigir que ela lembre a ordem em que a tela mostra as colunas.
 *
 * Campo nulo é ignorado, não vira "null" pesquisável.
 */
export function combinaBusca(termo: string, ...campos: (string | null | undefined)[]): boolean {
  const alvo = normalizarBusca(termo)
  if (alvo.length === 0) return true

  const texto = campos
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .map((c) => normalizarBusca(c))
    .join(' ')

  // Telefone digitado com espaço/parêntese ("44 9 9999") tem que achar "5544999...".
  const digitosDoAlvo = soDigitos(alvo)
  if (digitosDoAlvo.length >= 3) {
    const digitosDoTexto = soDigitos(texto)
    if (digitosDoTexto.includes(digitosDoAlvo)) return true
  }

  return alvo
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .every((palavra) => texto.includes(palavra))
}
