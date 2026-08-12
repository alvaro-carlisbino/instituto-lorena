import { describe, expect, it } from 'vitest'

import { completudeCadastro, escolheMelhorCadastro, type LeadCandidato } from './crmClienteAnterior'

const lead = (id: string, cf: Record<string, unknown> | null, criadoEm = '2026-01-01T00:00:00Z'): LeadCandidato => ({
  id,
  patient_name: `Lead ${id}`,
  created_at: criadoEm,
  custom_fields: cf,
})

const completo = {
  cadastro: { nomeCompleto: 'Maria Aparecida Souza', cpf: '12345678901', dataNascimento: '10/04/1988', email: 'm@x.com' },
  entrega: { cep: '87050000', logradouro: 'Av Brasil', numero: '1200', bairro: 'Centro', cidade: 'Maringá', uf: 'PR' },
}

describe('completudeCadastro', () => {
  it('só o primeiro nome não é cadastro: fica abaixo do corte', () => {
    expect(completudeCadastro({ cadastro: { nomeCompleto: 'Maria' } })).toBeLessThan(6)
  })

  it('CPF pontuado conta igual (foi gravado das duas formas)', () => {
    expect(completudeCadastro({ cadastro: { cpf: '123.456.789-01' } })).toBe(
      completudeCadastro({ cadastro: { cpf: '12345678901' } }),
    )
  })

  it('cadastro com nome, CPF e endereço passa do corte', () => {
    expect(completudeCadastro(completo)).toBeGreaterThanOrEqual(6)
  })
})

describe('escolheMelhorCadastro', () => {
  it('devolve nulo quando ninguém tem cadastro aproveitável', () => {
    expect(escolheMelhorCadastro([lead('a', null), lead('b', { cadastro: { nomeCompleto: 'Zé' } })])).toBeNull()
  })

  it('prefere o mais completo, não o mais recente', () => {
    const escolhido = escolheMelhorCadastro([
      lead('novo-e-vazio', { cadastro: { nomeCompleto: 'Maria Aparecida Souza', cpf: '12345678901' } }, '2026-08-01T00:00:00Z'),
      lead('velho-e-completo', completo, '2025-02-01T00:00:00Z'),
    ])
    expect(escolhido?.fonte.leadId).toBe('velho-e-completo')
  })

  it('no empate de completude, o mais recente ganha', () => {
    const escolhido = escolheMelhorCadastro([
      lead('antigo', completo, '2025-02-01T00:00:00Z'),
      lead('recente', completo, '2026-07-30T00:00:00Z'),
    ])
    expect(escolhido?.fonte.leadId).toBe('recente')
  })

  it('devolve o custom_fields inteiro do lead escolhido (é dali que a tela lê cadastro e entrega)', () => {
    const escolhido = escolheMelhorCadastro([lead('x', completo)])
    expect(escolhido?.customFields).toEqual(completo)
  })
})
