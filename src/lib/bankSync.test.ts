import { describe, expect, it } from 'vitest'

import { bankSyncTrouble } from '@/lib/bankSync'

const horasAtras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

describe('bankSyncTrouble', () => {
  it('conta que sincronizou agora não reclama de nada', () => {
    expect(bankSyncTrouble({ ofLastError: null, ofLastSyncAt: horasAtras(2) })).toBeNull()
  })

  it('atraso menor que uma rodada e meia ainda é normal', () => {
    expect(bankSyncTrouble({ ofLastError: null, ofLastSyncAt: horasAtras(29) })).toBeNull()
  })

  it('passou de 30h sem sync: três rodadas do cron perdidas, é pane', () => {
    expect(bankSyncTrouble({ ofLastError: null, ofLastSyncAt: horasAtras(31) })).toMatch(/sem extrato novo/)
  })

  it('erro do sync ganha do silêncio, porque é a causa e não o sintoma', () => {
    const msg = bankSyncTrouble({ ofLastError: 'ITEM_LOGIN_ERROR', ofLastSyncAt: horasAtras(1) })
    expect(msg).toBe('parou de sincronizar: ITEM_LOGIN_ERROR')
  })

  it('conta que nunca sincronizou não passa por conta em dia', () => {
    expect(bankSyncTrouble({ ofLastError: null, ofLastSyncAt: null })).toBe('ainda não sincronizou nenhuma vez')
  })
})
