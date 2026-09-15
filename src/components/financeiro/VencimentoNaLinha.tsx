// Vencimento de conta a pagar que se muda clicando na própria data.
//
// 15/set/2026: a nota da Surya vencia 08/10 e /gastos mostrava 08/09, "sem pagamento no banco".
// O editor da parcela já deixava remarcar, mas só abria clicando no meio da linha, e nada na
// linha dizia isso. A data é o que a pessoa olha quando está errada, então é nela que se clica.
//
// Mesma regra do editor: só parcela em aberto. Paga já virou saída no caixa naquele dia.

import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updatePayable } from '@/services/estoqueCompras'
import { cn } from '@/lib/utils'

const dia = (iso: string) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : '')

export function VencimentoNaLinha({
  id,
  vencimento,
  onSalvo,
  className,
}: {
  /** Id da parcela em `payable_installments`. */
  id: string
  vencimento: string
  /** Chamado com a data nova depois que o banco aceitou. */
  onSalvo: (novo: string) => void
  className?: string
}) {
  const [aberto, setAberto] = useState(false)
  const [valor, setValor] = useState(vencimento)
  const [busy, setBusy] = useState(false)

  const salvar = async () => {
    if (!valor) {
      toast.error('Informe o vencimento.')
      return
    }
    if (valor === vencimento) {
      setAberto(false)
      return
    }
    setBusy(true)
    try {
      await updatePayable(id, { dueDate: valor })
      setAberto(false)
      onSalvo(valor)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao mudar o vencimento')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover.Root
      open={aberto}
      onOpenChange={(open) => {
        if (open) setValor(vencimento)
        setAberto(open)
      }}
    >
      <Popover.Trigger
        // A linha inteira abre o editor ao clicar: sem isto o clique na data abriria os dois.
        onClick={(e) => e.stopPropagation()}
        title="Mudar o vencimento"
        className={cn(
          'group -mx-1 inline-flex items-center gap-1 rounded px-1 tabular-nums underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 hover:bg-muted hover:decoration-foreground',
          className,
        )}
      >
        {dia(vencimento)}
        <Pencil className="size-3 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="isolate z-[100] outline-none" side="bottom" align="start" sideOffset={4}>
          <Popover.Popup
            // O portal sai do DOM da tabela, mas o evento do React sobe pela árvore até a <tr>.
            onClick={(e) => e.stopPropagation()}
            className="z-[100] w-56 space-y-2 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none"
          >
            <Popover.Title className="text-xs font-medium">Vencimento</Popover.Title>
            <Input
              type="date"
              autoFocus
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void salvar()
                }
              }}
              className="h-8"
            />
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button size="sm" className="h-7" disabled={busy} onClick={() => void salvar()}>
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
