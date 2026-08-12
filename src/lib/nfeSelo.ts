/**
 * Traduz o estado cru da NF-e do Bling num selo curto — a mesma regra do `nfeMeta()` da tela
 * /pedidos, com um cuidado a mais que o incidente de 12/ago exigiu.
 *
 * "Não veio nota fiscal?" é literalmente a pergunta que o cliente faz no WhatsApp, e o banco
 * responde mal: existem 226 rascunhos COM `nfe_numero` preenchido e NENHUMA nota autorizada.
 * Ou seja, número de nota não prova nota emitida. Por isso, aqui:
 *
 *   - `nfe_status` nulo não é "sem nota emitida com sucesso", é "não sabemos";
 *   - número sem status NUNCA vira selo verde, vira "sem confirmação";
 *   - rascunho tem selo próprio, porque rascunho no Bling é documento nenhum.
 *
 * Sem isso a atendente responde "a nota saiu" para um pedido que a SEFAZ nunca viu.
 */

export type NfeTom = 'ok' | 'falha' | 'pendente' | 'ausente'

export type NfeSelo = {
  label: string
  tom: NfeTom
  /** Frase inteira para o `title`: o selo é curto demais para caber a ressalva. */
  detalhe: string
}

export function nfeSelo(status: string | null | undefined, numeroNota: string | null | undefined): NfeSelo {
  const s = (status ?? '').toLowerCase()
  const n = (numeroNota ?? '').trim()

  if (s.includes('autoriz') || s === 'ok') {
    return {
      label: n ? `NF-e ${n}` : 'NF-e autorizada',
      tom: 'ok',
      detalhe: `Nota autorizada pela SEFAZ${n ? ` (nº ${n})` : ''}.`,
    }
  }
  // `emitida` NÃO é autorizada. O CRM grava esse status quando o `POST /nfe/{id}/enviar` do
  // Bling devolve 2xx, que é só o ACEITE da transmissão; a autorização da SEFAZ vem depois, de
  // forma assíncrona, e o CRM nunca relê. Hoje não existe nenhuma linha `emitida` na base, então
  // isto é preventivo: no dia da primeira transmissão, dar verde aqui faria a atendente afirmar
  // ao cliente que a nota saiu antes de a SEFAZ ter dito qualquer coisa.
  if (s.includes('emitid') || s.includes('transmit') || s.includes('enviad')) {
    return {
      label: n ? `NF-e ${n} · transmitida` : 'NF-e transmitida',
      tom: 'pendente',
      detalhe: `Transmitida ao Bling${n ? ` (nº ${n})` : ''}, sem confirmação de autorização da SEFAZ. Confira no Bling antes de dizer ao cliente que a nota saiu.`,
    }
  }
  if (s.includes('rejeit') || s.includes('erro') || s.includes('deneg') || s.includes('fail')) {
    return {
      label: 'NF-e rejeitada',
      tom: 'falha',
      detalhe: 'A SEFAZ recusou a nota. Nada foi emitido — o cliente não recebeu documento fiscal.',
    }
  }
  if (s.includes('rascunho') || s.includes('draft')) {
    return {
      label: 'NF-e em rascunho',
      tom: 'pendente',
      detalhe: `Rascunho no Bling${n ? ` (nº ${n})` : ''}: a nota foi montada mas NÃO foi transmitida. Não vale como documento fiscal.`,
    }
  }
  if (s) {
    return {
      label: 'NF-e processando',
      tom: 'pendente',
      detalhe: `Status no Bling: ${status}. Ainda não há confirmação de autorização.`,
    }
  }
  if (n) {
    return {
      label: `NF-e ${n} · sem confirmação`,
      tom: 'pendente',
      detalhe: `Existe número (${n}) e nenhum status. Número sozinho não prova emissão — a base tem centenas de rascunhos numerados. Confira no Bling antes de dizer ao cliente que a nota saiu.`,
    }
  }
  return {
    label: 'Sem nota emitida',
    tom: 'ausente',
    detalhe: 'Não há nota nem tentativa registrada para este pedido.',
  }
}
