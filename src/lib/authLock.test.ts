import { describe, expect, it } from 'vitest'

import { comRetryDeLock, isAuthLockError } from './authLock'

const erroDeLockRoubado = () => {
  const e = new Error(
    'Lock "lock:sb-fgyfpmnvlkmyxtucbxbu-auth-token" was released because another request stole it',
  )
  ;(e as Error & { isAcquireTimeout: boolean }).isAcquireTimeout = true
  return e
}

describe('isAuthLockError', () => {
  it('reconhece o lock roubado pela marca do auth-js', () => {
    expect(isAuthLockError(erroDeLockRoubado())).toBe(true)
  })

  it('reconhece pela mensagem, mesmo sem a marca', () => {
    expect(
      isAuthLockError(new Error('Lock "lock:sb-abc-auth-token" was released because another request stole it')),
    ).toBe(true)
    expect(isAuthLockError(new Error('Lock "lock:sb-abc-auth-token" was not released within 5000ms.'))).toBe(true)
  })

  it('reconhece pelo nome da classe', () => {
    const e = new Error('qualquer coisa')
    e.name = 'NavigatorLockAcquireTimeoutError'
    expect(isAuthLockError(e)).toBe(true)
  })

  it('não confunde com erro de dado, de permissão ou de API fora', () => {
    expect(isAuthLockError({ message: 'JWT expired', code: 'PGRST301' })).toBe(false)
    expect(isAuthLockError({ message: 'permission denied for table leads', code: '42501' })).toBe(false)
    expect(isAuthLockError(new Error('Failed to fetch'))).toBe(false)
    expect(isAuthLockError(null)).toBe(false)
    expect(isAuthLockError('lock')).toBe(false)
  })
})

describe('comRetryDeLock', () => {
  const semEspera = async () => {}

  it('devolve o valor sem repetir quando dá certo de primeira', async () => {
    let chamadas = 0
    const r = await comRetryDeLock(async () => {
      chamadas += 1
      return 'perfil'
    }, { espera: semEspera })
    expect(r).toBe('perfil')
    expect(chamadas).toBe(1)
  })

  it('repete quando o lock foi roubado e entrega na tentativa seguinte', async () => {
    let chamadas = 0
    const r = await comRetryDeLock(async () => {
      chamadas += 1
      if (chamadas < 3) throw erroDeLockRoubado()
      return 'perfil'
    }, { espera: semEspera })
    expect(r).toBe('perfil')
    expect(chamadas).toBe(3)
  })

  it('desiste depois das tentativas e devolve o último erro de lock', async () => {
    let chamadas = 0
    await expect(
      comRetryDeLock(async () => {
        chamadas += 1
        throw erroDeLockRoubado()
      }, { espera: semEspera }),
    ).rejects.toThrow('another request stole it')
    expect(chamadas).toBe(3)
  })

  it('NÃO repete erro que não é de lock — RLS e API fora têm que chegar na tela', async () => {
    let chamadas = 0
    await expect(
      comRetryDeLock(async () => {
        chamadas += 1
        throw { message: 'permission denied for table app_profiles', code: '42501' }
      }, { espera: semEspera }),
    ).rejects.toMatchObject({ code: '42501' })
    expect(chamadas).toBe(1)
  })
})
