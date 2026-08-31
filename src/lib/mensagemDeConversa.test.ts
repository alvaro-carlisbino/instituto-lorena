import { describe, expect, it } from 'vitest'

import { ehMensagemDeConversa, ehRecebidaDoPaciente } from './mensagemDeConversa'

describe('mensagemDeConversa', () => {
  it('mensagem do paciente no WhatsApp é conversa e é recebida', () => {
    const msg = { channel: 'whatsapp' as const, direction: 'in' as const }
    expect(ehMensagemDeConversa(msg)).toBe(true)
    expect(ehRecebidaDoPaciente(msg)).toBe(true)
  })

  it('resposta da clínica é conversa, mas não é recebida', () => {
    const msg = { channel: 'whatsapp' as const, direction: 'out' as const }
    expect(ehMensagemDeConversa(msg)).toBe(true)
    expect(ehRecebidaDoPaciente(msg)).toBe(false)
  })

  // O caso de 31/08/2026: a reorganização do Kanban gravou a nota com direction 'in'.
  // É por `channel` que a regra tem de decidir, senão 149 conversas viram "não lidas".
  it('nota de sistema gravada como entrada NÃO conta como mensagem do paciente', () => {
    const nota = { channel: 'system' as const, direction: 'in' as const }
    expect(ehMensagemDeConversa(nota)).toBe(false)
    expect(ehRecebidaDoPaciente(nota)).toBe(false)
  })

  it('nota de sistema com direction system também fica de fora', () => {
    const nota = { channel: 'system' as const, direction: 'system' as const }
    expect(ehMensagemDeConversa(nota)).toBe(false)
    expect(ehRecebidaDoPaciente(nota)).toBe(false)
  })

  it('lead que chegou pela Meta continua contando', () => {
    const msg = { channel: 'meta' as const, direction: 'in' as const }
    expect(ehRecebidaDoPaciente(msg)).toBe(true)
  })
})
