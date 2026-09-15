import { useEffect, useRef, useState } from 'react'
import { Camera, ScanBarcode } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BarcodeCameraDialog } from '@/components/estoque/BarcodeCameraDialog'
import { cn } from '@/lib/utils'

/**
 * Leitor USB em modo teclado: "digita" o código muito rápido e manda Enter. Em vez de prender
 * o foco num campo (o que abria o teclado no celular e roubava o clique de quem ia ajustar uma
 * quantidade), escuta a tela inteira e só aceita rajada rápida. Digitação humana num campo
 * qualquer não dispara, porque o intervalo entre teclas é bem maior.
 */
function useLeitorUsb(onCode: (code: string) => void, ativo: boolean) {
  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  }, [onCode])

  useEffect(() => {
    if (!ativo) return
    let buffer = ''
    let ultimaTecla = 0
    const handler = (e: KeyboardEvent) => {
      // O campo de bipar trata o próprio Enter.
      if ((e.target as HTMLElement | null)?.closest('[data-scan-input="true"]')) return
      // Leitor manda Shift antes de letra maiúscula (Code 128): não pode zerar a rajada.
      if (e.key === 'Shift' || e.key === 'CapsLock') return
      const agora = performance.now()
      const intervalo = agora - ultimaTecla
      ultimaTecla = agora
      if (e.key === 'Enter') {
        const code = buffer
        buffer = ''
        if (code.length >= 4 && intervalo < 80) {
          e.preventDefault()
          onCodeRef.current(code)
        }
        return
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        buffer = ''
        return
      }
      // Qualquer pausa de gente digitando recomeça: só rajada de leitor chega ao Enter inteira.
      if (intervalo > 45) buffer = ''
      buffer += e.key
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [ativo])
}

export function ScanBar({
  onCode,
  placeholder = 'Bipe ou digite o código',
  ultimaLeitura,
  disabled,
  className,
}: {
  onCode: (code: string) => void
  placeholder?: string
  ultimaLeitura?: string | null
  disabled?: boolean
  className?: string
}) {
  const [codigo, setCodigo] = useState('')
  const [camera, setCamera] = useState(false)

  useLeitorUsb(onCode, !disabled && !camera)

  const enviar = () => {
    const c = codigo.trim()
    if (!c) return
    setCodigo('')
    onCode(c)
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative min-w-0 flex-1">
        <ScanBarcode
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          data-scan-input="true"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              enviar()
            }
          }}
          placeholder={placeholder}
          aria-label="Código de barras"
          inputMode="text"
          autoComplete="off"
          disabled={disabled}
          className="h-10 pl-9 text-base sm:text-sm"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-10 shrink-0 gap-1.5 px-3"
        onClick={() => setCamera(true)}
        disabled={disabled}
        aria-label="Ler pela câmera"
      >
        <Camera className="size-4" aria-hidden />
        <span className="hidden min-[400px]:inline">Câmera</span>
      </Button>
      <BarcodeCameraDialog
        open={camera}
        onOpenChange={setCamera}
        onScan={onCode}
        continuous
        ultimaLeitura={ultimaLeitura}
      />
    </div>
  )
}
