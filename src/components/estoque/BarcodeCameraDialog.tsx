import { useEffect, useRef, useState } from 'react'
import { ScanBarcode } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Leitura de código de barras pela câmera via BarcodeDetector API (Chrome/Android).
// Sem suporte do navegador, o dialog explica e o leitor USB segue funcionando.
// Usado no Estoque, na Bipagem e nos Kits.

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}

function getBarcodeDetector(): BarcodeDetectorLike | null {
  const w = window as unknown as {
    BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike
  }
  if (!w.BarcodeDetector) return null
  try {
    return new w.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'],
    })
  } catch {
    return null
  }
}

/** O mesmo código parado na frente da câmera não pode contar de novo a cada 300ms. */
const INTERVALO_MESMO_CODIGO_MS = 1800

export function BarcodeCameraDialog({
  open,
  onOpenChange,
  onScan,
  continuous = false,
  ultimaLeitura,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (code: string) => void
  /** Mantém a câmera aberta e segue lendo: montar ou devolver kit é bipar item atrás de item. */
  continuous?: boolean
  /** Texto do último item lido, para quem está com o celular na mão ver sem fechar a câmera. */
  ultimaLeitura?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const onScanRef = useRef(onScan)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!open) return
    const detector = getBarcodeDetector()
    let stream: MediaStream | null = null
    let timer: number | null = null
    let done = false
    let ultimo = { code: '', at: 0 }
    const falhar = (msg: string) => window.setTimeout(() => !done && setError(msg), 0)
    if (!detector) {
      falhar('Este navegador não lê código pela câmera (o iPhone ainda não suporta). Use o leitor USB ou digite o código.')
      return () => {
        done = true
      }
    }
    window.setTimeout(() => !done && setError(null), 0)
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (done) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) {
          videoRef.current.srcObject = s
          void videoRef.current.play()
        }
        timer = window.setInterval(() => {
          const video = videoRef.current
          if (done || !video || video.readyState < 2) return
          detector
            .detect(video)
            .then((codes) => {
              const code = codes[0]?.rawValue?.trim()
              if (!code || done) return
              const agora = Date.now()
              if (code === ultimo.code && agora - ultimo.at < INTERVALO_MESMO_CODIGO_MS) return
              ultimo = { code, at: agora }
              if (!continuous) done = true
              onScanRef.current(code)
            })
            .catch(() => {
              /* frame ruim, tenta o próximo */
            })
        }, 300)
      })
      .catch(() => falhar('Não foi possível acessar a câmera. Confira a permissão do navegador.'))
    return () => {
      done = true
      if (timer) window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open, continuous])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ler código de barras</DialogTitle>
          <DialogDescription>
            {continuous
              ? 'Aponte para cada produto. A câmera continua aberta até você concluir.'
              : 'Aponte a câmera para o código do produto.'}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-4 text-sm text-muted-foreground">{error}</p>
        ) : (
          <video ref={videoRef} className="aspect-[4/3] w-full rounded-md bg-black object-cover" muted playsInline />
        )}
        {continuous ? (
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-1.5 text-sm">
              <ScanBarcode className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{ultimaLeitura || 'Nenhuma leitura ainda'}</span>
            </p>
            <Button onClick={() => onOpenChange(false)}>Concluir</Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
