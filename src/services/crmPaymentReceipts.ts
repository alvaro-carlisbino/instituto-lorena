import { supabase } from '@/lib/supabaseClient'

// Comprovantes de pagamento (tabela payment_receipts + bucket crm-lead-attachments).
// A SDR anexa o arquivo (foto/PDF) a um pagamento; o tenant_id é preenchido pela
// RLS (default current_tenant_id()), então não vaza entre polos.

const BUCKET = 'crm-lead-attachments'

export type PaymentReceiptRow = {
  id: string
  paymentId: string
  paymentMethod: string
  source: 'manual' | 'auto'
  storagePath: string | null
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
  note: string | null
  autoData: Record<string, unknown> | null
  createdAt: string
}

const RECEIPT_COLS = 'id, payment_id, payment_method, source, storage_path, file_name, mime_type, file_size, note, auto_data, created_at'

function mapRow(r: Record<string, unknown>): PaymentReceiptRow {
  return {
    id: String(r.id),
    paymentId: String(r.payment_id ?? ''),
    paymentMethod: String(r.payment_method ?? 'card'),
    source: r.source === 'auto' ? 'auto' : 'manual',
    storagePath: r.storage_path != null ? String(r.storage_path) : null,
    fileName: r.file_name != null ? String(r.file_name) : null,
    mimeType: r.mime_type != null ? String(r.mime_type) : null,
    fileSize: r.file_size != null && Number.isFinite(Number(r.file_size)) ? Number(r.file_size) : null,
    note: r.note != null ? String(r.note) : null,
    autoData: r.auto_data && typeof r.auto_data === 'object' ? (r.auto_data as Record<string, unknown>) : null,
    createdAt: String(r.created_at ?? ''),
  }
}

export async function fetchReceiptsForPayments(paymentIds: string[]): Promise<PaymentReceiptRow[]> {
  if (!supabase || paymentIds.length === 0) return []
  const { data, error } = await supabase
    .from('payment_receipts')
    .select(RECEIPT_COLS)
    .in('payment_id', paymentIds)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function uploadPaymentReceipt(
  paymentId: string,
  file: File,
  note?: string,
  paymentMethod: 'card' | 'pix' = 'card',
): Promise<PaymentReceiptRow> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `payment-receipts/${paymentId}/${Date.now()}-${safe}`
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
  })
  if (upErr) throw new Error(upErr.message)
  const { data, error } = await supabase
    .from('payment_receipts')
    .insert({
      payment_id: paymentId,
      payment_method: paymentMethod,
      source: 'manual',
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
      ...(note?.trim() ? { note: note.trim() } : {}),
    })
    .select(RECEIPT_COLS)
    .single()
  if (error) {
    // evita órfão no storage se o insert falhar (ex.: RLS)
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(error.message)
  }
  return mapRow(data as Record<string, unknown>)
}

export async function getReceiptSignedUrl(storagePath: string, expires = 3600): Promise<string> {
  if (!supabase) throw new Error('Sistema não configurado.')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expires)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Falha ao gerar link do comprovante.')
  return data.signedUrl
}

export async function deletePaymentReceipt(id: string, storagePath: string | null): Promise<void> {
  if (!supabase) throw new Error('Sistema não configurado.')
  if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
  const { error } = await supabase.from('payment_receipts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
