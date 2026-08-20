/**
 * Normalização de telefone brasileiro para os canais de ENTRADA (formulário, site, planilha),
 * onde o número é DIGITADO por gente e chega torto.
 *
 * O buraco que isto fecha (auditoria 20/ago/2026, Meta Lead Ads): a versão anterior só sabia
 * tirar zero à esquerda e pôr o `55` quando faltava. Tudo o mais passava direto e ia parar em
 * `leads.phone` como número impossível — 88 leads pagos (11% de 807 em 45 dias) com telefone
 * que não pode existir no WhatsApp, e a equipe ligando para o vazio:
 *
 *   `+554390000000`     12 dígitos, celular escrito sem o 9º  → gravava `554390000000`
 *   `+55041900000000`   zero do DDD depois do DDI             → gravava 14 dígitos
 *   `+5553900000000000` dedo pesado, 16 dígitos               → gravava os 16
 *   `+15550000000`      número dos EUA                        → virava `5515550000000`, um BR que não existe
 *
 * Duas regras que parecem detalhe e não são:
 *  - o `55` só sai quando o que sobra ainda tem cara de DDD+número (12 a 15 dígitos). Com 11,
 *    `55900000000` é DDD 55 (Santa Maria/RS), não DDI sem DDD;
 *  - o 9º dígito só entra em CELULAR (primeira casa 6-9). Fixo começa em 2-5 e continua com 8.
 *
 * Estrangeiro NÃO é inválido. Paciente em Portugal, na França ou nos EUA preenche o mesmo
 * anúncio, e o WhatsApp dele funciona igual. A leitura brasileira é tentada PRIMEIRO (senão
 * `+062900000000`, que é Goiânia com zero sobrando, viraria "Indonésia"); só quando ela falha
 * e o número veio com `+` e um DDI reconhecido é que sai como estrangeiro, intacto.
 *
 * O que não dá para salvar volta `ok:false` COM os dígitos crus: o lead ainda nasce (nome e
 * e-mail de lead pago valem dinheiro), mas fica carimbado e nenhuma automação fala com ele.
 * Inventar dígito para "consertar" é pior do que admitir que está torto — manda estranho.
 */

/** DDDs que existem no Brasil. Fora desta lista o número não é discável. */
const DDDS_VALIDOS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
])

/**
 * DDIs que aparecem de verdade nestes formulários. Só são consultados DEPOIS de a leitura
 * brasileira falhar, então colidir com DDD nosso (44 Reino Unido, 41 Suíça) não faz estrago.
 */
const DDIS_CONHECIDOS = [
  '1', '27', '31', '32', '33', '34', '39', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '54', '56', '57', '58', '61', '81', '86',
  '244', '258', '351', '352', '353', '354', '358', '591', '595', '598', '971', '972',
].sort((a, b) => b.length - a.length)

export type BrPhone = {
  /** Dígitos prontos para uso (55 + DDD + número) quando `ok`; os dígitos crus quando não. */
  phone: string
  /** `false` = não é telefone discável. Nunca mande mensagem para ele. */
  ok: boolean
  /** Por que foi recusado, em português, para aparecer na ficha do lead. */
  motivo: string
  /** Número de fora do Brasil: válido, só não é nosso para normalizar. */
  estrangeiro: boolean
}

export function normalizeBrPhone(raw: string): BrPhone {
  const cru = String(raw ?? '')
  const digitos = cru.replace(/\D/g, '')
  if (!digitos) return { phone: '', ok: false, motivo: 'sem telefone', estrangeiro: false }

  const semZeroInicial = digitos.replace(/^0+/, '')
  const temDdi = semZeroInicial.length >= 12 && semZeroInicial.length <= 15 && semZeroInicial.startsWith('55')
  const nucleo = temDdi ? semZeroInicial.slice(2).replace(/^0+/, '') : semZeroInicial

  const ddd = nucleo.slice(0, 2)
  const numero = nucleo.slice(2)
  if (!DDDS_VALIDOS.has(ddd)) {
    return recusa(cru, digitos, `DDD ${ddd || '??'} não existe no Brasil`)
  }

  const bom = (p: string): BrPhone => ({ phone: p, ok: true, motivo: '', estrangeiro: false })
  if (numero.length === 9) {
    if (numero[0] === '9') return bom(`55${ddd}${numero}`)
    return recusa(cru, digitos, `celular de 9 dígitos tem de começar com 9, veio ${numero[0]}`)
  }
  if (numero.length === 8) {
    if (/^[6-9]/.test(numero)) return bom(`55${ddd}9${numero}`)
    if (/^[2-5]/.test(numero)) return bom(`55${ddd}${numero}`)
    return recusa(cru, digitos, `número começando com ${numero[0]} não é celular nem fixo`)
  }
  return recusa(cru, digitos, `${numero.length} dígitos depois do DDD ${ddd} (celular tem 9, fixo tem 8)`)
}

/**
 * A leitura brasileira falhou. Antes de condenar o número, vê se ele se apresentou com `+` e
 * um DDI que não é o nosso — aí é gente de fora, e o número está certo do jeito que veio.
 */
function recusa(cru: string, digitos: string, motivo: string): BrPhone {
  const temMais = cru.trim().startsWith('+')
  if (temMais && !digitos.startsWith('55') && digitos.length >= 8 && digitos.length <= 15) {
    const ddi = DDIS_CONHECIDOS.find((c) => digitos.startsWith(c))
    if (ddi) return { phone: digitos, ok: true, motivo: '', estrangeiro: true }
  }
  return { phone: digitos, ok: false, motivo, estrangeiro: false }
}
