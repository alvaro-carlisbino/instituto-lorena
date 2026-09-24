/**
 * Kardex do item: o livro de movimentos lido como gente lê.
 *
 * A função do banco (`stock_kardex`) devolve cada lançamento com a origem já resolvida (nota,
 * kit, inventário, transferência) e o saldo corrido. Daqui saem as visões da ficha do item:
 * de quais notas ele veio, em que lotes está, em que setor, e para quais pacientes saiu cada
 * lote. Tudo derivado das mesmas linhas, para as abas nunca discordarem entre si.
 */

import { diaLocal } from '@/lib/diaLocal'
import { normalizarBusca } from '@/lib/busca'

export type OrigemMovimento =
  | {
      tipo: 'nota'
      id: string | null
      numero: string | null
      emissao: string | null
      chave: string | null
      fornecedor: string | null
      totalCents: number | null
    }
  | { tipo: 'ordem'; id: string; responsavel: string | null }
  | {
      tipo: 'kit'
      id: string
      nome: string
      paciente: string | null
      leadId: string | null
      status: string | null
      data: string | null
    }
  | { tipo: 'inventario'; id: string; nome: string }
  | { tipo: 'transferencia'; id: string; de: string; para: string; cancelada: boolean }
  /** Baixa do que o setor usou numa transferência (ou a correção dela), no dia do uso. */
  | { tipo: 'uso'; id: string; de: string; setor: string; dia: string | null; cancelada: boolean }
  /** Item de nota juntado no item que a equipe usa (saldo passou de um para o outro). */
  | { tipo: 'juncao'; id: string; origem: string; destino: string; desfeita: boolean }
  | { tipo: 'estorno'; movimentoId: string }
  | { tipo: 'bipagem' }
  | { tipo: 'manual' }
  | { tipo: 'importacao'; refType: string }

export type NotaDoLote = {
  notaId: string
  numero: string | null
  emissao: string | null
  fornecedor: string | null
}

export type TipoMovimento = 'entrada' | 'saida' | 'ajuste'

export type LinhaKardex = {
  id: string
  /** Número do lançamento: desempata o que a mesma operação gravou no mesmo instante. */
  seq: number
  criadoEm: string
  itemId: string
  /** Nome do item em que o movimento foi gravado (item de nota consolidado mantém o dele). */
  itemNome: string
  tipo: TipoMovimento
  qtd: number
  saldo: number
  saldoSetor: number
  setorId: string | null
  setorNome: string | null
  loteId: string | null
  lote: string | null
  validade: string | null
  custoUnitCents: number | null
  motivo: string | null
  observacao: string | null
  refType: string | null
  refId: string | null
  autor: string | null
  origem: OrigemMovimento
  /** Nota que trouxe o lote deste movimento (vale também para saída e transferência). */
  loteOrigem: NotaDoLote | null
  /** Id do estorno, quando este lançamento já foi estornado. */
  estornadoPor: string | null
}

const texto = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const numero = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

function mapearOrigem(bruta: unknown, refType: string | null, refId: string | null): OrigemMovimento {
  const o = (bruta ?? null) as Record<string, unknown> | null
  const tipo = o ? String(o.tipo ?? '') : ''
  if (tipo === 'nota') {
    return {
      tipo: 'nota',
      id: texto(o?.id),
      numero: texto(o?.numero),
      emissao: texto(o?.emissao),
      chave: texto(o?.chave),
      fornecedor: texto(o?.fornecedor),
      totalCents: numero(o?.total_cents),
    }
  }
  if (tipo === 'ordem') return { tipo: 'ordem', id: String(o?.id ?? ''), responsavel: texto(o?.responsavel) }
  if (tipo === 'kit') {
    return {
      tipo: 'kit',
      id: String(o?.id ?? ''),
      nome: String(o?.nome ?? 'Kit'),
      paciente: texto(o?.paciente),
      leadId: texto(o?.lead_id),
      status: texto(o?.status),
      data: texto(o?.data),
    }
  }
  if (tipo === 'inventario') return { tipo: 'inventario', id: String(o?.id ?? ''), nome: String(o?.nome ?? 'Inventário') }
  if (tipo === 'transferencia') {
    return {
      tipo: 'transferencia',
      id: String(o?.id ?? ''),
      de: String(o?.de ?? '?'),
      para: String(o?.para ?? '?'),
      cancelada: Boolean(o?.cancelada),
    }
  }
  if (tipo === 'uso') {
    return {
      tipo: 'uso',
      id: String(o?.id ?? ''),
      de: String(o?.de ?? '?'),
      setor: String(o?.setor ?? '?'),
      dia: texto(o?.dia),
      cancelada: Boolean(o?.cancelada),
    }
  }
  if (tipo === 'juncao') {
    return {
      tipo: 'juncao',
      id: String(o?.id ?? ''),
      origem: String(o?.origem ?? '?'),
      destino: String(o?.destino ?? '?'),
      desfeita: Boolean(o?.desfeita),
    }
  }
  if (tipo === 'estorno') return { tipo: 'estorno', movimentoId: String(o?.id ?? refId ?? '') }
  if (tipo === 'bipagem' || refType === 'bipagem') return { tipo: 'bipagem' }
  if (refType) return { tipo: 'importacao', refType }
  return { tipo: 'manual' }
}

export function mapearLinhaKardex(r: Record<string, unknown>): LinhaKardex {
  const refType = texto(r.ref_type)
  const refId = texto(r.ref_id)
  const lo = (r.lote_origem ?? null) as Record<string, unknown> | null
  const kind = String(r.kind ?? '')
  return {
    id: String(r.id),
    seq: Number(r.seq ?? 0),
    criadoEm: String(r.created_at ?? ''),
    itemId: String(r.item_id),
    itemNome: String(r.item_nome ?? ''),
    tipo: kind === 'saida' || kind === 'ajuste' ? kind : 'entrada',
    qtd: Number(r.qty_delta ?? 0),
    saldo: Number(r.saldo ?? 0),
    saldoSetor: Number(r.saldo_setor ?? 0),
    setorId: texto(r.setor_id),
    setorNome: texto(r.setor_nome),
    loteId: texto(r.lote_id),
    lote: texto(r.lote),
    validade: texto(r.validade),
    custoUnitCents: numero(r.custo_unit_cents),
    motivo: texto(r.motivo),
    observacao: texto(r.observacao),
    refType,
    refId,
    autor: texto(r.autor),
    origem: mapearOrigem(r.origem, refType, refId),
    loteOrigem:
      lo && lo.nota_id
        ? {
            notaId: String(lo.nota_id),
            numero: texto(lo.numero),
            emissao: texto(lo.emissao),
            fornecedor: texto(lo.fornecedor),
          }
        : null,
    estornadoPor: texto(r.estornado_por),
  }
}

const dataCurta = (dia: string | null) => (dia ? dia.slice(0, 10).split('-').reverse().join('/') : null)

/** Título e detalhe da origem, do jeito que aparece na linha do kardex. */
export function rotuloOrigem(o: OrigemMovimento): { titulo: string; detalhe: string | null } {
  switch (o.tipo) {
    case 'nota':
      return {
        titulo: o.numero ? `NF ${o.numero}` : 'Nota fiscal',
        detalhe: [o.fornecedor, o.emissao ? `emitida ${dataCurta(o.emissao)}` : null].filter(Boolean).join(' · ') || null,
      }
    case 'ordem':
      return { titulo: 'Ordem de compra', detalhe: o.responsavel }
    case 'kit':
      return {
        titulo: o.nome,
        detalhe: [o.paciente, o.data ? dataCurta(o.data) : null].filter(Boolean).join(' · ') || null,
      }
    case 'inventario':
      return { titulo: 'Inventário', detalhe: o.nome }
    case 'transferencia':
      return { titulo: `Transferência ${o.de} → ${o.para}`, detalhe: o.cancelada ? 'cancelada' : null }
    case 'uso':
      return {
        titulo: `Uso do setor · ${o.setor}`,
        detalhe: [`saiu de ${o.de}`, o.dia ? `usado ${dataCurta(o.dia)}` : null, o.cancelada ? 'cancelado' : null]
          .filter(Boolean)
          .join(' · '),
      }
    case 'juncao':
      return { titulo: 'Item juntado', detalhe: `${o.origem} → ${o.destino}${o.desfeita ? ' · desfeita' : ''}` }
    case 'estorno':
      return { titulo: 'Estorno', detalhe: null }
    case 'bipagem':
      return { titulo: 'Bipagem', detalhe: null }
    case 'manual':
      return { titulo: 'Lançamento manual', detalhe: null }
    case 'importacao':
      return {
        titulo:
          o.refType === 'inventario_fisico'
            ? 'Contagem física'
            : o.refType === 'pedido_bling'
              ? 'Venda (Bling)'
              : 'Importação',
        detalhe: null,
      }
  }
}

/** Grupo da operação, para o filtro e a cor da linha. */
export type GrupoOperacao = 'compra' | 'kit' | 'transferencia' | 'inventario' | 'estorno' | 'avulso'

export function grupoOperacao(l: LinhaKardex): GrupoOperacao {
  switch (l.origem.tipo) {
    case 'nota':
    case 'ordem':
      return 'compra'
    case 'kit':
      return 'kit'
    case 'transferencia':
    case 'uso':
      return 'transferencia'
    case 'inventario':
    case 'importacao':
    case 'juncao':
      return 'inventario'
    case 'estorno':
      return 'estorno'
    default:
      return 'avulso'
  }
}

/** Só lançamento avulso se estorna; o resto se corrige no documento de origem. */
export const podeEstornar = (l: LinhaKardex) =>
  (l.origem.tipo === 'manual' || l.origem.tipo === 'bipagem') && !l.estornadoPor

export type FiltroKardex = {
  setorId: string | null
  /** YYYY-MM-DD, inclusive, no fuso da clínica. */
  de: string | null
  ate: string | null
  grupo: GrupoOperacao | 'tudo' | 'entradas' | 'saidas'
  busca: string
}

export const FILTRO_KARDEX_VAZIO: FiltroKardex = { setorId: null, de: null, ate: null, grupo: 'tudo', busca: '' }

/** Texto em que a busca do kardex procura: nota, fornecedor, lote, paciente, quem fez. */
function textoDaLinha(l: LinhaKardex): string {
  const o = l.origem
  const partes: Array<string | null> = [l.itemNome, l.lote, l.motivo, l.observacao, l.autor, l.setorNome]
  if (o.tipo === 'nota') partes.push(o.numero, o.fornecedor, o.chave)
  if (o.tipo === 'kit') partes.push(o.nome, o.paciente)
  if (o.tipo === 'inventario') partes.push(o.nome)
  if (o.tipo === 'transferencia') partes.push(o.de, o.para)
  if (o.tipo === 'uso') partes.push(o.de, o.setor, 'uso do setor')
  if (o.tipo === 'juncao') partes.push(o.origem, o.destino)
  if (l.loteOrigem) partes.push(l.loteOrigem.numero, l.loteOrigem.fornecedor)
  return normalizarBusca(partes.filter(Boolean).join(' '))
}

export function filtrarKardex(linhas: LinhaKardex[], f: FiltroKardex): LinhaKardex[] {
  const termos = normalizarBusca(f.busca).split(/\s+/).filter(Boolean)
  return linhas.filter((l) => {
    if (f.setorId && l.setorId !== f.setorId) return false
    const dia = diaLocal(l.criadoEm)
    if (f.de && dia < f.de) return false
    if (f.ate && dia > f.ate) return false
    if (f.grupo === 'entradas' && l.qtd <= 0) return false
    if (f.grupo === 'saidas' && l.qtd >= 0) return false
    if (f.grupo !== 'tudo' && f.grupo !== 'entradas' && f.grupo !== 'saidas' && grupoOperacao(l) !== f.grupo) return false
    if (termos.length > 0) {
      const t = textoDaLinha(l)
      if (!termos.every((termo) => t.includes(termo))) return false
    }
    return true
  })
}

/**
 * Saldo antes do primeiro dia do filtro, no escopo escolhido (tudo ou um setor). As linhas
 * vêm do mais novo para o mais antigo; o saldo anterior é o da linha mais recente ANTES de `de`.
 */
export function saldoAnterior(linhas: LinhaKardex[], de: string | null, setorId: string | null): number | null {
  if (!de) return null
  const antes = linhas.find((l) => diaLocal(l.criadoEm) < de && (!setorId || l.setorId === setorId))
  if (!antes) return 0
  return setorId ? antes.saldoSetor : antes.saldo
}

export type SaldoSetor = { setorId: string | null; setorNome: string; qtd: number }

export function saldosPorSetor(linhas: LinhaKardex[]): SaldoSetor[] {
  const m = new Map<string, SaldoSetor>()
  for (const l of linhas) {
    const chave = l.setorId ?? ''
    const atual = m.get(chave) ?? { setorId: l.setorId, setorNome: l.setorNome ?? 'Sem setor', qtd: 0 }
    atual.qtd += l.qtd
    m.set(chave, atual)
  }
  return [...m.values()]
    .map((s) => ({ ...s, qtd: arredondar(s.qtd) }))
    .sort((a, b) => b.qtd - a.qtd || a.setorNome.localeCompare(b.setorNome, 'pt-BR'))
}

/** Soma de fração (0,05 de frasco) acumula erro de ponto flutuante: 4 casas bastam. */
const arredondar = (n: number) => Math.round(n * 10_000) / 10_000

export type CompraDoItem = {
  /** Nota (id) ou ordem de compra; é a chave do agrupamento. */
  chave: string
  origem: Extract<OrigemMovimento, { tipo: 'nota' } | { tipo: 'ordem' }>
  /** Quando entrou no estoque. */
  entradaEm: string
  qtd: number
  totalCents: number | null
  custoMedioCents: number | null
  lotes: Array<{ lote: string; validade: string | null; qtd: number }>
  /** Nome do produto como entrou (difere do item quando a nota foi consolidada nele). */
  nomes: string[]
  setores: string[]
}

/** De quais notas (e ordens de compra) o item veio, da mais recente para a mais antiga. */
export function comprasDoItem(linhas: LinhaKardex[]): CompraDoItem[] {
  const m = new Map<string, CompraDoItem & { custoConhecido: number; qtdValorada: number }>()
  for (const l of linhas) {
    const o = l.origem
    if (o.tipo !== 'nota' && o.tipo !== 'ordem') continue
    const chave = (o.tipo === 'nota' ? o.id ?? o.chave : o.id) ?? l.refId ?? l.id
    const c =
      m.get(chave) ??
      {
        chave,
        origem: o,
        entradaEm: l.criadoEm,
        qtd: 0,
        totalCents: null,
        custoMedioCents: null,
        lotes: [],
        nomes: [],
        setores: [],
        custoConhecido: 0,
        qtdValorada: 0,
      }
    c.qtd = arredondar(c.qtd + l.qtd)
    if (l.criadoEm < c.entradaEm) c.entradaEm = l.criadoEm
    if (l.custoUnitCents != null) {
      c.custoConhecido += l.custoUnitCents * l.qtd
      c.qtdValorada += l.qtd
    }
    if (l.lote) {
      const lote = c.lotes.find((x) => x.lote === l.lote)
      if (lote) lote.qtd = arredondar(lote.qtd + l.qtd)
      else c.lotes.push({ lote: l.lote, validade: l.validade, qtd: l.qtd })
    }
    if (l.itemNome && !c.nomes.includes(l.itemNome)) c.nomes.push(l.itemNome)
    if (l.setorNome && !c.setores.includes(l.setorNome)) c.setores.push(l.setorNome)
    m.set(chave, c)
  }
  return [...m.values()]
    .map(({ custoConhecido, qtdValorada, ...c }) => ({
      ...c,
      totalCents: qtdValorada > 0 ? Math.round(custoConhecido) : null,
      custoMedioCents: qtdValorada > 0 ? Math.round(custoConhecido / qtdValorada) : null,
    }))
    .sort((a, b) => b.entradaEm.localeCompare(a.entradaEm))
}

export type SaidaDoLote = {
  kitId: string
  kitNome: string
  paciente: string | null
  data: string
  qtd: number
}

export type LoteDoItem = {
  loteId: string
  lote: string
  validade: string | null
  saldo: number
  setores: SaldoSetor[]
  nota: NotaDoLote | null
  entradaEm: string
  /** Kits que levaram este lote, líquido de devolução (recall: quem recebeu o lote X). */
  pacientes: SaidaDoLote[]
  vencido: boolean
}

export function lotesDoItem(linhas: LinhaKardex[], hoje: string): LoteDoItem[] {
  const porLote = new Map<string, LinhaKardex[]>()
  for (const l of linhas) {
    if (!l.loteId) continue
    const lista = porLote.get(l.loteId) ?? []
    lista.push(l)
    porLote.set(l.loteId, lista)
  }
  const lotes: LoteDoItem[] = []
  for (const [loteId, doLote] of porLote) {
    const primeira = doLote[0]
    const kits = new Map<string, SaidaDoLote>()
    for (const l of doLote) {
      if (l.origem.tipo !== 'kit') continue
      const k = kits.get(l.origem.id) ?? {
        kitId: l.origem.id,
        kitNome: l.origem.nome,
        paciente: l.origem.paciente,
        data: l.origem.data ?? diaLocal(l.criadoEm),
        qtd: 0,
      }
      k.qtd = arredondar(k.qtd - l.qtd)
      kits.set(l.origem.id, k)
    }
    const saldo = arredondar(doLote.reduce((s, l) => s + l.qtd, 0))
    lotes.push({
      loteId,
      lote: primeira.lote ?? '(sem código)',
      validade: primeira.validade,
      saldo,
      setores: saldosPorSetor(doLote).filter((s) => s.qtd !== 0),
      nota: doLote.find((l) => l.loteOrigem)?.loteOrigem ?? null,
      entradaEm: doLote.reduce((min, l) => (l.criadoEm < min ? l.criadoEm : min), primeira.criadoEm),
      pacientes: [...kits.values()].filter((k) => k.qtd > 0).sort((a, b) => b.data.localeCompare(a.data)),
      vencido: primeira.validade != null && primeira.validade < hoje,
    })
  }
  // Com saldo primeiro (FEFO: o que vence antes no topo), depois os já esgotados.
  return lotes.sort((a, b) => {
    if ((a.saldo > 0) !== (b.saldo > 0)) return a.saldo > 0 ? -1 : 1
    const va = a.validade ?? '9999-12-31'
    const vb = b.validade ?? '9999-12-31'
    return va.localeCompare(vb) || b.entradaEm.localeCompare(a.entradaEm)
  })
}

/**
 * Consumo (saída para uso: kit, bipagem, manual) desde o dia. Transferência e inventário não
 * são uso; lançamento estornado se anula com o estorno, então nenhum dos dois conta.
 */
export function consumoDesde(linhas: LinhaKardex[], desde: string): number {
  let total = 0
  for (const l of linhas) {
    if (diaLocal(l.criadoEm) < desde || l.estornadoPor) continue
    const g = grupoOperacao(l)
    if (g === 'kit' || (g === 'avulso' && l.qtd < 0)) total -= l.qtd
  }
  return Math.max(0, arredondar(total))
}
