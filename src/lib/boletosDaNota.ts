// Boletos de uma nota que não traz duplicata no XML (NFS-e, NF-e de balcão).
//
// A conta a pagar nascia com UMA parcela vencendo na emissão, mas o fornecedor quase sempre
// cobra em boleto, e muitas vezes parcelado: a Health Tech manda 3 ou 4 boletos por mês que se
// repetem mês a mês no extrato. Parcela vencendo na emissão aparece vencida no dia seguinte e
// nunca casa com o boleto pago. Quem importa digita o que está no boleto; isto só pré-preenche.

export type BoletoDaNota = { dueDate: string; amountCents: number }

/** Mesmo dia N meses depois; 31/01 + 1 mês vira 28/02, não 03/03 como o Date faria sozinho. */
export function somarMeses(dia: string, meses: number): string {
  const [ano, mes, d] = dia.split('-').map(Number) as [number, number, number]
  const alvo = new Date(Date.UTC(ano, mes - 1 + meses, 1))
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  alvo.setUTCDate(Math.min(d, ultimoDia))
  return alvo.toISOString().slice(0, 10)
}

/** Divide o total em N boletos mensais iguais; o centavo que sobra vai no primeiro. */
export function gerarBoletos(totalCents: number, parcelas: number, primeiroVencimento: string): BoletoDaNota[] {
  const n = Math.max(1, Math.min(60, Math.round(parcelas) || 1))
  const base = Math.floor(totalCents / n)
  const sobra = totalCents - base * n
  return Array.from({ length: n }, (_, i) => ({
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(primeiroVencimento) ? somarMeses(primeiroVencimento, i) : '',
    amountCents: base + (i === 0 ? sobra : 0),
  }))
}
