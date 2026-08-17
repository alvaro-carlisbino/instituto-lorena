import { supabase } from '@/lib/supabaseClient'

/**
 * Conciliação automática: quem sabe se a nota foi paga é o extrato, e ele já está aqui.
 *
 * A SEFAZ entra sozinha (`crm-sefaz-sync`) e o extrato do banco entra sozinho
 * (`crm-banco-mcp-sync-job`). As duas pontas nunca se encostavam: sobravam 277 parcelas em
 * aberto somando R$ 313 mil que em boa parte já tinham saído da conta. Isso não é só número
 * feio na tela — é despesa contada duas vezes no DRE (a parcela E o lançamento do banco).
 *
 * O casamento roda no BANCO, por cron (migration 20260817190000). Este módulo só abre as
 * portas: rodar agora, ver o que o motor fez, conferir o que ele se recusou a decidir e
 * desfazer. Nada aqui reimplementa o casamento — ter duas implementações da mesma cascata é
 * o que já criou item duplicado no estoque.
 */

function assertClient() {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

/** `alta` = o nome do fornecedor aparece no extrato. `media` = só valor e data, par único. */
export type Confianca = 'alta' | 'media'

export type ConciliacaoAuto = {
  parcelaId: string
  confianca: Confianca
  amountCents: number
  vencimento: string
  pagoEm: string | null
  fornecedor: string
  extrato: string
  /** null no dry-run: ainda não aconteceu. */
  conciliadoEm: string | null
}

export type ConciliacaoPendente = {
  parcelaId: string
  transacaoId: string
  motivo: string
  amountCents: number
  amountExtratoCents: number
  vencimento: string
  dataExtrato: string
  dias: number
  fornecedor: string
  extrato: string
}

const asConfianca = (v: unknown): Confianca => (v === 'alta' ? 'alta' : 'media')

/**
 * Roda o motor no polo de quem está logado.
 *
 * `previa` devolve o que ele FARIA sem escrever nada — é o que a tela mostra antes de
 * alguém apertar o botão. O cron roda a versão que escreve, de hora em hora.
 */
export async function conciliarAuto(previa: boolean): Promise<ConciliacaoAuto[]> {
  const { data, error } = await assertClient().rpc('crm_conciliar_auto_ui', { p_dry_run: previa })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    parcelaId: String(r.parcela_id ?? ''),
    confianca: asConfianca(r.confianca),
    amountCents: Number(r.valor_cents ?? 0),
    vencimento: String(r.vencimento ?? ''),
    pagoEm: r.pago_em != null ? String(r.pago_em) : null,
    fornecedor: String(r.fornecedor ?? ''),
    extrato: String(r.extrato ?? ''),
    conciliadoEm: null,
  }))
}

/** O que o motor já deu por pago. Baixa em massa sem lista pra conferir é baixa que ninguém confere. */
export async function listConciliadasAuto(limite = 200): Promise<ConciliacaoAuto[]> {
  const { data, error } = await assertClient().rpc('crm_conciliacao_automaticas', { p_limite: limite })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    parcelaId: String(r.parcela_id ?? ''),
    confianca: asConfianca(r.confianca),
    amountCents: Number(r.valor_cents ?? 0),
    vencimento: String(r.vencimento ?? ''),
    pagoEm: r.pago_em != null ? String(r.pago_em) : null,
    fornecedor: String(r.fornecedor ?? ''),
    extrato: String(r.extrato ?? ''),
    conciliadoEm: r.conciliado_em != null ? String(r.conciliado_em) : null,
  }))
}

/** Os pares que o motor se recusou a carimbar: empate por valor, ou mesmo fornecedor com valor diferente. */
export async function listConciliacaoPendentes(): Promise<ConciliacaoPendente[]> {
  const { data, error } = await assertClient().rpc('crm_conciliacao_pendentes')
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    parcelaId: String(r.parcela_id ?? ''),
    transacaoId: String(r.transacao_id ?? ''),
    motivo: String(r.motivo ?? ''),
    amountCents: Number(r.valor_cents ?? 0),
    amountExtratoCents: Number(r.valor_extrato_cents ?? 0),
    vencimento: String(r.vencimento ?? ''),
    dataExtrato: String(r.data_extrato ?? ''),
    dias: Number(r.dias ?? 0),
    fornecedor: String(r.fornecedor ?? ''),
    extrato: String(r.extrato ?? ''),
  }))
}

/** Confirma um par da fila. Usa a data do BANCO como data de pagamento, igual ao motor. */
export async function confirmarConciliacao(parcelaId: string, transacaoId: string): Promise<boolean> {
  const { data, error } = await assertClient().rpc('crm_conciliacao_confirmar', {
    p_parcela: parcelaId,
    p_transacao: transacaoId,
  })
  if (error) throw new Error(error.message)
  // `false` = o lançamento já foi usado por outra parcela enquanto a tela estava aberta.
  return Boolean(data)
}

/** Volta a parcela pra aberto e solta o lançamento do extrato. */
export async function desfazerConciliacao(parcelaId: string): Promise<void> {
  const { error } = await assertClient().rpc('crm_conciliacao_desfazer', { p_parcela: parcelaId })
  if (error) throw new Error(error.message)
}
