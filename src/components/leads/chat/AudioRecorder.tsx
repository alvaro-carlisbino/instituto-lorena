import { useEffect, useRef, useState } from 'react'
import { Mic, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  /** Recebe o áudio gravado como File, pronto para subir. */
  onRecorded: (file: File) => void
  disabled?: boolean
}

/** Formato que o browser grava E o WhatsApp toca. Ogg/Opus é o nativo da mensagem de voz. */
function melhorMimeDeGravacao(): string {
  const candidatos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  for (const c of candidatos) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

function mmss(segundos: number): string {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Mensagem de VOZ, gravada aqui. É o que mais falta a quem atende pelo CRM: metade do
 * atendimento por WhatsApp acontece em áudio, e sem isto a atendente pegava o telemóvel
 * para gravar — e essa mensagem nunca entrava no histórico do lead (a linha LITE da W-API
 * não lê o que sai pelo aparelho; ver crm_wapi_lite_nao_le_historico).
 *
 * Grava, deixa ouvir antes de mandar, e só solta o microfone quando a gravação termina —
 * um `getUserMedia` esquecido aberto deixa a luz da câmera/mic acesa e assusta.
 */
export function AudioRecorder({ onRecorded, disabled }: Props) {
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [previa, setPrevia] = useState<{ url: string; file: File } | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tickRef = useRef<number | null>(null)

  const pararRelogio = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  const soltarMicrofone = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    return () => {
      pararRelogio()
      soltarMicrofone()
      if (previa) URL.revokeObjectURL(previa.url)
    }
    // Só na desmontagem: limpar em cada mudança de `previa` revogaria a URL em uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const comecar = async () => {
    if (disabled || gravando) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Este navegador não grava áudio. Use o Chrome ou o Edge.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = melhorMimeDeGravacao()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        soltarMicrofone()
        const tipo = rec.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: tipo })
        const ext = tipo.includes('ogg') ? 'ogg' : tipo.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: tipo })
        setPrevia({ url: URL.createObjectURL(blob), file })
      }
      recorderRef.current = rec
      rec.start()
      setGravando(true)
      setSegundos(0)
      tickRef.current = window.setInterval(() => {
        setSegundos((s) => {
          // O WhatsApp aceita mais, mas áudio de atendimento acima de 5 min ninguém ouve.
          if (s >= 300) {
            recorderRef.current?.stop()
            setGravando(false)
            pararRelogio()
          }
          return s + 1
        })
      }, 1000)
    } catch {
      toast.error('Sem acesso ao microfone. Autorize no cadeado da barra de endereço.')
      soltarMicrofone()
    }
  }

  const parar = () => {
    if (!gravando) return
    recorderRef.current?.stop()
    setGravando(false)
    pararRelogio()
  }

  const descartar = () => {
    if (previa) URL.revokeObjectURL(previa.url)
    setPrevia(null)
    setSegundos(0)
  }

  const enviar = () => {
    if (!previa) return
    onRecorded(previa.file)
    URL.revokeObjectURL(previa.url)
    setPrevia(null)
    setSegundos(0)
  }

  if (previa) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1">
        <audio src={previa.url} controls className="h-7 max-w-[10rem]" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          onClick={descartar}
          title="Descartar gravação"
        >
          <Trash2 className="size-4" aria-hidden />
          <span className="sr-only">Descartar gravação</span>
        </Button>
        <Button type="button" size="icon" className="size-7" onClick={enviar} title="Anexar áudio">
          <Send className="size-4" aria-hidden />
          <span className="sr-only">Anexar áudio à mensagem</span>
        </Button>
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant={gravando ? 'destructive' : 'ghost'}
      size="sm"
      className={cn('h-8 rounded-lg px-2 text-[10px]', gravando && 'gap-1.5')}
      disabled={disabled}
      onClick={() => (gravando ? parar() : void comecar())}
      title={gravando ? 'Parar gravação' : 'Gravar áudio'}
    >
      <Mic className={cn('size-4', gravando && 'animate-pulse')} aria-hidden />
      {gravando ? <span className="tabular-nums">{mmss(segundos)}</span> : null}
      <span className="sr-only">{gravando ? 'Parar gravação' : 'Gravar mensagem de voz'}</span>
    </Button>
  )
}
