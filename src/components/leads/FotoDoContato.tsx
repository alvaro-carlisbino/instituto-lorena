import { useState } from 'react'

/** Foto de perfil do WhatsApp do contato; sem foto ou link expirado, não desenha nada (ficam as iniciais). */
export function FotoDoContato({ url, nome, className }: { url: string | null; nome: string; className?: string }) {
  const [falhou, setFalhou] = useState<string | null>(null)
  if (!url || falhou === url) return null
  return (
    <img
      src={url}
      alt={`Foto de ${nome}`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFalhou(url)}
      className={className}
    />
  )
}
