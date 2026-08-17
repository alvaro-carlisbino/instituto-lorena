import { describe, expect, it } from 'vitest'

import { tipoDoHash } from './authLinkFlow'

/**
 * O que decide se a usuária cai na tela de criar senha. A leitura acontece na
 * importação do módulo, porque o supabase-js limpa a URL assim que o cliente é
 * criado — o que sobra para testar, e é o que importa, é a regra do que conta
 * como link de convite.
 */
describe('tipoDoHash', () => {
  it('reconhece o convite', () => {
    expect(tipoDoHash('#access_token=abc&refresh_token=def&type=invite')).toBe('invite')
  })

  it('reconhece a recuperação de senha', () => {
    expect(tipoDoHash('#access_token=abc&type=recovery')).toBe('recovery')
  })

  // Sem esta guarda, um '#type=invite' colado na URL prenderia quem já está
  // logada numa tela de senha sem sessão nenhuma para trocar.
  it('ignora hash sem access_token', () => {
    expect(tipoDoHash('#type=invite')).toBeNull()
  })

  it('ignora tipo que não pede senha', () => {
    expect(tipoDoHash('#access_token=abc&type=magiclink')).toBeNull()
  })

  it('ignora navegação normal', () => {
    expect(tipoDoHash('')).toBeNull()
    expect(tipoDoHash('#/leads')).toBeNull()
  })

  it('aceita o hash sem o # da frente', () => {
    expect(tipoDoHash('access_token=abc&type=invite')).toBe('invite')
  })
})
