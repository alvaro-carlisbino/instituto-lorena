import { supabase } from '@/lib/supabaseClient'
import { parseNfeXml } from '@/services/nfeXml'
import { darEntradaItensNfe, suggestItemPlan } from '@/services/nfeImport'
import { listStockItems } from '@/services/estoqueCompras'

/**
 * O que a SEFAZ tem contra o CNPJ do polo — e o que disso ainda depende de gente.
 *
 * A captura e o lançamento FINANCEIRO acontecem sozinhos, no servidor (`crm-sefaz-sync`, 2x/dia).
 * Esta tela não busca mais nota nenhuma: ela lê o que já entrou e mostra as duas coisas que a
 * automação de propósito NÃO decide sozinha.
 *
 * 1. ENTRADA DE ESTOQUE das notas com XML. O casamento de item (EAN → SKU → nome → alias) mora
 *    no navegador, contra o catálogo do polo. Uma implementação só: ter duas foi o que criou
 *    item duplicado nas cargas de julho e agosto. Produto criado aqui nasce marcado como
 *    "a revisar" — metade do que a NF-e cria não é estoque clínico (whisky, Bíblia, Smart TV).
 *
 * 2. CONFERÊNCIA DO QUE JÁ FOI PAGO. Toda parcela nasce EM ABERTO porque nem o resumo da SEFAZ
 *    nem o XML dizem se a nota foi paga — quem sabe isso é o extrato do banco. Em aberto e
 *    visível, quem confere corrige; carimbado como paga, ninguém descobre.
 */

const client = () => {
  if (!supabase) throw new Error('Supabase não configurado')
  return supabase
}

export type ResumoSefaz = {
  /** Notas distintas na janela da SEFAZ (~90 dias). */
  capturadas: number
  lancadas: number
  comErro: number
  /** Já no financeiro, faltando dar entrada no estoque. */
  estoquePendente: number
  /** XML guardado — essas dão pra importar inteiras mesmo depois de saírem da janela. */
  comXmlGuardado: number
  valorTotal: number
  janelaDe: string | null
  janelaAte: string | null
  /** Parcelas criadas por esta via que continuam em aberto e ninguém bateu contra o banco. */
  aConferirParcelas: number
  aConferirValor: number
  /** Dessas, as que o extrato do banco já provou que saíram (migration 20260817190000). */
  conciliadasAuto: number
  conciliadoAutoValor: number
}

export async function resumoSefaz(): Promise<ResumoSefaz> {
  const c = client()
  // RLS já prende ao polo do usuário: nenhuma consulta aqui filtra tenant à mão.
  const { data, error } = await c
    .from('sefaz_documentos')
    .select('status, estoque_pendente, xml_completo, valor_cents, data_emissao, xml')
    .limit(2000)
  if (error) throw new Error(error.message)

  type Linha = {
    status: string
    estoque_pendente: boolean
    xml_completo: boolean
    valor_cents: number
    data_emissao: string | null
    xml: string | null
  }
  const linhas = (data ?? []) as Linha[]
  const dias = linhas.map((l) => l.data_emissao).filter((d): d is string => !!d).sort()

  const { data: pend, error: pendErr } = await c
    .from('payable_installments')
    .select('amount_cents')
    .eq('status', 'aberto')
    .like('import_key', 'sefaz:%')
    .limit(2000)
  if (pendErr) throw new Error(pendErr.message)
  const parcelas = (pend ?? []) as Array<{ amount_cents: number }>

  // As que o casamento com o extrato já resolveu sozinho. Sem este número o painel só sabe
  // reclamar do que falta e a automação parece não ter feito nada.
  const { data: auto, error: autoErr } = await c
    .from('payable_installments')
    .select('amount_cents')
    .not('auto_reconciled_at', 'is', null)
    .like('import_key', 'sefaz:%')
    .limit(2000)
  if (autoErr) throw new Error(autoErr.message)
  const conciliadas = (auto ?? []) as Array<{ amount_cents: number }>

  return {
    capturadas: linhas.length,
    lancadas: linhas.filter((l) => l.status === 'lancado').length,
    comErro: linhas.filter((l) => l.status === 'erro').length,
    estoquePendente: linhas.filter((l) => l.estoque_pendente).length,
    comXmlGuardado: linhas.filter((l) => !!l.xml).length,
    valorTotal: linhas.reduce((s, l) => s + (l.valor_cents ?? 0), 0) / 100,
    janelaDe: dias[0] ?? null,
    janelaAte: dias[dias.length - 1] ?? null,
    aConferirParcelas: parcelas.length,
    aConferirValor: parcelas.reduce((s, p) => s + (p.amount_cents ?? 0), 0) / 100,
    conciliadasAuto: conciliadas.length,
    conciliadoAutoValor: conciliadas.reduce((s, p) => s + (p.amount_cents ?? 0), 0) / 100,
  }
}

/** Dispara a captura agora, no polo do usuário logado. O cron já faz isso 2x/dia. */
export async function sincronizarSefaz(): Promise<Record<string, unknown>> {
  const { data, error } = await client().functions.invoke('crm-sefaz-sync', { body: {} })
  if (error) throw new Error('Falha ao sincronizar com a SEFAZ')
  const p = (data ?? {}) as { ok?: boolean; error?: string; polos?: Record<string, unknown>[] }
  if (!p.ok) throw new Error(String(p.error || 'Falha ao sincronizar com a SEFAZ'))
  return (p.polos ?? [])[0] ?? {}
}

export type NotaEstoquePendente = {
  id: string
  chave: string
  numero: string | null
  emitente: string | null
  valor: number
  dataEmissao: string | null
  invoiceId: string | null
}

export async function listarEstoquePendente(): Promise<NotaEstoquePendente[]> {
  const { data, error } = await client()
    .from('sefaz_documentos')
    .select('id, chave, numero, emitente, valor_cents, data_emissao, invoice_id')
    .eq('estoque_pendente', true)
    .order('data_emissao', { ascending: false })
    .limit(500)
  if (error) throw new Error(error.message)
  type Linha = {
    id: string; chave: string; numero: string | null; emitente: string | null
    valor_cents: number; data_emissao: string | null; invoice_id: string | null
  }
  return ((data ?? []) as Linha[]).map((l) => ({
    id: l.id,
    chave: l.chave,
    numero: l.numero,
    emitente: l.emitente,
    valor: (l.valor_cents ?? 0) / 100,
    dataEmissao: l.data_emissao,
    invoiceId: l.invoice_id,
  }))
}

export type ResultadoEntrada = {
  chave: string
  ok: boolean
  detalhe: string
}

export type ProgressoLote = { feitas: number; total: number; atual: string }

/**
 * Dá entrada no estoque das notas cujo financeiro já entrou.
 *
 * Sequencial de propósito: cada nota pode CRIAR item, e a próxima precisa enxergar isso pra
 * casar em vez de duplicar. Em paralelo, duas notas do mesmo fornecedor com o mesmo produto
 * criariam dois itens — a duplicata que já custou caro.
 *
 * Erro numa nota NÃO derruba o lote: entra na lista de falhas e a carga segue. Um lote inteiro
 * já caiu por rollback de uma única violação de índice, e o erro não apareceu no log.
 */
export async function darEntradaLote(
  notas: NotaEstoquePendente[],
  onProgresso?: (p: ProgressoLote) => void,
): Promise<ResultadoEntrada[]> {
  const c = client()
  const resultados: ResultadoEntrada[] = []
  let stock = await listStockItems(true)

  for (const [i, nota] of notas.entries()) {
    onProgresso?.({ feitas: i, total: notas.length, atual: nota.emitente ?? nota.chave.slice(-8) })
    try {
      if (!nota.invoiceId) throw new Error('nota sem vínculo com a compra')

      const { data: doc, error: docErr } = await c
        .from('sefaz_documentos').select('xml').eq('id', nota.id).maybeSingle()
      if (docErr) throw new Error(docErr.message)
      const xml = (doc as { xml?: string } | null)?.xml
      if (!xml) throw new Error('XML não está guardado')

      const parsed = parseNfeXml(xml)
      const r = await darEntradaItensNfe(
        parsed,
        nota.invoiceId,
        suggestItemPlan(parsed, stock),
        // Ninguém olhou a nota antes de ela entrar: o que virar produto novo fica marcado.
        { needsReview: true },
      )

      const { error: updErr } = await c
        .from('sefaz_documentos')
        .update({ estoque_pendente: false, updated_at: new Date().toISOString() })
        .eq('id', nota.id)
      if (updErr) throw new Error(updErr.message)

      resultados.push({
        chave: nota.chave,
        ok: true,
        detalhe: `${r.itemsStocked} entrada(s), ${r.itemsCreated} produto(s) novo(s)`,
      })
      // Só relê o catálogo quando a nota pode tê-lo mudado.
      if (r.itemsCreated > 0) stock = await listStockItems(true)
    } catch (e) {
      resultados.push({
        chave: nota.chave,
        ok: false,
        detalhe: (e instanceof Error ? e.message : String(e)).slice(0, 140),
      })
    }
  }
  onProgresso?.({ feitas: notas.length, total: notas.length, atual: '' })
  return resultados
}
