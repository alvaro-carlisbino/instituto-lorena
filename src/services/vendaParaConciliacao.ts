// Ponte entre a venda GRAVADA e o motor de conciliação.
//
// O motor nasceu lendo a planilha do Shosp direto (`ShospSale`). Depois que o ano de vendas foi
// importado, insistir na planilha virou trabalho dobrado: a mesma pessoa subia o mesmo arquivo
// em duas telas, e a conciliação só existia no dia em que alguém tivesse o arquivo em mãos.
//
// A forma CRUA ("CC 6x/PX") é o que faz esta ponte funcionar: `method` normalizado perde o
// pagamento dividido, e pagamento dividido não dá pra conciliar — o Shosp registra as formas mas
// não quanto foi em cada uma. Sem `method_raw`, essas vendas entrariam no casamento 1 pra 1 e
// virariam divergência falsa.

import { parseFormaPagamento, type PaymentMethod, type ShospSale } from '@/services/shospVendas'
import type { VendaShosp } from '@/services/financeiro'

/** `method` do banco → forma do motor. Só serve de rede quando não há forma crua. */
const DO_BANCO: Record<string, PaymentMethod> = {
  pix: 'pix',
  dinheiro: 'dinheiro',
  cartao: 'cartao_credito',
  boleto: 'boleto',
  transferencia: 'transferencia',
  convenio: 'convenio',
  cheque: 'cheque',
  outro: 'outro',
}

export function vendaParaShospSale(v: VendaShosp, indice: number): ShospSale {
  const forma = v.methodRaw
    ? parseFormaPagamento(v.methodRaw)
    : {
        method: DO_BANCO[v.method] ?? 'outro',
        methods: [DO_BANCO[v.method] ?? 'outro'] as PaymentMethod[],
        mixed: false,
        installments: v.installments,
      }
  return {
    saleId: v.externalId.replace(/^shosp:/, ''),
    date: v.date,
    patient: v.patient,
    cpf: '',
    amountCents: v.amountCents,
    method: forma.method,
    methods: forma.methods,
    mixed: forma.mixed,
    methodRaw: v.methodRaw || v.method,
    // A coluna do banco manda: ela veio da coluna própria de parcelas do Shosp, que ganha
    // da parcela colada na forma ("CC 10x") quando as duas existem.
    installments: Math.max(1, v.installments),
    caixa: v.caixa,
    services: [],
    provider: '',
    doc: v.externalId.replace(/^shosp:/, ''),
    status: 'A',
    // Não existe "linha da planilha" quando o dado veio do banco. O índice mantém a mensagem
    // de divergência utilizável sem fingir uma referência de arquivo que ninguém tem.
    rowNumber: indice + 1,
    rowNumbers: [indice + 1],
    key: v.externalId,
  }
}
