import { describe, expect, it } from 'vitest'

import { type LinhaConferenciaSpa, agruparAtendimentos, resumoSpa } from './conferenciaSpa'

const linha = (p: Partial<LinhaConferenciaSpa>): LinhaConferenciaSpa => ({
  tipo: 'atendimento',
  codigoAgendamento: 'a1',
  data: '2026-09-17',
  horario: '12:00',
  prestador: 'Spa Capilar - Rafaely',
  paciente: 'LOHANA RUIZ',
  prontuario: '7001',
  leadId: null,
  status: 'Confirmado',
  semMaterial: false,
  kitId: null,
  kitNome: null,
  kitStatus: null,
  ...p,
})

describe('agruparAtendimentos', () => {
  it('vários horários do mesmo paciente no dia viram um atendimento', () => {
    const [a, ...resto] = agruparAtendimentos([
      linha({ codigoAgendamento: 'a2', horario: '13:00:00', prestador: 'SPA CAPILAR - Mª EDUARDA' }),
      linha({}),
    ])
    expect(resto).toEqual([])
    expect(a.horarios).toEqual(['12:00', '13:00'])
    expect(a.profissionais).toEqual(['Rafaely', 'Mª Eduarda'])
    expect(a.paciente).toBe('Lohana Ruiz')
    expect(a.primeiroAgendamento).toBe('a1')
    expect(a.situacao).toBe('pendente')
  })

  it('kit em qualquer horário do dia resolve o atendimento', () => {
    const [a] = agruparAtendimentos([linha({}), linha({ codigoAgendamento: 'a2', horario: '13:00', kitId: 'k', kitNome: 'Kit MMP' })])
    expect(a.situacao).toBe('com_kit')
    expect(a.kits).toEqual([{ id: 'k', nome: 'Kit MMP', status: null }])
  })

  it('"sem material" só vale quando todos os horários do dia foram marcados', () => {
    const parcial = agruparAtendimentos([linha({ semMaterial: true }), linha({ codigoAgendamento: 'a2', horario: '13:00' })])
    expect(parcial[0].situacao).toBe('pendente')
    const todos = agruparAtendimentos([linha({ semMaterial: true })])
    expect(todos[0].situacao).toBe('sem_material')
  })

  it('kit sem agenda fica fora; dias diferentes são atendimentos diferentes', () => {
    const lista = agruparAtendimentos([
      linha({}),
      linha({ codigoAgendamento: 'b', data: '2026-09-18' }),
      linha({ tipo: 'kit_sem_agenda', codigoAgendamento: null, kitId: 'k' }),
    ])
    expect(lista.map((a) => a.data)).toEqual(['2026-09-18', '2026-09-17'])
    expect(resumoSpa(lista)).toEqual({ total: 2, comKit: 0, semMaterial: 0, pendentes: 2 })
  })
})
