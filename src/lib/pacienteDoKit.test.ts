import { describe, expect, it } from 'vitest'

import { type HorarioDaAgenda, dicaDoPaciente, juntarPacientes, sugestoesDaAgenda } from './pacienteDoKit'

describe('juntarPacientes', () => {
  it('paciente só do Shosp aparece, com o prontuário (o caso do Humberto Mozzer)', () => {
    const r = juntarPacientes([{ id: 'lead-1', name: 'Humberto', phone: '' }], [
      { prontuario: '7097', nome: 'HUMBERTO MOZZER', leadId: null, celular: '(44) 99961-5689' },
    ])
    expect(r.map((p) => p.chave)).toEqual(['lead:lead-1', 'shosp:7097'])
    expect(r[1]).toMatchObject({ nome: 'HUMBERTO MOZZER', leadId: null, prontuario: '7097' })
  })

  it('quem está nas duas fica uma vez, na linha do CRM, com o prontuário', () => {
    const r = juntarPacientes([{ id: 'lead-1', name: 'Lohana Ruiz', phone: '4499' }], [
      { prontuario: '12', nome: 'LOHANA RUIZ', leadId: 'lead-1', celular: null },
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ chave: 'lead:lead-1', nome: 'Lohana Ruiz', prontuario: '12' })
  })

  it('ficha do Shosp ligada a lead que a busca do CRM não trouxe entra pelo lead', () => {
    const r = juntarPacientes([], [
      { prontuario: '12', nome: 'ANA', leadId: 'lead-9', celular: null },
      { prontuario: '13', nome: 'ANA', leadId: 'lead-9', celular: null },
    ])
    expect(r).toEqual([expect.objectContaining({ chave: 'lead:lead-9', leadId: 'lead-9', prontuario: '12' })])
  })
})

describe('sugestoesDaAgenda', () => {
  const h = (nome: string, horario: string, prestador: string, extra: Partial<HorarioDaAgenda> = {}): HorarioDaAgenda => ({
    prontuario: nome,
    leadId: null,
    nome,
    horario,
    prestador,
    status: 'Agendado',
    data: '2026-09-22',
    ...extra,
  })

  it('no kit do SPA, o Spa Capilar vem primeiro; desmarcado e falta saem', () => {
    const r = sugestoesDaAgenda(
      [
        h('A', '08:00', 'Lorena Visentainer'),
        h('B', '09:00', 'Spa Capilar - Samir'),
        h('C', '08:30', 'Spa Capilar - Cintia'),
        h('D', '07:00', 'Spa Capilar - Samir', { status: 'Desmarcado' }),
        h('E', '07:30', 'Spa Capilar - Samir', { status: 'Faltou' }),
      ],
      'spa',
    )
    expect(r.map((p) => p.nome)).toEqual(['C', 'B', 'A'])
  })

  it('paciente com dois horários aparece uma vez, no primeiro', () => {
    const r = sugestoesDaAgenda([h('A', '15:00', 'Spa Capilar - Samir'), h('A', '14:00', 'Spa Capilar - Rafaely')], null)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ horario: '14:00', chave: 'shosp:A', data: '2026-09-22' })
  })

  it('a dica diz de onde veio', () => {
    const [p] = sugestoesDaAgenda([h('A', '14:00', 'Spa Capilar - Rafaely')], 'spa')
    expect(dicaDoPaciente(p)).toBe('14:00 · Spa Capilar - Rafaely · Shosp, sem cadastro no CRM · prontuário A')
  })
})
