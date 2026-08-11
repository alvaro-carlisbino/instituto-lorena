import { describe, expect, it } from 'vitest'

import {
  FAIXAS,
  RUIDO,
  baseRegiao,
  classificar,
  ehAreaDoadora,
  faixasDoHistograma,
  foraDoCouro,
  nomePacienteLegivel,
  ordemRegiao,
  periodoLegivel,
  pontoNoCouro,
} from './tricoscopia'

describe('classificar contra o ruído da medida', () => {
  it('chama de estável o que não passa do piso, mesmo parecendo bom', () => {
    // 12% de densidade parece vitória e é ruído: a área doadora, que não rala,
    // varia 13,8% entre exames.
    expect(classificar(12, RUIDO.densidadePct)).toBe('estavel')
    expect(classificar(-12, RUIDO.densidadePct)).toBe('estavel')
  })

  it('reconhece ganho e perda acima do piso', () => {
    expect(classificar(20, RUIDO.densidadePct)).toBe('ganho')
    expect(classificar(-20, RUIDO.densidadePct)).toBe('perda')
  })

  it('inverte a leitura da miniaturização: cair é melhorar', () => {
    expect(classificar(-5, RUIDO.finosPp, true)).toBe('ganho')
    expect(classificar(5, RUIDO.finosPp, true)).toBe('perda')
    expect(classificar(-2, RUIDO.finosPp, true)).toBe('estavel')
  })

  it('sem número não inventa veredito', () => {
    expect(classificar(null, RUIDO.espessuraPct)).toBe('indefinido')
    expect(classificar(undefined, RUIDO.espessuraPct)).toBe('indefinido')
    expect(classificar(NaN, RUIDO.espessuraPct)).toBe('indefinido')
  })
})

describe('nomePacienteLegivel', () => {
  it('desinverte o "SOBRENOME, NOME" do Mirror', () => {
    expect(nomePacienteLegivel('MARCOS LOQUETTI, JOSÉ')).toBe('José Marcos Loquetti')
    expect(nomePacienteLegivel('Wichoski, Marcio')).toBe('Marcio Wichoski')
  })

  it('aguenta pasta sem vírgula', () => {
    expect(nomePacienteLegivel('ANGELA')).toBe('Angela')
  })
})

describe('baseRegiao', () => {
  it('junta a recaptura do mesmo ponto: sem isso a série se parte em duas', () => {
    expect(baseRegiao('Occiput 3 left_1')).toBe('Occiput 3 left')
    expect(baseRegiao('Vertex center_1')).toBe('Vertex center')
    expect(baseRegiao('Mid_2')).toBe('Mid')
  })

  it('não mexe em nome sem sufixo', () => {
    expect(baseRegiao('Temporal 1 right')).toBe('Temporal 1 right')
  })
})

describe('ehAreaDoadora', () => {
  it('pega o worklist padrão', () => {
    expect(ehAreaDoadora('Occiput 3 left')).toBe(true)
    expect(ehAreaDoadora('OCCIPITAL BAIXO')).toBe(true)
  })

  it('pega também o que a equipe digita à mão, que o regex antigo perdia', () => {
    expect(ehAreaDoadora('area doadora')).toBe(true)
    expect(ehAreaDoadora('DOADORA')).toBe(true)
    expect(ehAreaDoadora('Occiptal')).toBe(true)
  })

  it('não confunde região tratada com controle', () => {
    expect(ehAreaDoadora('Vertex center')).toBe(false)
    expect(ehAreaDoadora('Frontal 1')).toBe(false)
    expect(ehAreaDoadora(null)).toBe(false)
  })
})

describe('foraDoCouro', () => {
  it('barba e sobrancelha não entram no mapa da cabeça', () => {
    expect(foraDoCouro('BARBA DIREITA')).toBe(true)
    expect(foraDoCouro('sobrancelha direita')).toBe(true)
    expect(foraDoCouro('Vertex center')).toBe(false)
  })
})

describe('ordemRegiao', () => {
  it('lê da frente para a nuca, e não por volume de exame', () => {
    const nomes = ['Occiput 3 left', 'Vertex center', 'Frontal 1', 'Temporal 1 left', 'Mid']
    const ordenado = nomes.slice().sort((a, b) => ordemRegiao(a) - ordemRegiao(b))
    expect(ordenado).toEqual([
      'Frontal 1',
      'Temporal 1 left',
      'Mid',
      'Vertex center',
      'Occiput 3 left',
    ])
  })

  it('joga barba e sobrancelha para o fim', () => {
    expect(ordemRegiao('BARBA DIREITA')).toBeGreaterThan(ordemRegiao('Occiput 3 left'))
  })
})

describe('pontoNoCouro', () => {
  it('coloca a esquerda do paciente na esquerda da tela', () => {
    const esq = pontoNoCouro('Temporal 1 left')!
    const dir = pontoNoCouro('Temporal 1 right')!
    expect(esq.x).toBeLessThan(dir.x)
  })

  it('põe a frente em cima e a nuca embaixo', () => {
    expect(pontoNoCouro('Frontal 1')!.y).toBeLessThan(pontoNoCouro('Mid')!.y)
    expect(pontoNoCouro('Mid')!.y).toBeLessThan(pontoNoCouro('Vertex center')!.y)
    expect(pontoNoCouro('Vertex center')!.y).toBeLessThan(pontoNoCouro('Occiput 3 left')!.y)
  })

  it('trata a recaptura como o mesmo ponto', () => {
    expect(pontoNoCouro('Occiput 3 left_1')).toEqual(pontoNoCouro('Occiput 3 left'))
  })

  it('recusa posição para o que não é couro cabeludo', () => {
    expect(pontoNoCouro('BARBA ESQUERDA')).toBeNull()
    expect(pontoNoCouro('SOBRANCELHA D')).toBeNull()
  })

  it('devolve null em vez de inventar lugar para nome desconhecido', () => {
    expect(pontoNoCouro('lateral risca')).toBeNull()
    expect(pontoNoCouro(null)).toBeNull()
  })

  it('cobre as seis regiões do worklist padrão da clínica', () => {
    for (const r of [
      'Temporal 1 right',
      'Frontal 1',
      'Temporal 1 left',
      'Mid',
      'Vertex center',
      'Occiput 3 left',
    ]) {
      expect(pontoNoCouro(r), r).not.toBeNull()
    }
  })
})

describe('faixasDoHistograma', () => {
  it('funde as duas faixas mais finas no corte clínico de 40 µm', () => {
    const f = faixasDoHistograma({ ate20: 3, '20a40': 21, '40a60': 31, '60a80': 11, '80a100': 9, acima100: 4 })!
    expect(f.ate40).toBe(24)
    expect(f.f40a60).toBe(31)
    expect(f.acima100).toBe(4)
  })

  it('soma bate com o total dos fios medidos', () => {
    const bruto = { ate20: 0, '20a40': 9, '40a60': 41, '60a80': 64, '80a100': 45, acima100: 7 }
    const f = faixasDoHistograma(bruto)!
    const soma = Object.values(f).reduce((a, b) => a + b, 0)
    expect(soma).toBe(166)
  })

  it('devolve null quando não há histograma ou está zerado', () => {
    expect(faixasDoHistograma(null)).toBeNull()
    expect(faixasDoHistograma({})).toBeNull()
    expect(faixasDoHistograma({ ate20: 0, '20a40': 0 })).toBeNull()
  })

  it('ignora chave estranha em vez de quebrar a barra', () => {
    const f = faixasDoHistograma({ '40a60': 10, lixo: 'x' })!
    expect(f.f40a60).toBe(10)
    expect(f.ate40).toBe(0)
  })

  it('tem uma cor por faixa e nada sobrando', () => {
    const f = faixasDoHistograma({ '40a60': 1 })!
    expect(FAIXAS.map((x) => x.id).sort()).toEqual(Object.keys(f).sort())
  })
})

describe('periodoLegivel', () => {
  it('fala como o médico fala na consulta', () => {
    expect(periodoLegivel(0)).toBe('exame inicial')
    expect(periodoLegivel(30)).toBe('30 dias')
    expect(periodoLegivel(1)).toBe('1 dia')
    expect(periodoLegivel(180)).toBe('6 meses')
    expect(periodoLegivel(365)).toBe('12 meses')
    expect(periodoLegivel(730)).toBe('2 anos')
    expect(periodoLegivel(1043)).toBe('2 anos e 10 meses')
  })

  it('não inventa período sem data', () => {
    expect(periodoLegivel(null)).toBe('exame inicial')
  })
})
