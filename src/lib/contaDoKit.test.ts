import { describe, expect, it } from 'vitest'

import { htmlContaDoKit, htmlFolhaDoKit, valorarLinhas } from './contaDoKit'

const linha = (id: string, itemId: string, qty: number, returnedQty = 0, cobrancaCents = 0, categoria: string | null = 'Material hospitalar') => ({
  id,
  itemId,
  nome: itemId.toUpperCase(),
  qty,
  returnedQty,
  avulso: false,
  controlado: false,
  categoria,
  consumoSetor: false,
  cobrancaCents,
})

describe('valorarLinhas', () => {
  it('valor pelo custo líquido da baixa: devolução não entra', () => {
    // Lençol: saíram 3 a R$ 4,50, voltou 1.
    const [l] = valorarLinhas(
      [linha('a', 'lencol', 3, 1)],
      [
        { itemId: 'lencol', qtyDelta: -3, custoCents: 450 },
        { itemId: 'lencol', qtyDelta: 1, custoCents: 450 },
      ],
      new Map(),
    )
    expect(l).toMatchObject({ usado: 2, unitarioCents: 450, totalCents: 900 })
  })

  it('mesmo produto em duas linhas divide pelo total usado', () => {
    const [modelo, avulso] = valorarLinhas(
      [linha('a', 'gaze', 4), linha('b', 'gaze', 1)],
      [{ itemId: 'gaze', qtyDelta: -5, custoCents: 200 }],
      new Map(),
    )
    expect(modelo.totalCents).toBe(800)
    expect(avulso.totalCents).toBe(200)
  })

  it('baixa sem custo usa o último custo de compra; sem nenhum, fica sem valor', () => {
    const [comUltimo, semNada] = valorarLinhas(
      [linha('a', 'ringer', 9), linha('b', 'campo', 2)],
      [
        { itemId: 'ringer', qtyDelta: -9, custoCents: null },
        { itemId: 'campo', qtyDelta: -2, custoCents: null },
      ],
      new Map([['ringer', 1350]]),
    )
    expect(comUltimo).toMatchObject({ unitarioCents: 1350, totalCents: 12150 })
    expect(semNada).toMatchObject({ unitarioCents: null, totalCents: null })
  })
})

describe('htmlContaDoKit', () => {
  it('mostra valor dos materiais e só abre coluna de cobrança quando existe', () => {
    const linhas = valorarLinhas([linha('a', 'lencol', 3, 1)], [{ itemId: 'lencol', qtyDelta: -2, custoCents: 450 }], new Map())
    const { html, titulo } = htmlContaDoKit({ paciente: 'Paciente <b>', procedimento: null, data: '2026-09-16', kitNome: 'Kit CC', status: 'consumido', linhas })
    expect(titulo).toBe('Conta - Paciente <b> - Kit CC - 16-09-2026')
    expect(html).toContain('R$&nbsp;9,00'.replace('&nbsp;', ' '))
    expect(html).not.toContain('<th class="n">Cobrança</th>')
    expect(html).toContain('Paciente &lt;b&gt;')
  })
})

describe('MAT/MED nos PDFs', () => {
  it('conta separa material de medicação, material primeiro', () => {
    const linhas = valorarLinhas(
      [linha('a', 'propofol', 2, 0, 0, 'Medicação'), linha('b', 'gaze', 3)],
      [
        { itemId: 'propofol', qtyDelta: -2, custoCents: 600 },
        { itemId: 'gaze', qtyDelta: -3, custoCents: 13 },
      ],
      new Map(),
    )
    const { html } = htmlContaDoKit({ paciente: 'X', procedimento: null, data: null, kitNome: 'Kit', status: 'consumido', linhas })
    expect(html.indexOf('>MAT<')).toBeGreaterThan(-1)
    expect(html.indexOf('>MAT<')).toBeLessThan(html.indexOf('>MED<'))
    expect(html.indexOf('GAZE')).toBeLessThan(html.indexOf('>MED<'))
    expect(html.indexOf('PROPOFOL')).toBeGreaterThan(html.indexOf('>MED<'))
  })

  it('folha para ticar tem uma caixinha por item e o consumo do setor em branco', () => {
    const { html, titulo } = htmlFolhaDoKit({
      paciente: 'Ricardo',
      procedimento: 'tc',
      data: '2026-09-17',
      kitNome: 'Kit CC',
      linhas: [
        { nome: 'RINGER 500ML', qty: 6, categoria: 'Medicação', controlado: false, avulso: false, consumoSetor: false },
        { nome: 'GAZE', qty: 20, categoria: 'Material hospitalar', controlado: false, avulso: false, consumoSetor: false },
      ],
      consumo: [{ rotulo: 'Luva nitrílica', unidade: 'par' }],
    })
    expect(titulo).toBe('Folha do kit - Ricardo - Kit CC - 17-09-2026')
    expect(html.match(/class="caixa"/g)).toHaveLength(3)
    expect(html).toContain('Luva nitrílica')
  })

  it('folha do modelo sai com paciente, procedimento e data em branco', () => {
    const { html, titulo } = htmlFolhaDoKit({
      paciente: null,
      procedimento: null,
      data: null,
      kitNome: 'Kit Cirúrgico CC',
      emBranco: true,
      linhas: [{ nome: 'GAZE', qty: 20, categoria: null, controlado: false, avulso: false, consumoSetor: false }],
      consumo: [],
    })
    expect(titulo).toBe('Folha do kit - Kit Cirúrgico CC')
    expect(html).toContain('info em-branco')
    expect(html).not.toContain('Não informado')
  })
})
