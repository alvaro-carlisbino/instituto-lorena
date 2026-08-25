import { File as FileIcon, Music, Video as VideoIcon, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { UploadedChatMedia } from '@/services/crmChat'

export type PendingMedia = UploadedChatMedia & {
  /** Legenda desta peça. Vazia = vai sem legenda (ou herda o texto do compositor). */
  caption: string
  /** Ainda a subir para o Storage. */
  uploading?: boolean
}

type Props = {
  itens: PendingMedia[]
  onRemove: (storagePath: string) => void
  onCaption: (storagePath: string, caption: string) => void
  disabled?: boolean
}

function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * O que está pendurado no compositor antes de sair. Mostra a PRÉ-VISUALIZAÇÃO de verdade
 * (a foto, não um nome de ficheiro) porque anexar a foto errada é um erro que só se vê
 * depois de a paciente receber — e aí já não há como desanexar.
 *
 * Cada peça tem a sua legenda, como no WhatsApp: três fotos com três comentários é uma
 * conversa; três fotos e um bloco de texto no fim é um relatório.
 */
export function AttachmentTray({ itens, onRemove, onCaption, disabled }: Props) {
  if (itens.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-muted/30 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          {itens.length === 1 ? '1 arquivo pronto para enviar' : `${itens.length} arquivos prontos para enviar`}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {itens.map((item) => (
          <div key={item.storagePath} className="flex items-start gap-2 rounded-lg bg-background/70 p-2">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted">
              {item.kind === 'image' ? (
                <img src={item.previewUrl} alt={item.fileName} className="h-full w-full object-cover" />
              ) : item.kind === 'video' ? (
                <video src={item.previewUrl} className="h-full w-full object-cover" muted />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  {item.kind === 'audio' ? <Music className="size-5" aria-hidden /> : <FileIcon className="size-5" aria-hidden />}
                </div>
              )}
              {item.uploading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-[10px] font-medium">
                  enviando…
                </div>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium" title={item.fileName}>
                  {item.fileName}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {tamanhoLegivel(item.sizeBytes)}
                </span>
              </div>
              <Input
                value={item.caption}
                onChange={(e) => onCaption(item.storagePath, e.target.value)}
                placeholder={item.kind === 'audio' ? 'Áudio vai sem legenda' : 'Legenda (opcional)'}
                disabled={disabled || item.kind === 'audio'}
                className="h-7 text-xs"
                aria-label={`Legenda de ${item.fileName}`}
              />
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(item.storagePath)}
              disabled={disabled}
              title="Remover anexo"
            >
              <X className="size-4" aria-hidden />
              <span className="sr-only">Remover {item.fileName}</span>
            </Button>
          </div>
        ))}
      </div>
      {itens.some((i) => i.kind === 'video') ? (
        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <VideoIcon className="size-3" aria-hidden />
          Vídeo acima de 16 MB o WhatsApp recusa — mande o link em vez do arquivo.
        </p>
      ) : null}
    </div>
  )
}
