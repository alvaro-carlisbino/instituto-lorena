export type NoticeVariant = 'default' | 'success' | 'warning'

export function noticeVariantFromMessage(message: string): NoticeVariant {
  const m = message.trim().toLowerCase()
  if (!m) return 'default'
  if (/falha|erro|sem permiss|não |nao |inválid|invalid/.test(m)) return 'warning'
  if (/sucesso|criad|enviad|atualiz|convite|acess|perfil/.test(m)) return 'success'
  return 'default'
}
