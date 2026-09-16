import { describe, expect, it } from 'vitest'

import { dataVisivelDoCard } from './leadFollowups'

describe('dataVisivelDoCard', () => {
  it('nas colunas de contato é o "contato em", mesmo marcado para o futuro', () => {
    expect(
      dataVisivelDoCard({ coluna: 'contato_2', scheduledFor: '2026-09-24', cirurgiaEm: null }),
    ).toBe('2026-09-24')
  })

  it('em "Encerrado" é a cirurgia, que é a data que o card mostra', () => {
    expect(
      dataVisivelDoCard({
        coluna: 'encerrado',
        scheduledFor: '2026-08-01',
        cirurgiaEm: '2026-10-05T11:00:00+00:00',
      }),
    ).toBe('2026-10-05')
  })

  it('card fechado sem cirurgia não tem data na tela e não entra em período nenhum', () => {
    expect(
      dataVisivelDoCard({ coluna: 'nao_convertido', scheduledFor: '2026-09-10', cirurgiaEm: null }),
    ).toBeNull()
  })

  it('a cirurgia é lida no fuso da clínica, não em UTC', () => {
    // 22h de 05/out em Maringá já é 06/out em UTC.
    expect(
      dataVisivelDoCard({
        coluna: 'encerrado',
        scheduledFor: '2026-08-01',
        cirurgiaEm: '2026-10-06T01:00:00+00:00',
      }),
    ).toBe('2026-10-05')
  })
})
