import { describe, expect, it } from 'vitest'
import { mensagemDeErro } from './mensagemDeErro'

/**
 * O que estes testes protegem: nenhum erro de tela pode virar "[object Object]".
 *
 * Em 28/08/2026 o Postgres do projeto reiniciou e a API ficou ~13 minutos fora. A tela do CRM
 * disse "Perfil: [object Object]" — o erro do PostgREST (PGRST002, sem cache de schema) foi
 * jogado fora justamente quando era a única pista.
 */
describe('mensagemDeErro', () => {
  it('lê o PostgrestError, que não é um Error', () => {
    expect(
      mensagemDeErro({ message: 'Could not query the database for the schema cache. Retrying.', code: 'PGRST002', details: null, hint: null }),
    ).toBe('Could not query the database for the schema cache. Retrying. (PGRST002)')
  })

  it('junta detalhe e dica quando vêm', () => {
    expect(mensagemDeErro({ message: 'permission denied', details: 'tabela app_profiles', hint: 'confira a policy', code: '42501' }))
      .toBe('permission denied — tabela app_profiles — confira a policy (42501)')
  })

  it('lê o AuthError, que traz status em vez de code', () => {
    expect(mensagemDeErro({ message: 'Invalid login credentials', status: 400 })).toBe('Invalid login credentials (400)')
  })

  it('mantém o comportamento bom do Error de sempre', () => {
    expect(mensagemDeErro(new Error('Sessão inválida'))).toBe('Sessão inválida')
  })

  it('aceita string crua', () => {
    expect(mensagemDeErro('deu ruim')).toBe('deu ruim')
  })

  it('objeto sem message vira JSON, nunca [object Object]', () => {
    const saida = mensagemDeErro({ algo: 'estranho' })
    expect(saida).not.toContain('[object Object]')
    expect(saida).toContain('estranho')
  })

  it('não quebra com referência circular nem com vazio', () => {
    const circular: Record<string, unknown> = {}
    circular.eu = circular
    expect(mensagemDeErro(circular)).toBe('erro desconhecido')
    expect(mensagemDeErro(null)).toBe('erro desconhecido')
    expect(mensagemDeErro(undefined)).toBe('erro desconhecido')
  })
})
