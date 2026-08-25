/**
 * Regras puras sobre a mídia do chat — sem Supabase, sem React, para poderem ser testadas
 * sozinhas. O que decide o TIPO decide também como a mensagem chega: mandar um áudio pela
 * rota de documento faz a paciente receber um ficheiro para baixar em vez da bolha de voz
 * que ela sabe tocar.
 */

export type ChatMediaKind = 'image' | 'video' | 'audio' | 'document'

export function kindFromMime(mimeType: string, fileName = ''): ChatMediaKind {
  const mime = (mimeType || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  // Sem mime (acontece com ficheiro arrastado de certos gestores), a extensão decide.
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? ''
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image'
  if (['mp4', 'mov', 'm4v', '3gp'].includes(ext)) return 'video'
  if (['ogg', 'opus', 'mp3', 'm4a', 'wav'].includes(ext)) return 'audio'
  return 'document'
}

/**
 * O texto da bolha é só o marcador que pusemos porque a mídia veio sem legenda
 * ("📷 Foto", "🎤 Áudio"). Ao encaminhar, isso não pode virar uma mensagem de texto sozinha
 * do outro lado — a foto já vai junto, e "📷 Foto" solto não quer dizer nada.
 */
export function isMediaOnlyLabel(content: string): boolean {
  const t = (content ?? '').trim()
  return /^(📷|🎬|🎥|🎤|📎|🎭|🎞️|🌟|📍|👤)\s*\S*$/u.test(t)
}

/** Nome de ficheiro seguro para o Storage (que recusa acento, espaço e barra). */
export function nomeSeguroDeArquivo(nome: string): string {
  const limpo = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    // Nome que era só barra/acento vira uma fieira de hífens: isso não é nome, é lixo.
    .replace(/^[-._]+|[-._]+$/g, '')
  // Fica com o FIM do nome, não o começo: é onde vive a extensão, e é ela que faz o
  // WhatsApp mostrar ícone de PDF em vez de "arquivo".
  return limpo.slice(-80) || 'arquivo'
}
