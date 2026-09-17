import type { NfeParsed } from '@/services/nfeXml'
import type { StockItem } from '@/services/estoqueCompras'
import {
  createPayablesExact,
  createPurchaseInvoice,
  listStockItems,
  registerMovement,
  salvarFatorEmbalagem,
  upsertStockItem,
  upsertSupplier,
} from '@/services/estoqueCompras'
import { ensureBatch, logControlledEntry } from '@/services/estoqueKits'
import { fetchBlingCatalog, pushBlingStockEntry } from '@/services/crmBling'
import { chavesEmbalagem, converterPorEmbalagem, sugerirFatorEmbalagem } from '@/lib/nfeEmbalagem'
import { limparNomeItemNfe, temRastroNoNome } from '@/lib/nfeNomeItem'
import type { BoletoDaNota } from '@/lib/boletosDaNota'

const onlyDigits = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '')

// Orquestra o import da NF-e já parseada: vive num módulo separado pra não criar
// ciclo entre estoqueCompras (fase 1) e estoqueKits (fase 2/lotes).

// Como cada linha da NF-e vira estoque. O usuário confirma na tela antes de importar.
export type NfeItemPlan = {
  /** índice do item no NfeParsed.items */
  index: number
  /** 'novo' cria stock_item; id existente dá entrada nele; 'ignorar' pula (item que não é estoque) */
  action: 'novo' | 'existente' | 'ignorar'
  matchedItemId: string | null
  /** Como a sugestão casou com o estoque (pra mostrar na tela). null = não casou / manual. */
  matchedBy: 'ean' | 'sku' | 'nome' | 'alias' | null
  /** Unidades do item por unidade da nota (1 CX = 200 pares → 200). Ausente = 1. */
  packFactor?: number
  /** De onde veio o fator: guardado no item, lido do nome da nota, ou digitado na tela. */
  packSource?: 'aprendido' | 'nome' | 'manual' | null
}

/** Fator sugerido para a linha da nota entrando neste item (1 quando nada indica embalagem). */
export function fatorParaLinha(nfeItem: NfeParsed['items'][number], item: StockItem | undefined) {
  const sugestao = item ? sugerirFatorEmbalagem(nfeItem, item) : null
  return { packFactor: sugestao?.fator ?? 1, packSource: sugestao?.origem ?? null }
}

const onlyDigitsStr = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '')
/** Normaliza nome pra comparar: minúsculo, sem acento, espaços colapsados. */
const normalizeName = (v: string | null | undefined) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
const normalizeCode = (v: string | null | undefined) => String(v ?? '').trim().toLowerCase()

export type NfeImportPlan = {
  createSupplier: boolean
  supplierId: string | null
  createPayables: boolean
  /** Nota sem duplicata no XML (NFS-e, balcão): os boletos digitados na tela, com o vencimento e
   *  o valor de cada um. Sem isso a nota entra só no estoque e o gasto some do financeiro. */
  boletos?: BoletoDaNota[]
  itemsPlan: NfeItemPlan[]
}

/**
 * Sugere o casamento de cada item da NF com o estoque existente. O fornecedor quase nunca
 * usa o mesmo nome/código que a gente, então casa em cascata pela chave mais confiável:
 *   1) EAN/GTIN (cEAN da nota × barcode do item) — chave global, não muda de fornecedor;
 *   2) SKU (cProd da nota × sku do item) — código próprio, quando o fornecedor repete o nosso;
 *   3) nome normalizado (sem acento/maiúscula/espaço duplo);
 *   4) alias do item (nome da NF / princípio ativo cadastrado no estoque);
 *   5) alias contido na descrição da NF (quando a NF traz nome longo).
 * Sem casar → 'novo'. O usuário revê e pode conectar manualmente na tela.
 */
export function suggestItemPlan(nfe: NfeParsed, stock: StockItem[]): NfeItemPlan[] {
  // Item consolidado pela contagem aponta pro que ficou: a nota casa pelo nome/EAN antigo e
  // a entrada cai no item que a enfermagem conta. O limite de saltos protege contra ciclo.
  const replacedBy = new Map<string, string>()
  const stockById = new Map(stock.map((s) => [s.id, s] as const))
  for (const s of stock) if (s.replacedBy) replacedBy.set(s.id, s.replacedBy)
  const resolve = (id: string) => {
    let current = id
    for (let hop = 0; hop < 5 && replacedBy.has(current); hop += 1) current = replacedBy.get(current)!
    return current
  }
  const byEan = new Map<string, string>()
  const bySku = new Map<string, string>()
  const byName = new Map<string, string>()
  const byAlias = new Map<string, string>()
  const aliasEntries: Array<{ alias: string; id: string }> = []
  for (const s of stock) {
    const ean = onlyDigitsStr(s.barcode)
    if (ean.length >= 8 && !byEan.has(ean)) byEan.set(ean, s.id)
    const sku = normalizeCode(s.sku)
    if (sku && !bySku.has(sku)) bySku.set(sku, s.id)
    const name = normalizeName(s.name)
    if (name && !byName.has(name)) byName.set(name, s.id)
    for (const raw of s.aliases ?? []) {
      const alias = normalizeName(raw)
      if (!alias) continue
      if (!byAlias.has(alias)) byAlias.set(alias, s.id)
      aliasEntries.push({ alias, id: s.id })
    }
  }
  return nfe.items.map((item, index) => {
    const ean = onlyDigitsStr(item.ean)
    const eanHit = ean.length >= 8 ? byEan.get(ean) : undefined
    if (eanHit) return { index, action: 'existente' as const, matchedItemId: eanHit, matchedBy: 'ean' as const }
    const skuHit = item.supplierCode ? bySku.get(normalizeCode(item.supplierCode)) : undefined
    if (skuHit) return { index, action: 'existente' as const, matchedItemId: skuHit, matchedBy: 'sku' as const }
    // Compara pelo nome cru E pelo nome sem o rastro de lote/validade: o catálogo guarda o
    // nome limpo, mas o alias guarda o cru — a nota do mês seguinte muda só o lote.
    const desc = normalizeName(item.description)
    const descLimpo = normalizeName(limparNomeItemNfe(item.description))
    const nameHit = byName.get(desc) ?? byName.get(descLimpo)
    if (nameHit) return { index, action: 'existente' as const, matchedItemId: nameHit, matchedBy: 'nome' as const }
    const aliasExact = byAlias.get(desc) ?? byAlias.get(descLimpo)
    if (aliasExact) return { index, action: 'existente' as const, matchedItemId: aliasExact, matchedBy: 'alias' as const }
    // NF longa contendo o alias (ex.: "ACIDO TRANEXAMICO 250MG ..." ↔ alias "acido tranexamico")
    const aliasPartial = aliasEntries
      .filter((a) => a.alias.length >= 6 && (desc.includes(a.alias) || a.alias.includes(desc)))
      .sort((a, b) => b.alias.length - a.alias.length)[0]
    if (aliasPartial) {
      return { index, action: 'existente' as const, matchedItemId: aliasPartial.id, matchedBy: 'alias' as const }
    }
    return { index, action: 'novo' as const, matchedItemId: null, matchedBy: null }
  }).map((plan) => {
    if (!plan.matchedItemId) return plan
    const matchedItemId = resolve(plan.matchedItemId)
    const alvo = stockById.get(matchedItemId)
    // Desativado sem substituto = alguém decidiu que aquilo não é estoque (a baixa de 14/09 tirou
    // obra, móvel e equipamento). A próxima nota da mesma TV não pode ressuscitar o saldo escondido.
    if (alvo && !alvo.active) return { ...plan, action: 'ignorar' as const, matchedItemId: null }
    return { ...plan, matchedItemId, ...fatorParaLinha(nfe.items[plan.index], alvo) }
  })
}

export type NfeImportResult = {
  invoiceNumber: string
  itemsStocked: number
  itemsCreated: number
  batches: number
  payables: number
  /** entradas espelhadas no Bling (produtos que vendem no site/bot/PDV) */
  blingPushed: number
}

export async function importNfe(nfe: NfeParsed, plan: NfeImportPlan): Promise<NfeImportResult> {
  // 1) Fornecedor (novo ou o escolhido)
  let supplierId = plan.supplierId
  if (plan.createSupplier && nfe.supplierName) {
    const created = await upsertSupplier({ name: nfe.supplierName, cnpj: nfe.supplierCnpj })
    supplierId = created.id
  }

  // 2) NF de compra
  const invoice = await createPurchaseInvoice({
    number: nfe.number || `s/nº ${nfe.issueDate ?? ''}`.trim(),
    supplierId,
    issueDate: nfe.issueDate,
    totalCents: nfe.totalCents,
    note:
      nfe.kind === 'nfse'
        ? 'Importada do XML da NFS-e (nota de serviço, sem itens de estoque)'
        : `Importada do XML da NF-e${nfe.series ? ` (série ${nfe.series})` : ''}`,
    nfeKey: nfe.key,
  })

  // 3) Itens → estoque (cria ou reusa, dá entrada, cria lote e loga controlado)
  const est = await darEntradaItensNfe(nfe, invoice.id, plan.itemsPlan, { learnPacks: true })

  // 4) Parcelas → contas a pagar. Nota a prazo traz as duplicatas em cobr/dup; compra à vista
  //    (papelaria, balcão) e NFS-e não trazem cobr nenhum — e antes disso o gasto entrava no
  //    estoque e nunca aparecia no financeiro. Sem duplicata, valem os boletos digitados na tela.
  let payables = 0
  if (plan.createPayables) {
    const boletos = (plan.boletos ?? []).filter((b) => b.dueDate && b.amountCents > 0)
    const rows =
      nfe.installments.length > 0
        ? nfe.installments.map((inst) => ({
            description: `NF ${nfe.number} — parcela ${inst.number}`,
            dueDate: inst.dueDate,
            amountCents: inst.amountCents,
            paymentMethod: 'boleto' as string | null,
          }))
        : boletos.map((b, i) => ({
            // Uma parcela só pode ser Pix ou cartão no balcão; parcelado é boleto.
            description:
              boletos.length > 1 ? `NF ${nfe.number} — boleto ${i + 1}/${boletos.length}` : `NF ${nfe.number} — parcela única`,
            dueDate: b.dueDate,
            amountCents: b.amountCents,
            paymentMethod: (boletos.length > 1 ? 'boleto' : null) as string | null,
          }))
    if (rows.length > 0) {
      await createPayablesExact(
        rows.map((r) => ({ ...r, supplierId, invoiceId: invoice.id })),
      )
      payables = rows.length
    }
  }

  return {
    invoiceNumber: nfe.number,
    itemsStocked: est.itemsStocked,
    itemsCreated: est.itemsCreated,
    batches: est.batches,
    payables,
    blingPushed: est.blingPushed,
  }
}

/**
 * Dá entrada dos itens da NF-e numa nota de compra QUE JÁ EXISTE.
 *
 * Saiu de dentro do `importNfe` quando a captura da SEFAZ passou a lançar o financeiro no
 * servidor: lá a nota e as parcelas já nasceram (as duplicatas reais vêm do mesmo XML), e o que
 * falta é só o estoque. A alternativa seria um segundo casamento de item do lado do servidor —
 * e é exatamente ter DUAS implementações dessa cascata que criou item duplicado nas cargas de
 * julho e agosto. Uma só, aqui, usada pelos dois caminhos.
 *
 * `needsReview` marca o que for criado agora: no import automático ninguém olhou a nota, e o
 * ensaio de 14/ago mostrou que metade do que a NF-e cria não é estoque clínico (whisky, Bíblia,
 * Smart TV, frigideira — compra de obra e pessoal).
 */
export async function darEntradaItensNfe(
  nfe: NfeParsed,
  invoiceId: string,
  itemsPlan: NfeItemPlan[],
  opts?: {
    needsReview?: boolean
    /** Import manual: quem revisou a nota confirmou o fator, então o item aprende. A SEFAZ não. */
    learnPacks?: boolean
  },
): Promise<{ itemsStocked: number; itemsCreated: number; batches: number; blingPushed: number }> {
  const currentStock = await listStockItems(true)
  const byId = new Map(currentStock.map((s) => [s.id, s] as const))
  // Catálogo do Bling (best-effort) p/ casar item da nota por EAN e espelhar a entrada.
  const blingByEan = new Map<string, string>()
  try {
    const cat = await fetchBlingCatalog(false)
    for (const p of cat.items) {
      const ean = onlyDigits(p.gtin)
      if (ean.length >= 8) blingByEan.set(ean, p.id)
    }
  } catch {
    // sem catálogo do Bling: segue só com o estoque interno
  }
  let itemsStocked = 0
  let itemsCreated = 0
  let batches = 0
  let blingPushed = 0

  for (const itemPlan of itemsPlan) {
    if (itemPlan.action === 'ignorar') continue
    const nfeItem = nfe.items[itemPlan.index]
    if (!nfeItem || nfeItem.qty <= 0) continue

    let stockItemId = itemPlan.matchedItemId
    let controlled = false
    // Item novo nasce na unidade da nota: só converte quem entra num item que já existe.
    const fator = itemPlan.action === 'existente' && stockItemId ? (itemPlan.packFactor ?? 1) : 1
    const { qty, unitCostCents } = converterPorEmbalagem(nfeItem.qty, nfeItem.unitCostCents, fator)
    if (itemPlan.action === 'novo' || !stockItemId) {
      // O fornecedor põe lote/validade dentro do xProd. Item nasce com o nome limpo e guarda
      // o nome cru como alias — senão a próxima nota, com outro lote, cria um item repetido.
      stockItemId = await upsertStockItem({
        name: limparNomeItemNfe(nfeItem.description),
        unit: nfeItem.unit,
        source: 'nfe',
        barcode: nfeItem.ean,
        aliases: temRastroNoNome(nfeItem.description) ? [nfeItem.description] : [],
        needsReview: opts?.needsReview ?? false,
      })
      itemsCreated += 1
    } else {
      const current = byId.get(stockItemId)
      controlled = current?.controlled ?? false
      // NF-e traz o GTIN: aproveita pra carimbar o barcode do item que ainda não tem
      // (upsert exige o registro completo — só {id, barcode} zeraria os demais campos).
      if (current && !current.barcode && nfeItem.ean) {
        await upsertStockItem({
          id: current.id,
          name: current.name,
          sku: current.sku,
          barcode: nfeItem.ean,
          category: current.category,
          unit: current.unit,
          minQty: current.minQty,
          controlled: current.controlled,
          note: current.note,
          // sem isso o upsert reativa item desativado (default active=true)
          active: current.active,
        })
      }
      const confirmado = itemPlan.packSource === 'manual' || itemPlan.packSource === 'nome'
      if (opts?.learnPacks && current && confirmado) {
        const chaves = chavesEmbalagem(nfeItem.description, nfeItem.ean)
        // Guarda no mapa local também: a mesma nota pode trazer o produto em duas linhas.
        current.packFactors = await salvarFatorEmbalagem(current.id, current.packFactors ?? {}, chaves, fator)
      }
    }

    let batchId: string | null = null
    if (nfeItem.lotCode) {
      batchId = await ensureBatch({
        itemId: stockItemId,
        lotCode: nfeItem.lotCode,
        expiresOn: nfeItem.expiresOn,
      })
      batches += 1
    }

    const movementId = await registerMovement({
      itemId: stockItemId,
      kind: 'entrada',
      qty,
      reason: 'compra (NF-e)',
      // O nome do produto como veio na nota fica no lançamento: quando a nota casa com item de
      // outro nome (apelido, EAN), a ficha do item ainda mostra o que o fornecedor faturou.
      note:
        `NF ${nfe.number} · ${nfeItem.description}${nfeItem.lotCode ? ` · lote ${nfeItem.lotCode}` : ''}` +
        (fator !== 1 ? ` · ${nfeItem.qty} ${nfeItem.unit} × ${fator}` : ''),
      refType: 'purchase_invoice',
      refId: invoiceId,
      batchId,
      unitCostCents,
    })
    itemsStocked += 1

    // Espelha a entrada no Bling se o item estiver vinculado (por bling_product_id ou EAN).
    const linkedBlingId =
      (stockItemId ? byId.get(stockItemId)?.blingProductId : null) ||
      (nfeItem.ean ? blingByEan.get(onlyDigits(nfeItem.ean)) : null) ||
      null
    if (linkedBlingId) {
      try {
        await pushBlingStockEntry({
          blingProductId: linkedBlingId,
          qty,
          unitCostCents,
          note: `Entrada NF ${nfe.number} (import CRM)`,
        })
        blingPushed += 1
      } catch {
        // best-effort: a entrada interna já foi feita; o Bling pode ser reconciliado depois
      }
    }

    if (controlled) {
      await logControlledEntry({
        itemId: stockItemId,
        batchId,
        movementId,
        qty,
        note: `Entrada por NF ${nfe.number}`,
      })
    }
  }

  return { itemsStocked, itemsCreated, batches, blingPushed }
}
