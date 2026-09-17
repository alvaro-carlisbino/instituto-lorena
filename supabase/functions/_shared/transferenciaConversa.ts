/**
 * TRANSFERIR CONVERSA ENTRE NÚMEROS E ATENDENTES (17/set/2026).
 *
 * Com o WhatsApp da Aline Muniz ao lado da SDR, a passagem do contato era só uma frase ("A Aline
 * Muniz irá entrar em contato com você") e nada no CRM mudava: o contato seguia amarrado no
 * número da SDR, lembrete e resposta saíam por lá, e a Muniz não tinha como achar a conversa na
 * aba dela. O botão "Transferir" faz a passagem de verdade, nos dois sentidos:
 *
 * - o contato passa a ser do número de destino (`leads.whatsapp_instance_id`): é por ele que a
 *   resposta, o lembrete e o follow-up saem, e é na aba dele que a conversa aparece;
 * - o responsável muda. Número particular leva sempre a dona: o WhatsApp da Muniz só ela vê,
 *   então deixar o contato com outra pessoa seria dar a conversa a quem não enxerga;
 * - no número de onde saiu, a IA fica em "Humano" como quando a equipe responde (expira do
 *   mesmo jeito). Sem isto a Sofia retomava a triagem pelo número da SDR do paciente que a
 *   Muniz já estava atendendo;
 * - fica uma nota de sistema na conversa (aparece nos dois números) e quem recebe é avisado.
 *
 * O que NÃO muda: polo do lead, etapa do funil e as mensagens (cada uma segue guardando o número
 * por onde passou). E o webhook continua reamarrando o contato no número em que ele escrever:
 * se o paciente voltar a falar com a SDR, a resposta volta a sair pela SDR.
 *
 * Lógica pura, sem banco, para dar para testar: `transferenciaConversa.test.ts`.
 */

export type LinhaParaTransferir = {
  id: string
  label: string
  active: boolean
  sortOrder: number
  privateOwnerId: string | null
  aiAutoReply: boolean
}

export type LeadParaTransferir = {
  ownerId: string | null
  whatsappInstanceId: string | null
}

export type PedidoDeTransferencia = {
  paraLinhaId: string
  /** Número da conversa aberta na tela. Omitido, vale o número em que o contato está amarrado. */
  deLinhaId?: string | null
  /** Responsável escolhido. Ignorado quando o destino é particular (vai a dona). */
  responsavelId?: string | null
}

export type PlanoDeTransferencia = {
  de: LinhaParaTransferir | null
  para: LinhaParaTransferir
  /** `leads.whatsapp_instance_id` precisa ser gravado. */
  gravaNumero: boolean
  /** A conversa muda de número (nota, histórico de linhas, IA da origem). */
  trocaNumero: boolean
  responsavel: string | null
  trocaResponsavel: boolean
  /** Origem com IA: fica em "Humano" para a Sofia não falar por cima de quem recebeu. */
  segurarIaNaOrigem: boolean
}

export type RecusaDeTransferencia = {
  erro: 'linha_indisponivel' | 'nada_mudou'
  mensagem: string
}

/** "SDR Instituto (W-API)" → "SDR Instituto". Mesma regra de `src/lib/linhaWhatsapp.ts`. */
export function nomeCurtoDaLinha(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim() || label
}

export function planejarTransferencia(
  linhasDoPolo: LinhaParaTransferir[],
  lead: LeadParaTransferir,
  pedido: PedidoDeTransferencia,
): PlanoDeTransferencia | RecusaDeTransferencia {
  const ativas = linhasDoPolo.filter((l) => l.active).sort((a, b) => a.sortOrder - b.sortOrder)
  const para = ativas.find((l) => l.id === pedido.paraLinhaId)
  if (!para) {
    return { erro: 'linha_indisponivel', mensagem: 'Esse número não está ativo neste polo.' }
  }

  // Contato sem número (ou num número desligado) é da linha padrão: a primeira ativa, a mesma
  // por onde a resposta dele sai hoje (`resolveOutboundProviderForLead`).
  const amarrado = ativas.find((l) => l.id === lead.whatsappInstanceId) ?? ativas[0] ?? null
  const de = ativas.find((l) => l.id === pedido.deLinhaId) ?? amarrado

  const responsavel = para.privateOwnerId ?? (pedido.responsavelId?.trim() || lead.ownerId || null)
  const trocaNumero = de?.id !== para.id || amarrado?.id !== para.id
  const trocaResponsavel = responsavel !== lead.ownerId

  if (!trocaNumero && !trocaResponsavel) {
    return { erro: 'nada_mudou', mensagem: 'Esse contato já está nesse número e com essa pessoa.' }
  }

  return {
    de,
    para,
    gravaNumero: lead.whatsappInstanceId !== para.id,
    trocaNumero,
    responsavel,
    trocaResponsavel,
    segurarIaNaOrigem: trocaNumero && de !== null && de.id !== para.id && de.aiAutoReply,
  }
}

export function notaDaTransferencia(input: {
  quem: string
  plano: PlanoDeTransferencia
  responsavelAnterior: string | null
  responsavel: string | null
  recado?: string | null
}): string {
  const { plano } = input
  const linhas = [`Conversa transferida por ${input.quem}.`]
  if (plano.trocaNumero) {
    const de = plano.de ? nomeCurtoDaLinha(plano.de.label) : 'sem número'
    linhas.push(`Número: ${de} → ${nomeCurtoDaLinha(plano.para.label)}.`)
  }
  if (plano.trocaResponsavel) {
    linhas.push(`Responsável: ${input.responsavelAnterior || 'ninguém'} → ${input.responsavel || 'ninguém'}.`)
  } else if (input.responsavel) {
    linhas.push(`Responsável: ${input.responsavel}.`)
  }
  const recado = input.recado?.trim()
  if (recado) linhas.push(`Recado: ${recado}`)
  return linhas.join('\n')
}
