import { describe, expect, it } from 'vitest'

import {
  agruparPorDia,
  escalaDoGrau,
  mascararTelefone,
  perguntasVisiveis,
  podeReservarHorario,
  telefoneValido,
  temEstimativa,
  triagemCompleta,
} from './triagemConsulta'

describe('perguntas visíveis', () => {
  it('mostra a escala Norwood só para o caso masculino', () => {
    const ids = perguntasVisiveis({ objetivo: 'transplante_masculino' }).map((p) => p.id)
    expect(ids.filter((i) => i === 'grau')).toHaveLength(1)
    expect(perguntasVisiveis({ objetivo: 'transplante_masculino' }).find((p) => p.id === 'grau')?.visual).toBe('norwood')
  })

  it('troca para Ludwig no caso feminino', () => {
    expect(perguntasVisiveis({ objetivo: 'transplante_feminino' }).find((p) => p.id === 'grau')?.visual).toBe('ludwig')
  })

  it('não pergunta grau para sobrancelha', () => {
    const ids = perguntasVisiveis({ objetivo: 'sobrancelha' }).map((p) => p.id)
    expect(ids).not.toContain('grau')
  })

  it('são três toques no caso de cabelo e dois nos outros', () => {
    expect(perguntasVisiveis({ objetivo: 'transplante_masculino' })).toHaveLength(3)
    expect(perguntasVisiveis({ objetivo: 'transplante_feminino' })).toHaveLength(3)
    expect(perguntasVisiveis({ objetivo: 'barba' })).toHaveLength(2)
  })
})

describe('triagem completa', () => {
  it('exige resposta em toda pergunta visível', () => {
    expect(triagemCompleta({ objetivo: 'sobrancelha' })).toBe(false)
    expect(triagemCompleta({ objetivo: 'sobrancelha', urgencia: 'este_mes' })).toBe(true)
  })

  it('não considera completa sem o grau quando o grau é perguntado', () => {
    expect(triagemCompleta({ objetivo: 'transplante_masculino', urgencia: 'este_mes' })).toBe(false)
    expect(
      triagemCompleta({ objetivo: 'transplante_masculino', grau: '4', urgencia: 'este_mes' }),
    ).toBe(true)
  })
})

describe('quem vê agenda', () => {
  it('esconde a agenda de quem só está pesquisando', () => {
    expect(podeReservarHorario({ urgencia: 'pesquisando' })).toBe(false)
  })

  it('abre a agenda para quem quer resolver', () => {
    expect(podeReservarHorario({ urgencia: 'este_mes' })).toBe(true)
    expect(podeReservarHorario({ urgencia: 'ate_3_meses' })).toBe(true)
  })

  it('não abre agenda antes de responder', () => {
    expect(podeReservarHorario({})).toBe(false)
  })
})

describe('estimativa e escala', () => {
  it('só estima folículos para cabelo', () => {
    expect(temEstimativa({ objetivo: 'transplante_masculino' })).toBe(true)
    expect(temEstimativa({ objetivo: 'barba' })).toBe(false)
  })

  it('traduz o grau para a escala da RPC', () => {
    expect(escalaDoGrau('3v')).toEqual({ escala: 'norwood', grau: '3v' })
    expect(escalaDoGrau('ludwig_2')).toEqual({ escala: 'ludwig', grau: '2' })
    expect(escalaDoGrau('')).toBeNull()
  })
})

describe('agrupar horários por dia', () => {
  it('usa o dia de Maringá e não o do fuso do navegador', () => {
    // 21/08 às 21:30 em Brasília já é 22/08 em UTC. O dia da agenda é o da clínica.
    const dias = agruparPorDia([
      { unidadeId: 'maringa', codigoPrestador: '2', profissional: 'Dra. Lorena Visentainer', slotAt: '2026-08-22T00:30:00.000Z' },
      { unidadeId: 'maringa', codigoPrestador: '2', profissional: 'Dra. Lorena Visentainer', slotAt: '2026-08-21T12:00:00.000Z' },
    ])
    expect(dias.map((d) => d.dia)).toEqual(['2026-08-21'])
    expect(dias[0].horarios).toHaveLength(2)
  })

  it('ordena dias e horários', () => {
    const dias = agruparPorDia([
      { unidadeId: 'maringa', codigoPrestador: '2', profissional: 'Dra. Lorena Visentainer', slotAt: '2026-08-24T13:30:00.000Z' },
      { unidadeId: 'maringa', codigoPrestador: '2', profissional: 'Dra. Lorena Visentainer', slotAt: '2026-08-21T15:00:00.000Z' },
      { unidadeId: 'maringa', codigoPrestador: '2', profissional: 'Dra. Lorena Visentainer', slotAt: '2026-08-21T12:00:00.000Z' },
    ])
    expect(dias.map((d) => d.dia)).toEqual(['2026-08-21', '2026-08-24'])
    expect(dias[0].horarios[0].slotAt).toBe('2026-08-21T12:00:00.000Z')
  })
})

describe('telefone', () => {
  it('formata celular e fixo', () => {
    expect(mascararTelefone('44991493656')).toBe('(44) 99149-3656')
    expect(mascararTelefone('4432255000')).toBe('(44) 3225-5000')
  })

  it('ignora o que passa de 11 dígitos', () => {
    expect(mascararTelefone('4499149365699')).toBe('(44) 99149-3656')
  })

  // O preenchimento automático do celular entrega o número com o país junto. Cortar
  // em 11 antes de tirar o 55 produzia (55) 44997-1683: um número inexistente que
  // passava na validação do navegador e só o servidor recusava.
  it('tira o 55 do país que o preenchimento automático traz', () => {
    expect(mascararTelefone('+5544997168329')).toBe('(44) 99716-8329')
    expect(mascararTelefone('+55 44 99716-8329')).toBe('(44) 99716-8329')
    expect(mascararTelefone('554432255000')).toBe('(44) 3225-5000')
    expect(telefoneValido('+5544997168329')).toBe(true)
  })

  // 55 é DDD de Santa Maria. Com 11 dígitos ou menos ele fica onde está, senão
  // quem mora lá perde o próprio DDD ao digitar.
  it('não confunde o DDD 55 com o código do país', () => {
    expect(mascararTelefone('55997168329')).toBe('(55) 99716-8329')
    expect(mascararTelefone('5532255000')).toBe('(55) 3225-5000')
    // Com o país na frente do DDD 55 são 13 dígitos, e aí o primeiro par é país.
    expect(mascararTelefone('5555997168329')).toBe('(55) 99716-8329')
  })

  it('recusa número curto', () => {
    expect(telefoneValido('(44) 9914')).toBe(false)
    expect(telefoneValido('(44) 99149-3656')).toBe(true)
  })
})
