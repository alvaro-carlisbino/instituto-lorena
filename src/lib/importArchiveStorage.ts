import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'

/** Guarda cópia do ficheiro importado no Storage (bucket `crm-imports`). Ignora se não houver sessão. */
export async function archiveImportFileToStorage(file: File, kind: 'csv' | 'json'): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return
  const { data: sessionData } = await supabase.auth.getSession()
  const uid = sessionData.session?.user?.id
  if (!uid) return

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload'
  const path = `${uid}/${kind}/${Date.now()}-${safe}`
  const contentType =
    file.type ||
    (kind === 'csv' ? 'text/csv' : 'application/json')

  const { error } = await supabase.storage.from('crm-imports').upload(path, file, {
    contentType,
    upsert: false,
  })
  if (error) throw error
}
