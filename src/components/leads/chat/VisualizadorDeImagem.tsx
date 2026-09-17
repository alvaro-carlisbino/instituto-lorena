import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ImagemDaConversa = {
  id: string
  src: string
  legenda?: string
  /** Quem mandou e quando, para a legenda do visualizador. */
  rodape?: string
}

/**
 * Foto da conversa abre AQUI, por cima do chat (17/set/2026). Antes o clique abria a imagem numa
 * aba nova: a atendente perdia a conversa de vista para ver o documento que a paciente mandou e
 * tinha de voltar de aba em aba. Setas (ou ← →) passam pelas outras fotos da mesma conversa.
 */
export function VisualizadorDeImagem({
  imagens,
  indice,
  onIndice,
  onFechar,
}: {
  imagens: ImagemDaConversa[]
  indice: number | null
  onIndice: (i: number) => void
  onFechar: () => void
}) {
  const aberto = indice !== null && indice >= 0 && indice < imagens.length
  const atual = aberto ? imagens[indice] : null
  const temAnterior = aberto && indice > 0
  const temProxima = aberto && indice < imagens.length - 1
  const [baixando, setBaixando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && temAnterior) onIndice(indice - 1)
      if (e.key === 'ArrowRight' && temProxima) onIndice(indice + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto, indice, temAnterior, temProxima, onIndice])

  const baixar = async () => {
    if (!atual) return
    setBaixando(true)
    try {
      // Link assinado é de outro domínio e o atributo `download` seria ignorado: baixa como blob.
      const blob = await fetch(atual.src).then((r) => r.blob())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const ext = (blob.type.split('/')[1] || 'jpg').split(';')[0]
      a.href = url
      a.download = `foto-${atual.id.slice(0, 8)}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch {
      window.open(atual.src, '_blank', 'noopener')
    } finally {
      setBaixando(false)
    }
  }

  return (
    <DialogPrimitive.Root open={aberto} onOpenChange={(o) => (!o ? onFechar() : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col outline-none"
          aria-label={atual?.legenda ? `Foto: ${atual.legenda}` : 'Foto da conversa'}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-white sm:px-5">
            <span className="text-xs tabular-nums text-white/70">
              {aberto && imagens.length > 1 ? `${indice + 1} de ${imagens.length}` : ''}
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => void baixar()}
                disabled={!atual || baixando}
              >
                <Download className="size-4" aria-hidden />
                <span className="hidden sm:inline">{baixando ? 'Baixando…' : 'Baixar'}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-white hover:bg-white/10 hover:text-white"
                onClick={() => atual && window.open(atual.src, '_blank', 'noopener')}
                disabled={!atual}
                title="Abrir em nova aba"
              >
                <ExternalLink className="size-4" aria-hidden />
                <span className="hidden sm:inline">Nova aba</span>
              </Button>
              <DialogPrimitive.Close
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-white hover:bg-white/10 hover:text-white"
                    aria-label="Fechar"
                  />
                }
              >
                <XIcon className="size-5" aria-hidden />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16"
            onClick={(e) => {
              // Clique no fundo (fora da foto) fecha, como no WhatsApp Web.
              if (e.target === e.currentTarget) onFechar()
            }}
          >
            {temAnterior ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Foto anterior"
                className="absolute left-1 top-1/2 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white sm:left-4"
                onClick={() => onIndice(indice - 1)}
              >
                <ChevronLeft className="size-6" aria-hidden />
              </Button>
            ) : null}
            {atual ? (
              <img
                key={atual.id}
                src={atual.src}
                alt={atual.legenda || 'Foto da conversa'}
                className="max-h-full max-w-full select-none rounded-md object-contain"
              />
            ) : null}
            {temProxima ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Próxima foto"
                className="absolute right-1 top-1/2 size-10 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white sm:right-4"
                onClick={() => onIndice(indice + 1)}
              >
                <ChevronRight className="size-6" aria-hidden />
              </Button>
            ) : null}
          </div>

          <div className={cn('shrink-0 px-4 pb-4 pt-2 text-center text-white', !atual?.legenda && !atual?.rodape && 'pb-3')}>
            {atual?.legenda ? <p className="m-0 whitespace-pre-wrap text-sm">{atual.legenda}</p> : null}
            {atual?.rodape ? <p className="m-0 mt-1 text-xs text-white/60">{atual.rodape}</p> : null}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
