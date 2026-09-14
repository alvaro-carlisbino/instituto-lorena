// Excluir um lançamento de Gastos, com as duas regras que protegem o dinheiro de verdade.
//
// Conta a pagar que não foi compra (proposta comercial faturada antes do "sim", boleto golpe
// que entrou pela SEFAZ) sai do gasto e fica registrada como cancelada, com o motivo.
//
// Lançamento do banco só sai se for CÓPIA repetida pelo Open Finance. Pagamento que saiu da
// conta não se exclui: o dinheiro saiu. Se não é gasto, o caminho é o centro "Transferência
// entre contas", e a tela diz isso em vez de esconder o botão sem explicar.
//
// Tudo que se exclui aqui volta pela lista "Excluídos" em Gastos.

import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { excluirContaAPagar, excluirLancamentoRepetido } from '@/services/financeiro'

const MOTIVOS = [
  'Não foi compra: proposta comercial',
  'Boleto falso ou golpe',
  'Nota lançada em duplicidade',
  'Outro',
] as const

export function ExcluirLancamento({
  origem,
  id,
  possivelDuplicado = false,
  resumo,
  onExcluido,
}: {
  origem: 'banco' | 'a pagar'
  id: string
  possivelDuplicado?: boolean
  resumo: string
  onExcluido: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState<(typeof MOTIVOS)[number]>(MOTIVOS[0])
  const [outro, setOutro] = useState('')
  const [busy, setBusy] = useState(false)

  if (origem === 'banco' && !possivelDuplicado) {
    return (
      <span className="text-xs text-muted-foreground">
        Pagamento que saiu do banco não se exclui. Se não é gasto, escolha o centro “Transferência entre contas”.
      </span>
    )
  }

  const confirmar = async () => {
    const texto = motivo === 'Outro' ? outro.trim() : motivo
    if (origem === 'a pagar' && !texto) {
      toast.error('Escreva o motivo.')
      return
    }
    setBusy(true)
    try {
      if (origem === 'a pagar') await excluirContaAPagar(id, texto)
      else await excluirLancamentoRepetido(id)
      toast.success('Lançamento excluído. Dá para desfazer em “Excluídos”, no fim da lista.')
      setAberto(false)
      onExcluido()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao excluir')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={() => setAberto(true)}
      >
        <Trash2 className="size-3.5" /> {origem === 'banco' ? 'Excluir cópia repetida' : 'Excluir lançamento'}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{origem === 'banco' ? 'Excluir cópia repetida' : 'Excluir lançamento'}</DialogTitle>
            <DialogDescription>{resumo}</DialogDescription>
          </DialogHeader>

          {origem === 'banco' ? (
            <p className="text-sm text-muted-foreground">
              Existe outro lançamento igual (mesmo dia, valor e descrição). Esta cópia sai e a outra fica, com a
              classificação que tiver.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                A conta sai do gasto e fica guardada como cancelada. A nota não volta a ser lançada.
              </p>
              <div className="grid gap-1.5">
                {MOTIVOS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={motivo === m}
                    onClick={() => setMotivo(m)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-sm',
                      motivo === m ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {motivo === 'Outro' && (
                <Input autoFocus value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Qual o motivo?" />
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void confirmar()} disabled={busy}>
              {busy ? 'Excluindo…' : 'Excluir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
