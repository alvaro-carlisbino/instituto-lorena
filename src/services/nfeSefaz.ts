import { supabase } from '@/lib/supabaseClient'
import { parseNfeXml } from '@/services/nfeXml'
import { importNfe, suggestItemPlan } from '@/services/nfeImport'
import { createPayablesExact, createPurchaseInvoice, listStockItems, listSuppliers, upsertSupplier } from '@/services/estoqueCompras'
import type { StockItem, Supplier } from '@/services/estoqueCompras'

/**
 * Notas que a SEFAZ tem contra o CNPJ do polo, e como trazê-las pra dentro.
 *
 * Roda no NAVEGADOR de propósito, não numa rotina de servidor: `purchase_invoices`,
 * `payable_installments` e o estoque usam `tenant_id default current_tenant_id()` e RLS pra
 * separar clínica × Tricopill. Rodando por service_role o polo sai errado ou nulo. Quem
 * importa é o usuário logado, com o polo dele.
 *
 * Duas classes de nota, e a diferença não é escolha nossa:
 *   - com XML completo  -> vai pelo `importNfe` normal: fornecedor + nota + parcelas + estoque;
 *   - só resumo         -> a SEFAZ perdeu o XML (ciência não foi dada nos 10 dias da emissão).
 *                          Sobra emitente, chave, valor e data. Vira fornecedor + nota + UMA
 *                          parcela. Estoque não dá: não existe item pra dar entrada.
 */

export type NotaSefaz = {
  chave: string
  emitente: string | null
  documentoEmitente: string | null
  valor: number
  dataEmissao: string | null
  situacao: string | null
  xmlCompleto: boolean
}

export type ListaSefaz = {
  total: number
  jaNoSistema: number
  faltando: number
  valorFaltando: number
  faltandoSemXmlCompleto: number
  aviso: string
  notas: NotaSefaz[]
}

function client() {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export async function listarNotasSefaz(): Promise<ListaSefaz> {
  const { data, error } = await client().functions.invoke('crm-focus-recebidas', { body: {} })
  if (error) throw new Error('Falha ao consultar a SEFAZ')
  const p = (data ?? {}) as Partial<ListaSefaz> & { ok?: boolean; error?: string }
  if (!p.ok) throw new Error(String(p.error || 'Falha ao consultar a SEFAZ'))
  return {
    total: p.total ?? 0,
    jaNoSistema: p.jaNoSistema ?? 0,
    faltando: p.faltando ?? 0,
    valorFaltando: p.valorFaltando ?? 0,
    faltandoSemXmlCompleto: p.faltandoSemXmlCompleto ?? 0,
    aviso: p.aviso ?? '',
    notas: Array.isArray(p.notas) ? p.notas : [],
  }
}

export async function baixarXmlSefaz(chave: string): Promise<string | null> {
  const { data, error } = await client().functions.invoke('crm-focus-recebidas', {
    body: { action: 'xml', chave },
  })
  if (error) return null
  const p = (data ?? {}) as { ok?: boolean; xml?: string }
  return p.ok && typeof p.xml === 'string' ? p.xml : null
}

/** Data local no formato aceito pelo banco, sem passar por fuso. */
const diaDe = (iso: string | null): string | null => {
  const d = (iso ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

/** Casa o fornecedor pelo CNPJ (só dígitos) — nome varia, CNPJ não. */
function acharFornecedor(suppliers: Supplier[], cnpj: string | null): Supplier | null {
  const d = (cnpj ?? '').replace(/\D/g, '')
  if (!d) return null
  return suppliers.find((s) => (s.cnpj ?? '').replace(/\D/g, '') === d) ?? null
}

export type ResultadoImport = {
  chave: string
  ok: boolean
  modo: 'completa' | 'resumo'
  /** Mensagem curta pra tela. Em erro, o motivo. */
  detalhe: string
}

/**
 * Importa UMA nota de resumo: fornecedor + nota de compra + parcela única.
 *
 * A parcela nasce EM ABERTO e vencendo na emissão. É o único par honesto de valores: o resumo
 * não traz duplicata nem informação de pagamento, e marcar como paga seria inventar. Já houve
 * o erro inverso aqui — dar um lote inteiro como vencido quando 15 parcelas venciam no futuro.
 * Em aberto e visível, quem confere corrige; carimbado errado, ninguém descobre.
 */
export async function importarResumo(
  nota: NotaSefaz,
  suppliers: Supplier[],
): Promise<ResultadoImport> {
  const base = { chave: nota.chave, modo: 'resumo' as const }
  try {
    const cnpj = (nota.documentoEmitente ?? '').replace(/\D/g, '')
    let fornecedor = acharFornecedor(suppliers, cnpj)
    if (!fornecedor) {
      fornecedor = await upsertSupplier({
        name: nota.emitente?.trim() || `Fornecedor ${cnpj || nota.chave.slice(6, 20)}`,
        cnpj: cnpj || null,
      })
      suppliers.push(fornecedor)
    }

    const emissao = diaDe(nota.dataEmissao)
    const centavos = Math.round(nota.valor * 100)
    // Número da nota sai da própria chave (posições 26-34), que é onde ele mora. Sem XML não
    // há outro lugar de onde tirar.
    const numero = String(Number(nota.chave.slice(25, 34) || '0')) || nota.chave.slice(-6)

    const invoice = await createPurchaseInvoice({
      number: numero,
      supplierId: fornecedor.id,
      issueDate: emissao,
      totalCents: centavos,
      nfeKey: nota.chave,
      note: 'Importada da SEFAZ (resumo, sem XML completo) — sem itens de estoque.',
    })

    if (centavos > 0 && emissao) {
      await createPayablesExact([{
        description: `NF ${numero} — ${fornecedor.name}`,
        supplierId: fornecedor.id,
        invoiceId: invoice.id,
        dueDate: emissao,
        amountCents: centavos,
        note: 'Vencimento = emissão: o resumo da SEFAZ não traz duplicata. Conferir.',
      }])
    }
    return { ...base, ok: true, detalhe: `NF ${numero} lançada (sem itens)` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Chave repetida = a nota já entrou por outro caminho. Não é falha, é dedup funcionando.
    if (/duplicate|unique/i.test(msg)) return { ...base, ok: true, detalhe: 'já estava lançada' }
    return { ...base, ok: false, detalhe: msg.slice(0, 120) }
  }
}

/**
 * Importa UMA nota com XML completo pelo caminho normal (fornecedor + nota + parcelas + estoque).
 *
 * Recebe estoque e fornecedores de fora porque numa carga de dezenas de notas reler os dois a
 * cada nota são centenas de idas ao banco — e o catálogo muda DURANTE a carga, então quem
 * chama precisa recarregar entre as notas para o casamento de item enxergar o que acabou de
 * ser criado. Ver `importarLote`.
 */
export async function importarCompleta(
  nota: NotaSefaz,
  stock: StockItem[],
  suppliers: Supplier[],
): Promise<ResultadoImport> {
  const base = { chave: nota.chave, modo: 'completa' as const }
  try {
    const xml = await baixarXmlSefaz(nota.chave)
    if (!xml) return { ...base, ok: false, detalhe: 'XML indisponível na Focus' }

    const parsed = parseNfeXml(xml)
    const fornecedor = acharFornecedor(suppliers, parsed.supplierCnpj)

    const r = await importNfe(parsed, {
      createSupplier: !fornecedor,
      supplierId: fornecedor?.id ?? null,
      createPayables: parsed.totalCents > 0,
      // Sem duplicata na nota, a parcela única vence na emissão — mesma regra do upload manual.
      singleDueDate: parsed.installments.length === 0 ? (parsed.issueDate ?? null) : null,
      itemsPlan: suggestItemPlan(parsed, stock),
    })
    return {
      ...base,
      ok: true,
      detalhe: `NF ${r.invoiceNumber}: ${r.itemsStocked} entrada(s) no estoque`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/duplicate|unique/i.test(msg)) return { ...base, ok: true, detalhe: 'já estava lançada' }
    return { ...base, ok: false, detalhe: msg.slice(0, 120) }
  }
}

export type ProgressoLote = { feitas: number; total: number; atual: string }

/**
 * Carga em lote. Sequencial de propósito: cada nota pode CRIAR item de estoque e fornecedor, e
 * a próxima precisa enxergar isso pra casar em vez de duplicar. Em paralelo, duas notas do
 * mesmo fornecedor com o mesmo produto criariam dois itens — que é exatamente a duplicata que
 * já custou caro nas cargas anteriores.
 *
 * Erro numa nota NÃO derruba o lote: a nota entra na lista de falhas e a carga segue. Um lote
 * inteiro já caiu por rollback de uma única violação de índice, e o erro não apareceu no log.
 */
export async function importarLote(
  notas: NotaSefaz[],
  onProgresso?: (p: ProgressoLote) => void,
): Promise<ResultadoImport[]> {
  const resultados: ResultadoImport[] = []
  let stock = await listStockItems(true)
  let suppliers = await listSuppliers()

  for (const [i, nota] of notas.entries()) {
    onProgresso?.({ feitas: i, total: notas.length, atual: nota.emitente ?? nota.chave.slice(-8) })
    const r = nota.xmlCompleto
      ? await importarCompleta(nota, stock, suppliers)
      : await importarResumo(nota, suppliers)
    resultados.push(r)
    // Só relê o catálogo quando a nota pode tê-lo mudado; resumo não cria item.
    if (r.ok && nota.xmlCompleto) {
      stock = await listStockItems(true)
      suppliers = await listSuppliers()
    }
  }
  onProgresso?.({ feitas: notas.length, total: notas.length, atual: '' })
  return resultados
}
