import { describe, expect, it } from 'vitest'

import {
  type PreviaCirurgia,
  type RegraRepasse,
  acharRegra,
  calcularRepasse,
  descreverAnestesiaCirurgia,
  descreverMedicoCirurgia,
  descreverRegra,
} from './repasseRegras'

const regra = (over: Partial<RegraRepasse> = {}): RegraRepasse => ({
  id: 'r1',
  papel: 'medico',
  pessoa: 'Matheus Amaral',
  kind: 'cirurgia',
  modo: 'percentual',
  percentual: 30,
  fixoCents: null,
  ...over,
})

describe('acharRegra', () => {
  it('casa a pessoa sem diferença de caixa nem espaço, como o índice do banco', () => {
    expect(acharRegra([regra()], 'medico', 'cirurgia', '  matheus AMARAL ')?.id).toBe('r1')
  })

  it('regra de cirurgia não vale para protocolo, nem regra de médico para anestesia', () => {
    expect(acharRegra([regra()], 'medico', 'protocolo', 'Matheus Amaral')).toBeNull()
    expect(acharRegra([regra()], 'anestesia', 'cirurgia', 'Matheus Amaral')).toBeNull()
  })

  it('venda sem médico escolhido não pega regra nenhuma', () => {
    expect(acharRegra([regra({ pessoa: '' })], 'medico', 'cirurgia', null)).toBeNull()
  })
})

describe('calcularRepasse', () => {
  it('percentual sai do valor da venda', () => {
    expect(calcularRepasse(regra(), 2_950_000)).toBe(885_000)
  })

  it('fixo não depende do valor', () => {
    const anestesia = regra({ papel: 'anestesia', pessoa: 'Grupo Ingá', modo: 'fixo', percentual: null, fixoCents: 250_000 })
    expect(calcularRepasse(anestesia, 2_950_000)).toBe(250_000)
    expect(calcularRepasse(anestesia, 0)).toBe(250_000)
  })

  it('sem regra é zero, e meio centavo arredonda para cima como no Postgres', () => {
    expect(calcularRepasse(null, 2_950_000)).toBe(0)
    expect(calcularRepasse(regra({ percentual: 12.5 }), 1_001)).toBe(125)
  })
})

describe('descreverRegra', () => {
  it('fala em português o que a regra faz', () => {
    expect(descreverRegra(regra({ percentual: 27.5 }))).toBe('27,5% do valor')
    expect(descreverRegra(regra({ modo: 'fixo', fixoCents: 250_000 }))).toMatch(/2\.500,00 por venda$/)
  })
})

const previa = (over: Partial<PreviaCirurgia> = {}): PreviaCirurgia => ({
  temPolitica: true,
  medicoCents: 390_000,
  cirurgiaoCents: 390_000,
  indicacaoCents: 0,
  medicoPct: 13,
  medicoRegra: 'mesmo_medico',
  anestesiaCents: 250_000,
  anestesiaRegra: 'com raspagem, UF a informar',
  anestesiaPoliticaCents: 250_000,
  anestesiaEntradaCents: 0,
  uf: null,
  ufDaSala: false,
  ...over,
})

describe('descreverMedicoCirurgia', () => {
  it('mesmo médico: diz o percentual', () => {
    expect(descreverMedicoCirurgia(previa(), 'Lorena Visentainer', 'Lorena Visentainer')).toBe(
      '13% do valor: atendeu, vendeu e opera',
    )
  })

  it('outro cirurgião: separa o fixo de quem opera da indicação de quem atendeu', () => {
    const p = previa({ medicoRegra: 'outro_cirurgiao', medicoCents: 370_000, cirurgiaoCents: 320_000, indicacaoCents: 50_000 })
    // O Intl separa "R$" do número com espaço não separável.
    expect(descreverMedicoCirurgia(p, 'Lorena Visentainer', 'Matheus Amaral').replace(/\u00a0/g, ' ')).toBe(
      'R$ 3.200 para Matheus Amaral + R$ 500 de indicação para Lorena Visentainer',
    )
  })

  it('sem política ou sem cirurgião, diz o que falta', () => {
    expect(descreverMedicoCirurgia(previa({ temPolitica: false }), '', '')).toBe('sem política de repasse')
    expect(descreverMedicoCirurgia(previa({ medicoRegra: 'sem_cirurgiao' }), 'A', '')).toBe('escolha quem opera')
  })
})

describe('descreverAnestesiaCirurgia', () => {
  it('mostra a regra e avisa quando a UF veio da sala', () => {
    expect(descreverAnestesiaCirurgia(previa())).toBe('com raspagem, UF a informar')
    expect(descreverAnestesiaCirurgia(previa({ anestesiaRegra: 'com raspagem, 1.981 UF', ufDaSala: true }))).toBe(
      'com raspagem, 1.981 UF (UF da sala)',
    )
  })

  it('procedimento que não diz qual anestesia', () => {
    expect(descreverAnestesiaCirurgia(previa({ anestesiaCents: null, anestesiaRegra: null }))).toBe(
      'o procedimento não diz qual anestesia',
    )
  })

  // A entrada do transplante É o pagamento do anestesista: o campo zera e a linha explica
  // por quê. Sem a frase, o zero parece erro e alguém digita o valor cheio por cima.
  it('entrada que cobre a anestesia inteira zera o campo e diz de onde veio', () => {
    const p = previa({ anestesiaCents: 0, anestesiaEntradaCents: 250_000 })
    expect(descreverAnestesiaCirurgia(p).replace(/\u00a0/g, ' ')).toBe(
      'com raspagem, UF a informar: R$ 2.500 pagos na entrada do paciente',
    )
  })

  it('entrada menor que a anestesia abate só o que pagou', () => {
    const p = previa({ anestesiaCents: 30_000, anestesiaEntradaCents: 220_000 })
    expect(descreverAnestesiaCirurgia(p).replace(/\u00a0/g, ' ')).toBe(
      'com raspagem, UF a informar: R$ 2.500 menos R$ 2.200 da entrada',
    )
  })
})
