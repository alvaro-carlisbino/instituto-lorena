import { describe, expect, it } from 'vitest'

import { chaveDaConversa, linhaDaMensagem, nomeCurtoDaLinha } from './linhaWhatsapp'

const SDR = 'wa-wapi-mpyi00su'
const MUNIZ = 'wa-wapi-mu4jwsjf'
const ids = new Set([SDR, MUNIZ])

describe('linhaDaMensagem', () => {
  it('mensagem de WhatsApp com linha do polo fica nessa linha', () => {
    expect(linhaDaMensagem({ channel: 'whatsapp', whatsappInstanceId: MUNIZ }, ids, SDR)).toBe(MUNIZ)
  })

  it('histórico sem linha gravada é da linha padrão', () => {
    expect(linhaDaMensagem({ channel: 'whatsapp' }, ids, SDR)).toBe(SDR)
  })

  it('linha desligada ou de outro polo cai na padrão', () => {
    expect(linhaDaMensagem({ channel: 'whatsapp', whatsappInstanceId: 'wa-molsxxx7' }, ids, SDR)).toBe(SDR)
    expect(linhaDaMensagem({ channel: 'whatsapp', whatsappInstanceId: 'tricopill-wapi' }, ids, SDR)).toBe(SDR)
  })

  it('nota de sistema e Instagram são do contato, sem linha', () => {
    expect(linhaDaMensagem({ channel: 'system', whatsappInstanceId: MUNIZ }, ids, SDR)).toBeNull()
    expect(linhaDaMensagem({ channel: 'meta' }, ids, SDR)).toBeNull()
  })
})

describe('chaveDaConversa', () => {
  it('linha padrão mantém a chave antiga (só o lead), para não reabrir o histórico como não lido', () => {
    expect(chaveDaConversa('lead-1', SDR, SDR)).toBe('lead-1')
    expect(chaveDaConversa('lead-1', null, SDR)).toBe('lead-1')
  })

  it('outro número ganha chave própria', () => {
    expect(chaveDaConversa('lead-1', MUNIZ, SDR)).toBe(`lead-1@${MUNIZ}`)
  })
})

describe('nomeCurtoDaLinha', () => {
  it('corta o parêntese do rótulo', () => {
    expect(nomeCurtoDaLinha('SDR Instituto (W-API)')).toBe('SDR Instituto')
    expect(nomeCurtoDaLinha('Aline Muniz (WhatsApp próprio)')).toBe('Aline Muniz')
    expect(nomeCurtoDaLinha('SDR')).toBe('SDR')
  })
})
