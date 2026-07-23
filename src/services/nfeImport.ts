import type { NfeParsed } from '@/services/nfeXml'
import type { StockItem } from '@/services/estoqueCompras'
import {
  createPayablesExact,
  createPurchaseInvoice,
  listStockItems,
  registerMovement,
  upsertStockItem,
  upsertSupplier,
} from '@/services/estoqueCompras'
import { ensureBatch, logControlledEntry } from '@/services/estoqueKits'
import { fetchBlingCatalog, pushBlingStockEntry } from '@/services/crmBling'

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
  matchedBy: 'ean' | 'sku' | 'nome' | null
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
  /** NF sem duplicatas (compra à vista/balcão): vencimento da parcela ÚNICA, valor = total da nota.
   *  Sem isso a nota entra só no estoque e o gasto some do financeiro. */
  singleDueDate?: string | null
  itemsPlan: NfeItemPlan[]
}

/**
 * Sugere o casamento de cada item da NF com o estoque existente. O fornecedor quase nunca
 * usa o mesmo nome/código que a gente, então casa em cascata pela chave mais confiável:
 *   1) EAN/GTIN (cEAN da nota × barcode do item) — chave global, não muda de fornecedor;
 *   2) SKU (cProd da nota × sku do item) — código próprio, quando o fornecedor repete o nosso;
 *   3) nome normalizado (sem acento/maiúscula/espaço duplo) — última tentativa.
 * Sem casar → 'novo'. O usuário revê e pode conectar manualmente na tela.
 */
export function suggestItemPlan(nfe: NfeParsed, stock: StockItem[]): NfeItemPlan[] {
  const byEan = new Map<string, string>()
  const bySku = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const s of stock) {
    const ean = onlyDigitsStr(s.barcode)
    if (ean.length >= 8 && !byEan.has(ean)) byEan.set(ean, s.id)
    const sku = normalizeCode(s.sku)
    if (sku && !bySku.has(sku)) bySku.set(sku, s.id)
    const name = normalizeName(s.name)
    if (name && !byName.has(name)) byName.set(name, s.id)
  }
  return nfe.items.map((item, index) => {
    const ean = onlyDigitsStr(item.ean)
    const eanHit = ean.length >= 8 ? byEan.get(ean) : undefined
    if (eanHit) return { index, action: 'existente' as const, matchedItemId: eanHit, matchedBy: 'ean' as const }
    const skuHit = item.supplierCode ? bySku.get(normalizeCode(item.supplierCode)) : undefined
    if (skuHit) return { index, action: 'existente' as const, matchedItemId: skuHit, matchedBy: 'sku' as const }
    const nameHit = byName.get(normalizeName(item.description))
    if (nameHit) return { index, action: 'existente' as const, matchedItemId: nameHit, matchedBy: 'nome' as const }
    return { index, action: 'novo' as const, matchedItemId: null, matchedBy: null }
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
    note: `Importada do XML da NF-e${nfe.series ? ` (série ${nfe.series})` : ''}`,
  })

  // 3) Itens → estoque (cria ou reusa, dá entrada, cria lote e loga controlado)
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

  for (const itemPlan of plan.itemsPlan) {
    if (itemPlan.action === 'ignorar') continue
    const nfeItem = nfe.items[itemPlan.index]
    if (!nfeItem || nfeItem.qty <= 0) continue

    let stockItemId = itemPlan.matchedItemId
    let controlled = false
    if (itemPlan.action === 'novo' || !stockItemId) {
      stockItemId = await upsertStockItem({
        name: nfeItem.description,
        unit: nfeItem.unit,
        source: 'nfe',
        barcode: nfeItem.ean,
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
        })
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
      qty: nfeItem.qty,
      reason: 'compra (NF-e)',
      note: `NF ${nfe.number}${nfeItem.lotCode ? ` · lote ${nfeItem.lotCode}` : ''}`,
      refType: 'purchase_invoice',
      refId: invoice.id,
      batchId,
      unitCostCents: nfeItem.unitCostCents,
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
          qty: nfeItem.qty,
          unitCostCents: nfeItem.unitCostCents,
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
        qty: nfeItem.qty,
        note: `Entrada por NF ${nfe.number}`,
      })
    }
  }

  // 4) Parcelas → contas a pagar. Nota a prazo traz as duplicatas em cobr/dup; compra à vista
  //    (papelaria, balcão) não traz cobr nenhum — e antes disso o gasto entrava no estoque e
  //    nunca aparecia no financeiro. Sem duplicata, a parcela única é o total da nota.
  let payables = 0
  if (plan.createPayables) {
    const rows =
      nfe.installments.length > 0
        ? nfe.installments.map((inst) => ({
            description: `NF ${nfe.number} — parcela ${inst.number}`,
            dueDate: inst.dueDate,
            amountCents: inst.amountCents,
            paymentMethod: 'boleto' as string | null,
          }))
        : plan.singleDueDate && nfe.totalCents > 0
          ? [
              {
                description: `NF ${nfe.number} — à vista`,
                dueDate: plan.singleDueDate,
                amountCents: nfe.totalCents,
                paymentMethod: null as string | null,
              },
            ]
          : []
    if (rows.length > 0) {
      await createPayablesExact(
        rows.map((r) => ({ ...r, supplierId, invoiceId: invoice.id })),
      )
      payables = rows.length
    }
  }

  return {
    invoiceNumber: nfe.number,
    itemsStocked,
    itemsCreated,
    batches,
    payables,
    blingPushed,
  }
}
