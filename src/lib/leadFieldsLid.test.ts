import { describe, expect, it } from 'vitest'
import { getLeadPhoneDisplay, isWhatsappLidOnly } from './leadFields'
import type { Lead } from '@/mocks/crmMock'

/**
 * O `@lid` é o identificador que o WhatsApp usa no lugar do número quando a pessoa liga a
 * privacidade: 14-15 dígitos com cara de telefone internacional. A ficha os exibia como
 * "Telefone principal", com um "Chamar no WhatsApp" ao lado apontando para um wa.me que não
 * existe. Conversar por ali funciona; discar, não.
 */
const lead = (over: Partial<Lead>): Pick<Lead, 'phone' | 'source' | 'customFields'> =>
  ({ phone: '', source: 'whatsapp', customFields: {}, ...over }) as Lead

describe('telefone na ficha quando o WhatsApp esconde o número', () => {
  it('lid no lugar do telefone: diz que não há número, e some o botão de chamar', () => {
    const so_lid = lead({ phone: '173761676468438', customFields: { wa_lid: '173761676468438' } })
    expect(isWhatsappLidOnly(so_lid)).toBe(true)
    expect(getLeadPhoneDisplay(so_lid)).toEqual({
      label: 'Número protegido · só por WhatsApp',
      isReal: false,
    })
  })

  it('telefone real COM lid indexado ao lado continua sendo telefone', () => {
    // O caso comum depois da correção: a mensagem traz os dois, e o par é gravado junto.
    // Se a tela confundisse os dois, 2.665 cadastros perderiam o número na exibição.
    const normal = lead({ phone: '5544991000001', customFields: { wa_lid: '78159932330227' } })
    expect(isWhatsappLidOnly(normal)).toBe(false)
    expect(getLeadPhoneDisplay(normal)).toEqual({ label: '5544991000001', isReal: true })
  })

  it('carimbo velho grudado não esconde um número que existe', () => {
    // `mergeCustomFields` é {...keep, ...drop}: na mesclagem, o campo do cadastro-lid vence.
    // Por isso a tela pergunta ao dado, e não ao carimbo.
    const juntado = lead({
      phone: '5544991000002',
      customFields: { wa_lid: '78159932330227', wa_lid_only: true },
    })
    expect(isWhatsappLidOnly(juntado)).toBe(false)
    expect(getLeadPhoneDisplay(juntado).isReal).toBe(true)
  })

  it('sem lid nenhum, nada muda para quem já era sintético do ManyChat', () => {
    const mc = lead({ phone: '8880011234567890', source: 'meta_instagram' })
    expect(isWhatsappLidOnly(mc)).toBe(false)
    expect(getLeadPhoneDisplay(mc).isReal).toBe(false)
  })
})
