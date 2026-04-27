import { supabase } from '@/lib/supabaseClient'

export type LeadTaskAttachmentRow = {
  id: string
  leadTaskId: string
  storagePath: string
  fileName: string
  mimeType: string | null
  fileSize: number | null
  createdAt: string
}

function mapRow(r: Record<string, unknown>): LeadTaskAttachmentRow {
  return {
    id: String(r.id),
    leadTaskId: String(r.lead_task_id),
    storagePath: String(r.storage_path),
    fileName: String(r.file_name ?? ''),
    mimeType: r.mime_type != null ? String(r.mime_type) : null,
    fileSize: r.file_size != null && Number.isFinite(Number(r.file_size)) ? Number(r.file_size) : null,
    createdAt: String(r.created_at ?? ''),
  }
}

export async function fetchAttachmentsForTaskIds(taskIds: string[]): Promise<LeadTaskAttachmentRow[]> {
  if (!supabase || taskIds.length === 0) return []
  const { data, error } = await supabase
    .from('lead_task_attachments')
    .select('id, lead_task_id, storage_path, file_name, mime_type, file_size, created_at')
    .in('lead_task_id', taskIds)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function uploadTaskAttachment(
  leadTaskId: string,
  file: File,
): Promise<LeadTaskAttachmentRow> {
  if (!supabase) throw new Error('Não configurado')
  const path = `${leadTaskId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  const { error: upErr } = await supabase.storage.from('crm-lead-attachments').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
  })
  if (upErr) throw new Error(upErr.message)
  const { data, error } = await supabase
    .from('lead_task_attachments')
    .insert({
      lead_task_id: leadTaskId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      file_size: file.size,
    })
    .select('id, lead_task_id, storage_path, file_name, mime_type, file_size, created_at')
    .single()
  if (error) throw new Error(error.message)
  return mapRow(data as Record<string, unknown>)
}

export async function getAttachmentSignedUrl(storagePath: string, expires = 3600): Promise<string> {
  if (!supabase) throw new Error('Não configurado')
  const { data, error } = await supabase.storage.from('crm-lead-attachments').createSignedUrl(storagePath, expires)
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'signed_url')
  return data.signedUrl
}

export async function deleteTaskAttachmentRow(id: string, storagePath: string): Promise<void> {
  if (!supabase) throw new Error('Não configurado')
  const { error: sErr } = await supabase.storage.from('crm-lead-attachments').remove([storagePath])
  if (sErr) throw new Error(sErr.message)
  const { error } = await supabase.from('lead_task_attachments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
