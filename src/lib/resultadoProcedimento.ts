// A conta de uma cirurgia/protocolo: quanto entrou, quanto custou, quanto sobrou.
// Fora do React para ser testada: é esse número que vai para a conversa com o médico.

export type LinhaResultado = {
  receitaCents: number
  cobradoKitsCents: number
  materiaisKitsCents: number
  materiaisManualCents: number
  custoMedicoCents: number
  impostoCents: number
  outrosCents: number
  kits: number
}

export type ContaResultado = {
  receitaTotal: number
  /** Material que conta: o dos kits quando há kit; sem kit, o que foi digitado na venda. */
  materiais: number
  materiaisOrigem: 'kits' | 'manual' | 'nenhum'
  custoTotal: number
  lucro: number
  /** Lucro sobre a receita, 0..1. null sem receita (kit sem venda). */
  margem: number | null
}

export function contaDoProcedimento(l: LinhaResultado): ContaResultado {
  const materiaisOrigem = l.kits > 0 ? 'kits' : l.materiaisManualCents > 0 ? 'manual' : 'nenhum'
  const materiais = l.kits > 0 ? l.materiaisKitsCents : l.materiaisManualCents
  const receitaTotal = l.receitaCents + l.cobradoKitsCents
  const custoTotal = materiais + l.custoMedicoCents + l.impostoCents + l.outrosCents
  const lucro = receitaTotal - custoTotal
  return {
    receitaTotal,
    materiais,
    materiaisOrigem,
    custoTotal,
    lucro,
    margem: receitaTotal > 0 ? lucro / receitaTotal : null,
  }
}

export function somarContas(linhas: LinhaResultado[]) {
  return linhas.reduce(
    (acc, l) => {
      const c = contaDoProcedimento(l)
      acc.receita += c.receitaTotal
      acc.materiais += c.materiais
      acc.medico += l.custoMedicoCents
      acc.imposto += l.impostoCents
      acc.outros += l.outrosCents
      acc.custo += c.custoTotal
      acc.lucro += c.lucro
      return acc
    },
    { receita: 0, materiais: 0, medico: 0, imposto: 0, outros: 0, custo: 0, lucro: 0 },
  )
}
