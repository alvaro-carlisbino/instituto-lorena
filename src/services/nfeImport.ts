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

// Orquestra o import da NF-e já parseada: vive num módulo separado pra não criar
// ciclo entre estoqueCompras (fase 1) e estoqueKits (fase 2/lotes).

// Como cada linha da NF-e vira estoque. O usuário confirma na tela antes de importar.
export type NfeItemPlan = {
  /** índice do item no NfeParsed.items */
  index: number
  /** 'novo' cria stock_item; id existente dá entrada nele; 'ignorar' pula (item que não é estoque) */
  action: 'novo' | 'existente' | 'ignorar'
  matchedItemId: string | null
}

export type NfeImportPlan = {
  createSupplier: boolean
  supplierId: string | null
  createPayables: boolean
  itemsPlan: NfeItemPlan[]
}

/** Sugere o casamento de cada item da NF com o estoque existente (por nome exato, senão “novo”). */
export function suggestItemPlan(nfe: NfeParsed, stock: StockItem[]): NfeItemPlan[] {
  const byName = new Map(stock.map((s) => [s.name.trim().toLowerCase(), s.id] as const))
  return nfe.items.map((item, index) => {
    const match = byName.get(item.description.trim().toLowerCase())
    return match
      ? { index, action: 'existente' as const, matchedItemId: match }
      : { index, action: 'novo' as const, matchedItemId: null }
  })
}

export type NfeImportResult = {
  invoiceNumber: string
  itemsStocked: number
  itemsCreated: number
  batches: number
  payables: number
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
  let itemsStocked = 0
  let itemsCreated = 0
  let batches = 0

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

  // 4) Parcelas (duplicatas) → contas a pagar
  let payables = 0
  if (plan.createPayables && nfe.installments.length > 0) {
    await createPayablesExact(
      nfe.installments.map((inst) => ({
        description: `NF ${nfe.number} — parcela ${inst.number}`,
        supplierId,
        invoiceId: invoice.id,
        dueDate: inst.dueDate,
        amountCents: inst.amountCents,
        paymentMethod: 'boleto',
      })),
    )
    payables = nfe.installments.length
  }

  return {
    invoiceNumber: nfe.number,
    itemsStocked,
    itemsCreated,
    batches,
    payables,
  }
}
