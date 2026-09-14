import { describe, expect, it } from 'vitest'

import {
  linhasDeCancelamento,
  nomeDoPaciente,
  resumoCancelamentos,
  type CancelamentosDoMes,
} from './cancelamentos'

const dados = (over: Partial<CancelamentosDoMes> = {}): CancelamentosDoMes => ({
  mes: '2026-09',
  consultas: [
    {
      codigo: '61963364',
      prontuario: '7083',
      lead_id: null,
      paciente: 'ROSA C. PETRUCCI DAVINA',
      data: '2026-09-01',
      horario: '10:45',
      prestador: 'Lorena Visentainer',
      servico: null,
      observacao: 'Pagou sinal',
      remarcada_para: null,
    },
    {
      codigo: '62000001',
      prontuario: '6632',
      lead_id: 'lead-1',
      paciente: 'PAMELA THAÍS TKACZUK',
      data: '2026-09-15',
      horario: '12:05:00',
      prestador: 'Lorena Visentainer',
      servico: 'CONSULTA TRANSPLANTE CAPILAR',
      observacao: null,
      remarcada_para: '2026-10-21',
    },
  ],
  trocas_de_horario: 6,
  vendas: [
    {
      id: 'v1',
      kind: 'cirurgia',
      lead_id: 'lead-2',
      paciente: 'Glauber Moura',
      procedimento: 'Transplante capilar',
      valor_cents: 3_400_000,
      vendida_em: '2026-06-10',
      cancelada_em: '2026-09-03',
      motivo: 'Fechou protocolo',
      estorno: 'Não pagou',
      observacao: null,
      vendedora: 'Aline',
    },
    {
      id: 'v2',
      kind: 'protocolo',
      lead_id: null,
      paciente: 'Ana Souza',
      procedimento: 'Protocolo 6 meses',
      valor_cents: 480_000,
      vendida_em: '2026-09-02',
      cancelada_em: '2026-09-10',
      motivo: 'Motivos pessoais',
      estorno: 'Em avaliação',
      observacao: 'Pediu estorno da entrada',
      vendedora: null,
    },
  ],
  vendas_sem_data_de_cancelamento: 0,
  ...over,
})

describe('resumoCancelamentos', () => {
  it('conta os três tipos separados e soma o valor só de venda', () => {
    const r = resumoCancelamentos(dados())
    expect(r.consultas).toEqual({ qtd: 2, remarcaram: 1, semNovaData: 1 })
    expect(r.cirurgia).toEqual({ qtd: 1, valorCents: 3_400_000 })
    expect(r.protocolo).toEqual({ qtd: 1, valorCents: 480_000 })
    expect(r.total).toBe(4)
  })

  it('troca de horário não entra no total', () => {
    expect(resumoCancelamentos(dados({ consultas: [], vendas: [] })).total).toBe(0)
  })

  it('sem dado é tudo zero, não quebra a tela', () => {
    expect(resumoCancelamentos(null).total).toBe(0)
  })
})

describe('linhasDeCancelamento', () => {
  it('junta consulta e venda na ordem da data mais recente', () => {
    const linhas = linhasDeCancelamento(dados())
    expect(linhas.map((l) => [l.tipo, l.data])).toEqual([
      ['consulta', '2026-09-15'],
      ['protocolo', '2026-09-10'],
      ['cirurgia', '2026-09-03'],
      ['consulta', '2026-09-01'],
    ])
  })

  it('venda mostra o mês em que fechou, porque entra aqui pelo dia em que cancelou', () => {
    const cirurgia = linhasDeCancelamento(dados()).find((l) => l.tipo === 'cirurgia')
    expect(cirurgia?.detalhe).toBe('vendida em 10/06/2026 · Aline')
    expect(cirurgia?.valorCents).toBe(3_400_000)
  })

  it('motivo e observação do cancelamento saem juntos', () => {
    const protocolo = linhasDeCancelamento(dados()).find((l) => l.tipo === 'protocolo')
    expect(protocolo?.motivo).toBe('Motivos pessoais. Pediu estorno da entrada')
  })

  it('consulta leva hora, médico e a remarcação', () => {
    const pamela = linhasDeCancelamento(dados()).find((l) => l.chave === 'consulta:62000001')
    expect(pamela?.detalhe).toBe('12:05 · Lorena Visentainer')
    expect(pamela?.remarcadaPara).toBe('2026-10-21')
    expect(pamela?.valorCents).toBeNull()
  })
})

describe('nomeDoPaciente', () => {
  it('tira a caixa alta da agenda da Shosp', () => {
    expect(nomeDoPaciente('JÚLIO CÉSAR MARTINEZ DA LAVERDE')).toBe('Júlio César Martinez da Laverde')
  })

  it('não mexe em nome que já veio escrito por gente', () => {
    expect(nomeDoPaciente('Ana de Souza')).toBe('Ana de Souza')
  })

  it('nome vazio vira rótulo, não linha em branco', () => {
    expect(nomeDoPaciente('  ')).toBe('Paciente sem nome')
  })
})
