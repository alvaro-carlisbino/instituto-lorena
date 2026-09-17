import { describe, expect, it } from 'vitest'

import {
  FILTRO_KARDEX_VAZIO,
  type LinhaKardex,
  comprasDoItem,
  consumoDesde,
  filtrarKardex,
  lotesDoItem,
  mapearLinhaKardex,
  podeEstornar,
  rotuloOrigem,
  saldoAnterior,
  saldosPorSetor,
} from './kardex'

let seq = 0
const linha = (p: Partial<LinhaKardex> & Pick<LinhaKardex, 'qtd' | 'criadoEm'>): LinhaKardex => ({
  id: `m${++seq}`,
  seq,
  itemId: 'luva',
  itemNome: 'LUVA PROCEDIMENTO M',
  tipo: p.qtd >= 0 ? 'entrada' : 'saida',
  saldo: 0,
  saldoSetor: 0,
  setorId: 'principal',
  setorNome: 'Principal',
  loteId: null,
  lote: null,
  validade: null,
  custoUnitCents: null,
  motivo: null,
  observacao: null,
  refType: null,
  refId: null,
  autor: null,
  origem: { tipo: 'manual' },
  loteOrigem: null,
  estornadoPor: null,
  ...p,
})

const nota = (id: string, numero: string) => ({
  tipo: 'nota' as const,
  id,
  numero,
  emissao: '2026-09-09',
  chave: null,
  fornecedor: 'C.B.S. MEDICO',
  totalCents: null,
})

describe('mapearLinhaKardex', () => {
  it('lê nota, lote de origem e estorno como vêm do banco', () => {
    const l = mapearLinhaKardex({
      id: 'x',
      seq: 10,
      created_at: '2026-09-14T18:00:00Z',
      item_id: 'i',
      item_nome: 'CAMPO OPERATORIO EST 25X28CM',
      kind: 'entrada',
      qty_delta: '1000',
      saldo: '1236.0',
      saldo_setor: '1236.0',
      setor_id: 's',
      setor_nome: 'Principal',
      lote_id: 'b',
      lote: 'E23-2',
      validade: '2027-01-01',
      custo_unit_cents: 89,
      ref_type: 'purchase_invoice',
      ref_id: 'n1',
      origem: { tipo: 'nota', id: 'n1', numero: '1782132', fornecedor: 'C.B.S.', total_cents: 187526 },
      lote_origem: { nota_id: 'n1', numero: '1782132', fornecedor: 'C.B.S.' },
      estornado_por: null,
    })
    expect(l.qtd).toBe(1000)
    expect(l.saldo).toBe(1236)
    expect(l.origem).toMatchObject({ tipo: 'nota', numero: '1782132', totalCents: 187526 })
    expect(l.loteOrigem).toMatchObject({ notaId: 'n1', numero: '1782132' })
    expect(rotuloOrigem(l.origem).titulo).toBe('NF 1782132')
  })

  it('sem origem e sem ref_type é lançamento manual; bipagem continua bipagem', () => {
    expect(mapearLinhaKardex({ id: 'a', item_id: 'i', kind: 'saida', qty_delta: -1 }).origem).toEqual({ tipo: 'manual' })
    expect(mapearLinhaKardex({ id: 'b', item_id: 'i', kind: 'saida', qty_delta: -1, ref_type: 'bipagem' }).origem).toEqual({
      tipo: 'bipagem',
    })
  })
})

describe('comprasDoItem', () => {
  it('agrupa por nota, soma lotes e guarda o nome com que o produto entrou', () => {
    const linhas = [
      linha({ qtd: -2, criadoEm: '2026-09-15T10:00:00Z', origem: { tipo: 'kit', id: 'k', nome: 'Kit', paciente: 'Ana', leadId: null, status: null, data: null } }),
      linha({ qtd: 50, criadoEm: '2026-09-14T18:00:00Z', origem: nota('n2', '999'), lote: 'L2', custoUnitCents: 100, itemNome: 'LUVA PROC LATEX M CX100' }),
      linha({ qtd: 50, criadoEm: '2026-09-14T18:00:00Z', origem: nota('n2', '999'), lote: 'L3', custoUnitCents: 120, itemNome: 'LUVA PROC LATEX M CX100' }),
      linha({ qtd: 10, criadoEm: '2026-08-01T12:00:00Z', origem: nota('n1', '888'), custoUnitCents: 90 }),
    ]
    const compras = comprasDoItem(linhas)
    expect(compras.map((c) => c.chave)).toEqual(['n2', 'n1'])
    expect(compras[0]).toMatchObject({ qtd: 100, totalCents: 11000, custoMedioCents: 110 })
    expect(compras[0].lotes.map((l) => l.lote)).toEqual(['L2', 'L3'])
    expect(compras[0].nomes).toEqual(['LUVA PROC LATEX M CX100'])
  })
})

describe('lotesDoItem', () => {
  it('diz de qual nota veio o lote e para quais pacientes saiu, líquido de devolução', () => {
    const kitAna = { tipo: 'kit' as const, id: 'k1', nome: 'Kit CC', paciente: 'Ana', leadId: null, status: 'consumido', data: '2026-09-15' }
    const origemLote = { notaId: 'n1', numero: '888', emissao: '2026-09-01', fornecedor: 'Rioclarense' }
    const base = { loteId: 'b1', lote: 'E23', validade: '2027-03-01', loteOrigem: origemLote }
    const linhas = [
      linha({ ...base, qtd: 1, criadoEm: '2026-09-15T20:00:00Z', origem: kitAna }),
      linha({ ...base, qtd: -3, criadoEm: '2026-09-15T10:00:00Z', origem: kitAna }),
      linha({ ...base, qtd: 10, criadoEm: '2026-09-02T10:00:00Z', origem: nota('n1', '888') }),
      linha({ loteId: 'b0', lote: 'VELHO', validade: '2026-08-01', qtd: 5, criadoEm: '2026-07-01T10:00:00Z' }),
    ]
    const lotes = lotesDoItem(linhas, '2026-09-17')
    expect(lotes.map((l) => l.lote)).toEqual(['VELHO', 'E23'])
    const e23 = lotes[1]
    expect(e23.saldo).toBe(8)
    expect(e23.nota?.numero).toBe('888')
    expect(e23.pacientes).toEqual([{ kitId: 'k1', kitNome: 'Kit CC', paciente: 'Ana', data: '2026-09-15', qtd: 2 }])
    expect(lotes[0].vencido).toBe(true)
  })
})

describe('saldos e filtros', () => {
  const transf = { tipo: 'transferencia' as const, id: 't', de: 'Principal', para: 'Centro Cirúrgico', cancelada: false }
  const linhas = [
    linha({ qtd: 4, criadoEm: '2026-09-16T12:00:00Z', setorId: 'cc', setorNome: 'Centro Cirúrgico', origem: transf, saldo: 20, saldoSetor: 4 }),
    linha({ qtd: -4, criadoEm: '2026-09-16T12:00:00Z', origem: transf, saldo: 16, saldoSetor: 16 }),
    linha({ qtd: -3, criadoEm: '2026-09-10T12:00:00Z', saldo: 20, saldoSetor: 20, autor: 'Édina' }),
    linha({ qtd: 23, criadoEm: '2026-09-01T12:00:00Z', origem: nota('n1', '777'), saldo: 23, saldoSetor: 23 }),
  ]

  it('saldo por setor soma o livro de cada setor', () => {
    expect(saldosPorSetor(linhas)).toEqual([
      { setorId: 'principal', setorNome: 'Principal', qtd: 16 },
      { setorId: 'cc', setorNome: 'Centro Cirúrgico', qtd: 4 },
    ])
  })

  it('saldo anterior é o da última linha antes do período, no escopo do setor', () => {
    expect(saldoAnterior(linhas, '2026-09-11', null)).toBe(20)
    expect(saldoAnterior(linhas, '2026-09-11', 'cc')).toBe(0)
    expect(saldoAnterior(linhas, null, null)).toBeNull()
  })

  it('filtra por setor, grupo e busca sem acento', () => {
    expect(filtrarKardex(linhas, { ...FILTRO_KARDEX_VAZIO, setorId: 'cc' })).toHaveLength(1)
    expect(filtrarKardex(linhas, { ...FILTRO_KARDEX_VAZIO, grupo: 'transferencia' })).toHaveLength(2)
    expect(filtrarKardex(linhas, { ...FILTRO_KARDEX_VAZIO, grupo: 'compra' })).toHaveLength(1)
    expect(filtrarKardex(linhas, { ...FILTRO_KARDEX_VAZIO, busca: 'edina' })).toHaveLength(1)
    expect(filtrarKardex(linhas, { ...FILTRO_KARDEX_VAZIO, busca: '777' })).toHaveLength(1)
    expect(filtrarKardex(linhas, { ...FILTRO_KARDEX_VAZIO, de: '2026-09-10', ate: '2026-09-10' })).toHaveLength(1)
  })

  it('consumo ignora transferência, compra e lançamento estornado', () => {
    const comEstorno = [...linhas, linha({ qtd: -5, criadoEm: '2026-09-12T12:00:00Z', estornadoPor: 'e1' })]
    expect(consumoDesde(comEstorno, '2026-09-01')).toBe(3)
  })

  it('só lançamento avulso ainda não estornado pode ser estornado', () => {
    expect(podeEstornar(linhas[2])).toBe(true)
    expect(podeEstornar(linhas[0])).toBe(false)
    expect(podeEstornar({ ...linhas[2], estornadoPor: 'x' })).toBe(false)
  })
})
