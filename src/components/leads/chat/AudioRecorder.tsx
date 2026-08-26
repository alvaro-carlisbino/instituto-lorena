import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Mic, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Props = {
  /** Recebe o áudio gravado como File, pronto para subir. */
  onRecorded: (file: File) => void
  disabled?: boolean
}

/** Formato que o browser grava. A caixa certa para o WhatsApp é feita no upload (audioOpus.ts). */
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
 * Abaixo disto o microfone não captou voz, captou o chão de ruído da sala. Voz normal fica
 * entre 0,05 e 0,2 de RMS; sala em silêncio fica na casa de 0,001. Medido em duas gravações
 * mudas reais (26/ago/26): pico de -45 dB e -56 dB, ou seja 0,006 e 0,002.
 */
const LIMIAR_DE_SILENCIO = 0.01

const CHAVE_MICROFONE = 'crm.chat.microfone'

/**
 * Mensagem de VOZ, gravada aqui. É o que mais falta a quem atende pelo CRM: metade do
 * atendimento por WhatsApp acontece em áudio, e sem isto a atendente pegava o telemóvel
 * para gravar, e essa mensagem nunca entrava no histórico do lead (a linha LITE da W-API
 * não lê o que sai pelo aparelho; ver crm_wapi_lite_nao_le_historico).
 *
 * **Por que existe medidor de nível.** No primeiro dia de uso saíram duas mensagens de voz
 * mudas: o navegador gravou, o ficheiro subiu, a W-API entregou, e não havia som nenhum
 * dentro (o microfone escolhido pelo sistema não era o que a pessoa estava a falar). Nada
 * na tela dizia isso. Agora a barra mexe enquanto grava, e uma gravação que não passou do
 * chão de ruído avisa antes de sair, com a lista de microfones para trocar.
 */
export function AudioRecorder({ onRecorded, disabled }: Props) {
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [nivel, setNivel] = useState(0)
  const [previa, setPrevia] = useState<{ url: string; file: File; mudo: boolean } | null>(null)
  const [microfones, setMicrofones] = useState<MediaDeviceInfo[]>([])
  const [microfoneId, setMicrofoneId] = useState<string>(
    () => localStorage.getItem(CHAVE_MICROFONE) ?? '',
  )
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tickRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const picoRef = useRef(0)

  const pararRelogio = () => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  const pararMedidor = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setNivel(0)
  }

  const soltarMicrofone = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  useEffect(() => {
    return () => {
      pararRelogio()
      pararMedidor()
      soltarMicrofone()
      if (previa) URL.revokeObjectURL(previa.url)
    }
    // Só na desmontagem: limpar em cada mudança de `previa` revogaria a URL em uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** A lista de microfones só traz NOME depois de o utilizador autorizar o microfone uma vez. */
  const carregarMicrofones = async () => {
    try {
      const todos = await navigator.mediaDevices.enumerateDevices()
      setMicrofones(todos.filter((d) => d.kind === 'audioinput'))
    } catch {
      setMicrofones([])
    }
  }

  /**
   * Mede o som que está a ENTRAR, em tempo real. É o único sinal honesto de que o microfone
   * certo está a ouvir: o `MediaRecorder` grava silêncio sem se queixar.
   */
  const ligarMedidor = (stream: MediaStream) => {
    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const fonte = ctx.createMediaStreamSource(stream)
      const analisador = ctx.createAnalyser()
      analisador.fftSize = 512
      fonte.connect(analisador)
      const amostras = new Float32Array(analisador.fftSize)
      let ultimoDesenho = 0
      const medir = () => {
        analisador.getFloatTimeDomainData(amostras)
        let soma = 0
        for (let i = 0; i < amostras.length; i++) soma += amostras[i] * amostras[i]
        const rms = Math.sqrt(soma / amostras.length)
        if (rms > picoRef.current) picoRef.current = rms
        const agora = performance.now()
        // ~15 quadros por segundo chega para o olho e poupa render.
        if (agora - ultimoDesenho > 66) {
          ultimoDesenho = agora
          setNivel(rms)
        }
        rafRef.current = requestAnimationFrame(medir)
      }
      rafRef.current = requestAnimationFrame(medir)
    } catch {
      /* sem medidor, a gravação continua a funcionar */
    }
  }

  const comecar = async () => {
    if (disabled || gravando) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Este navegador não grava áudio. Use o Chrome ou o Edge.')
      return
    }
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: microfoneId ? { deviceId: { exact: microfoneId } } : true,
        })
      } catch {
        // Microfone guardado já não existe (desligaram o headset): volta ao padrão do sistema.
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        setMicrofoneId('')
        localStorage.removeItem(CHAVE_MICROFONE)
      }
      streamRef.current = stream
      void carregarMicrofones()
      const mime = melhorMimeDeGravacao()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      picoRef.current = 0
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const pico = picoRef.current
        pararMedidor()
        soltarMicrofone()
        const tipo = rec.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: tipo })
        const ext = tipo.includes('ogg') ? 'ogg' : tipo.includes('mp4') ? 'm4a' : 'webm'
        const file = new File([blob], `audio-${Date.now()}.${ext}`, { type: tipo })
        setPrevia({ url: URL.createObjectURL(blob), file, mudo: pico < LIMIAR_DE_SILENCIO })
      }
      recorderRef.current = rec
      ligarMedidor(stream)
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
      pararMedidor()
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

  const trocarMicrofone = (id: string) => {
    setMicrofoneId(id)
    if (id) localStorage.setItem(CHAVE_MICROFONE, id)
    else localStorage.removeItem(CHAVE_MICROFONE)
    descartar()
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
      <div className="flex flex-col gap-1.5">
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1',
            previa.mudo ? 'border-destructive/60' : 'border-border',
          )}
        >
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
          <Button
            type="button"
            size="icon"
            variant={previa.mudo ? 'outline' : 'default'}
            className="size-7"
            onClick={enviar}
            title={previa.mudo ? 'Anexar mesmo assim' : 'Anexar áudio'}
          >
            <Send className="size-4" aria-hidden />
            <span className="sr-only">Anexar áudio à mensagem</span>
          </Button>
        </div>

        {previa.mudo ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              O microfone não captou som.
            </p>
            <p className="mt-0.5 text-destructive/80">
              Sai uma mensagem de voz muda. Troque o microfone e grave de novo.
            </p>
            {microfones.length > 0 ? (
              <select
                className="mt-1.5 w-full rounded border border-destructive/40 bg-background px-1.5 py-1 text-[11px] text-foreground"
                value={microfoneId}
                onChange={(e) => trocarMicrofone(e.target.value)}
                aria-label="Microfone"
              >
                <option value="">Microfone padrão do sistema</option>
                {microfones.map((m, i) => (
                  <option key={m.deviceId || i} value={m.deviceId}>
                    {m.label || `Microfone ${i + 1}`}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  // A barra cresce depressa no começo (raiz quarta) porque a fala útil vive em valores baixos:
  // uma barra linear quase não sai do lugar e não serviria para o que ela existe.
  const larguraDaBarra = Math.min(100, Math.round(Math.pow(Math.min(nivel, 0.3) / 0.3, 0.25) * 100))

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
      {gravando ? (
        <>
          <span className="tabular-nums">{mmss(segundos)}</span>
          <span
            className="h-1.5 w-8 overflow-hidden rounded-full bg-destructive-foreground/25"
            aria-hidden
          >
            <span
              className="block h-full rounded-full bg-destructive-foreground transition-[width] duration-75"
              style={{ width: `${larguraDaBarra}%` }}
            />
          </span>
        </>
      ) : null}
      <span className="sr-only">{gravando ? 'Parar gravação' : 'Gravar mensagem de voz'}</span>
    </Button>
  )
}
