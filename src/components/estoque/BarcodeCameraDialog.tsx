import { useEffect, useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// Leitura de código de barras pela câmera via BarcodeDetector API (Chrome/Android).
// Sem suporte do navegador, o dialog explica e o leitor USB (campo "Bipar") segue
// funcionando. Usado no Estoque e na Bipagem.

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
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
    })
  } catch {
    return null
  }
}

export function BarcodeCameraDialog({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onScan: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    const detector = getBarcodeDetector()
    if (!detector) {
      setError('Este navegador não lê código pela câmera. Use o leitor USB no campo "Bipar código".')
      return
    }
    let stream: MediaStream | null = null
    let timer: number | null = null
    let done = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
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
              if (code && !done) {
                done = true
                onScan(code)
              }
            })
            .catch(() => {
              /* frame ruim — tenta o próximo */
            })
        }, 300)
      })
      .catch(() => setError('Não foi possível acessar a câmera.'))
    return () => {
      done = true
      if (timer) window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ler código de barras</DialogTitle>
          <DialogDescription>Aponte a câmera para o código do produto.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-4 text-sm text-muted-foreground">{error}</p>
        ) : (
          <video ref={videoRef} className="aspect-video w-full rounded-md bg-black" muted playsInline />
        )}
      </DialogContent>
    </Dialog>
  )
}
