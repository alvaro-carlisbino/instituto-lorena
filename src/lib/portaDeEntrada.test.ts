import { describe, expect, it } from 'vitest'

import { portaDoLead } from './portaDeEntrada'

describe('porta de entrada do lead', () => {
  it('landing ganha do source, porque o source do lead da landing é regravado', () => {
    // Caso real: 6 dos 7 leads da /consulta já estavam como `whatsapp` em 31/ago/2026,
    // porque o webhook de entrada regrava o source quando a pessoa responde a Sofia.
    expect(portaDoLead({ source: 'whatsapp', customFields: { origem_landing: 'consulta' } })).toBe('landing')
    expect(portaDoLead({ source: 'manual', customFields: { origem_landing: 'consulta' } })).toBe('landing')
  })

  it('landing ganha do formulário quando a pessoa entrou pelos dois', () => {
    expect(portaDoLead({ source: 'meta_instagram', customFields: { origem_landing: 'consulta', lead_form: {} } })).toBe(
      'landing',
    )
  })

  it('formulário sai do custom_fields, não do canal', () => {
    // 810 dos 881 leads `meta_instagram` da clínica são Lead Ads: agrupar por source
    // jogaria formulário e conversa direta na mesma linha.
    expect(portaDoLead({ source: 'meta_instagram', customFields: { lead_form: { id: '1' } } })).toBe('formulario')
    expect(portaDoLead({ source: 'meta_instagram', customFields: {} })).toBe('whatsapp')
  })

  it('conta lead_form presente mesmo com valor nulo (a chave é a evidência)', () => {
    expect(portaDoLead({ source: 'manual', customFields: { lead_form: null } })).toBe('formulario')
  })

  it('separa planilha e recepção, que não são canal de aquisição', () => {
    expect(portaDoLead({ source: 'planilha_2026_07', customFields: {} })).toBe('importacao')
    expect(portaDoLead({ source: 'consulta_presencial', customFields: {} })).toBe('presencial')
  })

  it('trata a família WhatsApp como uma porta só', () => {
    for (const s of ['whatsapp', 'meta_whatsapp', 'meta_instagram', 'meta_messenger']) {
      expect(portaDoLead({ source: s, customFields: {} })).toBe('whatsapp')
    }
  })

  it('lead sem evidência nenhuma cai em outro', () => {
    expect(portaDoLead({ source: 'manual', customFields: {} })).toBe('outro')
    expect(portaDoLead({})).toBe('outro')
  })
})
