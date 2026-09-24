// Descrições reais do extrato do Itaú Empresas da clínica.
import { describe, expect, it } from 'vitest'

import {
  acumulado,
  classificar,
  diasDoPeriodo,
  formaDaEntrada,
  grupoDaSaida,
  periodoDeComparacao,
  semanasDoPeriodo,
  serie,
  totais,
  totaisPorCentro,
  totaisPorClasse,
  variacao,
  type Movimento,
} from '@/lib/resumoBanco'
import type { CostCenter } from '@/services/financeiro'

const centro = (name: string, grupo: string): CostCenter => ({
  id: name,
  name,
  active: true,
  sortOrder: 0,
  description: null,
  grupo,
  categoryId: null,
})

const CENTROS = [
  centro('Salários e encargos', 'Pessoas'),
  centro('Centro Cirúrgico', 'Operação'),
  centro('Marketing', 'Comercial'),
  centro('Transferência entre contas', 'Não é gasto'),
  centro('Coisa nova', 'Grupo que ninguém previu'),
]

const mov = (id: string, data: string, direcao: 'in' | 'out', cents: number, descricao: string, extra: Partial<Movimento> = {}): Movimento => ({
  id,
  data,
  direcao,
  amountCents: cents,
  descricao,
  nome: descricao,
  centro: null,
  detalhe: null,
  categoria: null,
  ...extra,
})

describe('formaDaEntrada', () => {
  it('lê o trilho que o banco escreve na frente', () => {
    expect(formaDaEntrada('REDE  VISA AT0085868531', null).classe).toBe('Maquininha de cartão')
    expect(formaDaEntrada('REDE  MAST DB0085868531', null).classe).toBe('Maquininha de cartão')
    expect(formaDaEntrada('PIX TRANSF ILSA JO15/09', null).classe).toBe('PIX')
    expect(formaDaEntrada('PIX QRS 58.989.446 28/08', null).classe).toBe('PIX')
    expect(formaDaEntrada('TED 001.0218.JOSE A C', null).classe).toBe('TED e DOC')
    expect(formaDaEntrada('DEP CHEQUE ATM N. 018591', null).classe).toBe('Outras entradas')
  })

  it('resgate de aplicação e categoria "não é receita" ficam fora do total', () => {
    expect(formaDaEntrada('RES APLIC AUT MAIS', null)).toEqual({ classe: 'Só mudou de conta', foraDoTotal: true })
    expect(formaDaEntrada('TED 208.0001.LOVIDERM C', 'Transferência entre contas próprias (não é receita)').foraDoTotal).toBe(true)
  })
})

describe('grupoDaSaida', () => {
  it('boleto da fatura vira a classe do cartão', () => {
    expect(grupoDaSaida({ descricao: 'BUSINESS      4004-2658', centro: null, categoria: null }, CENTROS)).toEqual({
      classe: 'Cartão de crédito',
      foraDoTotal: false,
      fatura: true,
    })
  })

  it('centro de custo leva ao grupo; sem centro e grupo desconhecido têm nome próprio', () => {
    expect(grupoDaSaida({ descricao: 'PIX', centro: 'Marketing', categoria: null }, CENTROS).classe).toBe('Comercial')
    expect(grupoDaSaida({ descricao: 'PIX', centro: null, categoria: null }, CENTROS).classe).toBe('Sem centro de custo')
    expect(grupoDaSaida({ descricao: 'PIX', centro: 'Coisa nova', categoria: null }, CENTROS).classe).toBe('Outros')
  })

  it('transferência entre contas sai do total', () => {
    expect(grupoDaSaida({ descricao: 'PIX', centro: 'Transferência entre contas', categoria: null }, CENTROS).foraDoTotal).toBe(true)
  })
})

describe('semanasDoPeriodo', () => {
  it('setembro/2026 começa numa terça: a Semana 1 vai de 01 a 06', () => {
    const s = semanasDoPeriodo('2026-09-01', '2026-09-30')
    expect(s.map((x) => [x.de, x.ate])).toEqual([
      ['2026-09-01', '2026-09-06'],
      ['2026-09-07', '2026-09-13'],
      ['2026-09-14', '2026-09-20'],
      ['2026-09-21', '2026-09-27'],
      ['2026-09-28', '2026-09-30'],
    ])
    expect(s[0].rotuloLongo).toBe('Semana 1 · 01/09 a 06/09')
  })

  it('mês que começa na segunda tem a primeira semana inteira', () => {
    expect(semanasDoPeriodo('2026-06-01', '2026-06-10').map((x) => [x.de, x.ate])).toEqual([
      ['2026-06-01', '2026-06-07'],
      ['2026-06-08', '2026-06-10'],
    ])
  })

  it('mês que começa no domingo tem Semana 1 de um dia só', () => {
    const s = semanasDoPeriodo('2026-11-01', '2026-11-03')
    expect(s[0]).toMatchObject({ de: '2026-11-01', ate: '2026-11-01', rotuloLongo: 'Semana 1 · 01/11' })
  })
})

describe('séries e totais', () => {
  const movs = classificar(
    [
      mov('e1', '2026-09-01', 'in', 1000, 'PIX TRANSF MARIA'),
      mov('e2', '2026-09-02', 'in', 500, 'REDE  VISA AT0085868531'),
      mov('r', '2026-09-02', 'in', 9999, 'RES APLIC AUT MAIS'),
      mov('s1', '2026-09-01', 'out', 300, 'PIX ENVIADO FULANO', { centro: 'Salários e encargos' }),
      mov('s2', '2026-09-08', 'out', 200, 'BUSINESS      4004-2658'),
      mov('s3', '2026-09-08', 'out', 50, 'SISPAG PIX QR-CODE'),
      mov('t', '2026-09-08', 'out', 7777, 'PIX ENVIADO LORENA', { centro: 'Transferência entre contas' }),
    ],
    CENTROS,
  )

  it('totais deixam de fora o que só mudou de conta, mas contam quanto foi', () => {
    expect(totais(movs)).toEqual({ entrou: 1500, saiu: 550, entrouFora: 9999, saiuFora: 7777, semCentro: 50, semCentroN: 1 })
  })

  it('classes na ordem fixa, que é a das cores', () => {
    expect(totaisPorClasse(movs, 'out').map((t) => t.classe)).toEqual(['Pessoas', 'Cartão de crédito', 'Sem centro de custo'])
    expect(totaisPorClasse(movs, 'in').map((t) => t.classe)).toEqual(['PIX', 'Maquininha de cartão'])
  })

  it('centro de custo com o cartão numa linha só', () => {
    expect(totaisPorCentro(movs).map((t) => [t.centro, t.cents])).toEqual([
      ['Salários e encargos', 300],
      ['Cartão de crédito', 200],
      ['Sem centro de custo', 50],
    ])
  })

  it('série por dia inclui dia vazio, e o acumulado soma', () => {
    const pontos = serie(movs, diasDoPeriodo('2026-09-01', '2026-09-03'))
    expect(pontos.map((p) => [p.chave, p.entrou, p.saiu])).toEqual([
      ['2026-09-01', 1000, 300],
      ['2026-09-02', 500, 0],
      ['2026-09-03', 0, 0],
    ])
    expect(acumulado(pontos).map((p) => p.sobra)).toEqual([700, 1200, 1200])
  })

  it('série por semana junta os dias da semana', () => {
    const pontos = serie(movs, semanasDoPeriodo('2026-09-01', '2026-09-13'))
    expect(pontos.map((p) => p.saiu)).toEqual([300, 250])
    expect(pontos[1].saidaPorClasse).toEqual({ 'Cartão de crédito': 200, 'Sem centro de custo': 50 })
  })
})

describe('periodoDeComparacao', () => {
  it('pedaço do mês compara com os mesmos dias do mês anterior', () => {
    const c = periodoDeComparacao({ de: '2026-09-01', ate: '2026-09-24', rotulo: 'Setembro/2026', id: 'mes:2026-09' })
    expect([c.de, c.ate, c.rotuloCurto]).toEqual(['2026-08-01', '2026-08-24', '1 a 24 de agosto'])
  })

  it('mês fechado compara com o mês anterior inteiro, mesmo mais curto', () => {
    const c = periodoDeComparacao({ de: '2026-03-01', ate: '2026-03-31', rotulo: 'Março/2026', id: 'mes:2026-03' })
    expect([c.de, c.ate, c.rotuloCurto]).toEqual(['2026-02-01', '2026-02-28', 'fevereiro'])
  })

  it('janeiro volta para dezembro do ano anterior', () => {
    const c = periodoDeComparacao({ de: '2027-01-01', ate: '2027-01-31', rotulo: 'Janeiro/2027', id: 'mes:2027-01' })
    expect([c.de, c.ate]).toEqual(['2026-12-01', '2026-12-31'])
  })
})

describe('variacao', () => {
  it('sem base não inventa percentual', () => {
    expect(variacao(100, 0)).toBeNull()
    expect(variacao(150, 100)).toBe(50)
  })
})
