import { useMemo, useState } from 'react'
import { Forward } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { cn } from '@/lib/utils'

export type ForwardTarget = { id: string; name: string; phone: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Quantas mensagens vão ser encaminhadas (para o texto do botão). */
  quantidade: number
  /** Conversas candidatas, já sem a atual. */
  destinos: ForwardTarget[]
  enviando: boolean
  onConfirm: (leadIds: string[]) => void
}

const normalizar = (v: string) =>
  v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Teto por encaminhamento. O WhatsApp trata disparo para muita gente como spam. */
const MAX_DESTINOS = 5

/**
 * Para quem vai o encaminhamento.
 *
 * A W-API não tem rota de encaminhar: o que fazemos é REENVIAR o conteúdo para a outra
 * conversa. Para quem recebe é a mesma coisa (chega o texto, chega a foto); o que não
 * aparece é o selo "Encaminhada" do WhatsApp. No nosso histórico a bolha fica marcada,
 * senão daqui a um mês ninguém sabe que aquilo não foi escrito ali.
 *
 * O teto de cinco destinos não é enfeite: reenviar a mesma mensagem para muita gente de
 * uma vez é exatamente o padrão que o WhatsApp usa para identificar disparo em massa, e
 * quem paga é o número da clínica.
 */
export function ForwardDialog({ open, onOpenChange, quantidade, destinos, enviando, onConfirm }: Props) {
  const [termo, setTermo] = useState('')
  const [escolhidos, setEscolhidos] = useState<string[]>([])

  const filtrados = useMemo(() => {
    const t = normalizar(termo.trim())
    const base = t
      ? destinos.filter((d) => normalizar(`${d.name} ${d.phone}`).includes(t))
      : destinos
    return base.slice(0, 60)
  }, [destinos, termo])

  const alternar = (id: string) => {
    setEscolhidos((atuais) => {
      if (atuais.includes(id)) return atuais.filter((x) => x !== id)
      if (atuais.length >= MAX_DESTINOS) return atuais
      return [...atuais, id]
    })
  }

  const fechar = (aberto: boolean) => {
    if (!aberto) {
      setTermo('')
      setEscolhidos([])
    }
    onOpenChange(aberto)
  }

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar {quantidade === 1 ? 'mensagem' : `${quantidade} mensagens`}</DialogTitle>
          <DialogDescription>
            O conteúdo é reenviado para a conversa escolhida. Máximo de {MAX_DESTINOS} de uma vez — reenviar
            a mesma mensagem para muita gente ao mesmo tempo é o que faz o WhatsApp marcar o número como
            disparo em massa.
          </DialogDescription>
        </DialogHeader>

        <SearchField value={termo} onChange={setTermo} label="Buscar conversa" placeholder="Nome ou telefone" />

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {filtrados.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              Nenhuma conversa com esse nome.
            </p>
          ) : (
            filtrados.map((d) => {
              const marcado = escolhidos.includes(d.id)
              const bloqueado = !marcado && escolhidos.length >= MAX_DESTINOS
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={bloqueado}
                  onClick={() => alternar(d.id)}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left transition-colors last:border-b-0',
                    marcado ? 'bg-primary/10' : 'hover:bg-muted/60',
                    bloqueado && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <Checkbox checked={marcado} tabIndex={-1} aria-hidden className="pointer-events-none" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{d.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{d.phone || 'sem telefone'}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => fechar(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(escolhidos)}
            disabled={enviando || escolhidos.length === 0}
          >
            <Forward className="size-4" aria-hidden />
            {enviando
              ? 'Encaminhando…'
              : `Encaminhar para ${escolhidos.length || 0} ${escolhidos.length === 1 ? 'conversa' : 'conversas'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
