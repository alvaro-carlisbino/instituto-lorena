import { describe, expect, it } from 'vitest'

import { grauLegivel, lerTriagemLanding, tetoDaTriagem } from './triagemLanding'

describe('triagem da landing /consulta', () => {
  it('devolve null para lead que não veio da landing', () => {
    expect(lerTriagemLanding({ lead_form: {} })).toBeNull()
    expect(lerTriagemLanding(null)).toBeNull()
  })

  it('traduz as respostas para o texto que a atendente lê', () => {
    const t = lerTriagemLanding({
      origem_landing: 'consulta',
      triagem_objetivo: 'transplante_masculino',
      triagem_grau: '3v',
      triagem_urgencia: 'este_mes',
      triagem_unidade: 'maringa',
      triagem_cidade: 'Maringá',
      triagem_score: 75,
      estimativa_foliculos: 2013,
    })
    expect(t?.objetivo).toBe('Transplante capilar (masculino)')
    expect(t?.grau).toBe('Norwood III vertex')
    expect(t?.urgencia).toBe('Quer resolver ESTE MÊS')
    expect(t?.unidade).toBe('Maringá')
    expect(t?.estimativaFoliculos).toBe(2013)
  })

  it('pontua sobre o teto do que FOI perguntado, não sobre 100', () => {
    // Lucas Gonçalves, 29/ago/2026: 75 pontos na landing de 3 perguntas (teto 77).
    // Sobre 100 ele seria morno; sobre o próprio teto é quente, que é a verdade.
    const t = lerTriagemLanding({
      origem_landing: 'consulta',
      triagem_objetivo: 'transplante_masculino',
      triagem_grau: '4',
      triagem_urgencia: 'este_mes',
      triagem_unidade: 'maringa',
      triagem_score: 75,
    })
    expect(t?.teto).toBe(77)
    expect(t?.fracaoPct).toBe(97)
    expect(t?.temperatura).toBe('hot')
  })

  it('teto maior quando a landing ainda perguntava tempo e histórico', () => {
    // Rubens Januário, 13/ago/2026: mesmos 60 pontos valem morno na triagem de 5
    // perguntas (teto 93) e quente na de 3 (teto 77). O teto é o que separa os dois.
    const antigo = lerTriagemLanding({
      origem_landing: 'consulta',
      triagem_objetivo: 'transplante_masculino',
      triagem_grau: '3',
      triagem_tempo: 'mais_3_anos',
      triagem_ja_fez: 'nao',
      triagem_urgencia: 'ate_3_meses',
      triagem_unidade: 'maringa',
      triagem_score: 60,
    })
    expect(antigo?.teto).toBe(93)
    expect(antigo?.temperatura).toBe('warm')
  })

  it('mostra as respostas de lead antigo sem score', () => {
    const t = lerTriagemLanding({ origem_landing: 'consulta', triagem_urgencia: 'pesquisando' })
    expect(t?.score).toBeNull()
    expect(t?.fracaoPct).toBeNull()
    expect(t?.temperatura).toBeNull()
    expect(t?.urgencia).toBe('Só pesquisando')
  })

  it('teto soma só o que foi perguntado', () => {
    expect(tetoDaTriagem({ grau: '4', tempo: '', jaFez: '' })).toBe(77)
    expect(tetoDaTriagem({ grau: '', tempo: '', jaFez: '' })).toBe(62)
  })

  it('grau legível cobre Norwood e Ludwig', () => {
    expect(grauLegivel('2')).toBe('Norwood 2')
    expect(grauLegivel('ludwig_2')).toBe('Ludwig 2')
    expect(grauLegivel('')).toBe('')
  })
})

describe('teto gravado x teto recalculado', () => {
  it('prefere o teto que a edge function gravou', () => {
    // A régua da tela pode ter mudado depois que o lead respondeu. Quem manda é o que
    // foi gravado na hora, senão a nota de ontem passa a ser lida pela régua de hoje.
    const t = lerTriagemLanding({
      origem_landing: 'consulta',
      triagem_grau: '4',
      triagem_urgencia: 'este_mes',
      triagem_score: 60,
      triagem_teto: 93,
    })
    // 60 de 93 é morno; recalculado pela régua de hoje (teto 77) viraria quente.
    expect(t?.teto).toBe(93)
    expect(t?.temperatura).toBe('warm')
  })

  it('soma os 15 pontos de horário no teto quando o lead escolheu slot', () => {
    // Sem o carimbo, quem reservou horário aparecia com teto 15 pontos menor que o
    // real, ou seja, com a fração inflada — e subia na fila sem ter subido.
    expect(tetoDaTriagem({ grau: '4', tempo: '', jaFez: '' })).toBe(77)
    expect(tetoDaTriagem({ grau: '4', tempo: '', jaFez: '', temHorario: true })).toBe(92)

    const t = lerTriagemLanding({
      origem_landing: 'consulta',
      triagem_grau: '4',
      triagem_urgencia: 'este_mes',
      triagem_score: 75,
      triagem_tem_horario: true,
    })
    expect(t?.teto).toBe(92)
  })

  it('cai no cálculo local para o lead gravado antes do carimbo', () => {
    const t = lerTriagemLanding({
      origem_landing: 'consulta',
      triagem_grau: '3v',
      triagem_urgencia: 'este_mes',
      triagem_score: 75,
    })
    expect(t?.teto).toBe(77)
    expect(t?.temperatura).toBe('hot')
  })
})
