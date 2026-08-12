// Estados de NF-e que existem de verdade em bling_nfe_emissions/rede_payments hoje.
import { describe, expect, it } from 'vitest'

import { nfeSelo } from '@/lib/nfeSelo'

describe('nfeSelo', () => {
  it('rascunho numerado não é nota emitida — é o balde com 226 linhas na base', () => {
    // O Bling carimba nfe_numero já no rascunho. Se o número virasse selo verde, a atendente
    // responderia "a nota saiu" para um documento que a SEFAZ nunca viu.
    const s = nfeSelo('rascunho', '000210')
    expect(s.tom).toBe('pendente')
    expect(s.label).not.toContain('emitida')
  })

  it('número sem status nenhum vira "sem confirmação", nunca verde', () => {
    const s = nfeSelo(null, '000210')
    expect(s.tom).toBe('pendente')
    expect(s.label).toContain('000210')
  })

  it('status nulo E sem número é a única resposta que pode dizer "sem nota"', () => {
    // O pedido do incidente de 12/ago estava assim: pago, com CPF, nfe_status NULL.
    // Não é rejeição, é ninguém ter clicado — e a atendente precisa poder dizer isso.
    expect(nfeSelo(null, null).tom).toBe('ausente')
    expect(nfeSelo(null, null).label).toBe('Sem nota emitida')
  })

  it('só AUTORIZADA fica verde, e leva o número junto', () => {
    expect(nfeSelo('autorizada', '000210').tom).toBe('ok')
    expect(nfeSelo('autorizada', '000210').label).toContain('000210')
  })

  it('"emitida" é aceite de transmissão, não autorização da SEFAZ, então não fica verde', () => {
    // O CRM grava 'emitida' quando o POST /nfe/{id}/enviar do Bling devolve 2xx. A autorização
    // vem depois e ninguém relê. Verde aqui faria a atendente afirmar o que não sabe.
    const s = nfeSelo('emitida', '000210')
    expect(s.tom).toBe('pendente')
    expect(s.label).toContain('000210')
    expect(s.detalhe).toContain('SEFAZ')
  })

  it('rejeitada e erro contam como falha, não como pendência', () => {
    expect(nfeSelo('rejeitada', null).tom).toBe('falha')
    expect(nfeSelo('envio_400: VALIDATION_ERROR', null).tom).toBe('falha')
  })

  it('status desconhecido não é chutado para verde nem para "sem nota"', () => {
    expect(nfeSelo('aguardando_retorno', null).tom).toBe('pendente')
  })
})
