import { ehPagamentoDeFatura } from '@/lib/faturaCartao'

/**
 * Assinatura do pagador dentro da descrição do extrato — é o padrão que vira REGRA.
 *
 * O Itaú escreve "PIX ENVIADO LAVANDERIA B" hoje e "PIX ENVIADO LAVANDERIA B 12/09" no mês que
 * vem. Se a regra guardar a frase inteira, ela casa só com o lançamento daquele dia e não serve
 * pra nada — o usuário classifica de novo todo mês e desiste. Tirar o verbo ("PIX ENVIADO") e os
 * números colados é o que faz uma classificação valer para o histórico inteiro e para o futuro.
 */
export function sugerirPadrao(descricao: string): string {
  return (descricao || '')
    .replace(/^\s*(pix|ted|doc)\s+(enviado|recebido|transf|qrs)\s*/i, '')
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    // Sem `\b` na frente de propósito: o número costuma vir COLADO na letra
    // ("REDE VISA DB0085868531"), e com a borda de palavra o filtro não pegava nada.
    // Exige 4+ dígitos para não comer nome legítimo tipo "LOJA 24H".
    .replace(/\d[\d.\-/]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// O "trilho" do pagamento: diz COMO o dinheiro saiu, nunca PARA QUEM. A ordem importa, o
// mais comprido primeiro, senão "SISPAG" come o começo de "SISPAG PIX QR-CODE" e sobra
// "PIX QR-CODE" com cara de nome.
const TRILHOS: RegExp[] = [
  /^sispag\s+pix\s+qr-?code\b/i,
  /^sispag\s+fornecedores\b/i,
  /^sispag\s+transf\s+cc\s+itau\b/i,
  /^sispag\b/i,
  /^pix\s+qr-?code\b/i,
  /^pix\s+(enviado|recebido|agendado|transf|qrs)\b/i,
  /^boleto\s+pago\b/i,
  /^ted\s+(enviada|enviado|recebida|recebido)\b/i,
  // Débito automático: o Itaú escreve "DA  " seguido do nome, com dois espaços. Exigir os dois é o que
  // impede de comer o "DA" de "DA SILVA".
  /^da\s{2,}/i,
]

function semTrilho(descricao: string): string {
  let s = (descricao || '').trim()
  for (let mudou = true; mudou; ) {
    mudou = false
    for (const re of TRILHOS) {
      if (re.test(s)) {
        s = s.replace(re, '').trim()
        mudou = true
        break
      }
    }
  }
  return s
    .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
    .replace(/\d[\d.\-/]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Nome de quem recebeu, para SOMAR pagamentos iguais no relatório.
 *
 * "PIX ENVIADO LAVANDERIA BRILHO" e "PIX AGENDADO LAVANDERIA BRIL" são o mesmo fornecedor: o que muda é
 * o trilho e onde o banco cortou o nome. Quando a descrição é só trilho ("SISPAG PIX QR-CODE"),
 * não há nome nenhum e o próprio trilho vira o rótulo, para ao menos ficarem juntos.
 */
export function assinaturaPagador(descricao: string): string {
  const nome = semTrilho(descricao)
  if (nome.replace(/[^a-zà-ú]/gi, '').length >= 3) return nome.toUpperCase()
  return (descricao || '')
    .replace(/\d[\d.\-/]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

/**
 * Padrão para "aplicar aos iguais", ou `null` quando o lançamento não diz quem recebeu.
 *
 * "SISPAG PIX QR-CODE" são dezenas de pagamentos por mês para gente diferente. Virar regra com isso
 * carimbaria todos no mesmo centro, então aqui não sai padrão e a tela classifica só o lançamento.
 *
 * Mercado Livre é o mesmo caso por outro motivo: "MERCADOLIVRE*MERCADOL" é o nome em toda compra, e
 * só o pedido diz se foi material da clínica, marketing ou compra pessoal. Classifica compra a compra.
 */
export function padraoDaRegra(descricao: string): string | null {
  if (/mercado\s*livre/i.test(descricao)) return null
  // Boleto de fatura tem a mesma cara para todo cartão ("BOLETO PAGO Fatura Carta"): uma regra
  // com ele classificaria o boleto do cartão da clínica junto com o de outro cartão.
  if (ehPagamentoDeFatura(descricao)) return null
  const nome = semTrilho(descricao)
  return nome.replace(/[^a-zà-ú]/gi, '').length >= 4 ? nome : null
}

const semAcento = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/**
 * Agrupa linhas pelo pagador, juntando nomes que o banco cortou em tamanhos diferentes
 * ("LAVANDERIA BRIL" dentro de "LAVANDERIA BRILHO"). Devolve do maior total para o menor.
 */
export function agruparPorPagador<T extends { chave: string; amountCents: number }>(
  linhas: T[],
): Array<{ rotulo: string; totalCents: number; itens: T[] }> {
  const grupos: Array<{ chave: string; rotulos: Map<string, number>; totalCents: number; itens: T[] }> = []
  // Chave mais comprida primeiro: é ela que absorve as versões cortadas.
  const ordenadas = [...linhas].sort((a, b) => b.chave.length - a.chave.length)
  for (const l of ordenadas) {
    const k = semAcento(l.chave.toUpperCase())
    const alvo = grupos.find(
      (g) => g.chave === k || (k.length >= 6 && g.chave.startsWith(k)) || (g.chave.length >= 6 && k.startsWith(g.chave)),
    )
    const g = alvo ?? { chave: k, rotulos: new Map<string, number>(), totalCents: 0, itens: [] as T[] }
    if (!alvo) grupos.push(g)
    g.rotulos.set(l.chave, (g.rotulos.get(l.chave) ?? 0) + 1)
    g.totalCents += l.amountCents
    g.itens.push(l)
  }
  return grupos
    .map((g) => ({
      // O rótulo mais comprido é o menos cortado.
      rotulo: [...g.rotulos.keys()].sort((a, b) => b.length - a.length)[0] ?? g.chave,
      totalCents: g.totalCents,
      itens: g.itens.sort((a, b) => b.amountCents - a.amountCents),
    }))
    .sort((a, b) => b.totalCents - a.totalCents)
}
