// Apagar um lançamento de Gastos, com as regras que protegem o dinheiro de verdade.
//
// Pedido do financeiro e do Dr. (14/set/2026): "botão de apagar, tem lançamento duplicado e
// errado". Os três casos que isso cobre são diferentes e a tela trata cada um do seu jeito:
//
//   Conta a pagar que não foi compra (proposta comercial faturada antes do "sim", boleto golpe
//   que entrou pela SEFAZ): sai do gasto e fica registrada como cancelada, com o motivo.
//
//   Lançamento do banco com possível cópia (mesmo dia e valor; ver lib/copiasBanco): a pessoa
//   escolhe qual fica, e a classificação da que sai passa para a que fica.
//
//   Lançamento do banco sem cópia: saiu da conta de verdade e não se apaga. Se não é gasto
//   (PIX devolvido, transferência), a tela oferece tirar do total pelo centro certo, em vez de
//   esconder o botão sem explicar nada.
//
// Tudo que se apaga aqui volta pela lista "Excluídos" em Gastos.

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
import { useOpcoes } from '@/hooks/useOpcoes'
import { CENTRO_A_CONFIRMAR, GRUPO_FORA_DO_TOTAL } from '@/lib/centroCusto'
import { padraoDaRegra } from '@/lib/extratoPadrao'
import { cn } from '@/lib/utils'
import { excluirContaAPagar, excluirLancamentoRepetido, type CostCenter } from '@/services/financeiro'

export type OutroLancamento = { id: string; descricao: string; data: string; amountCents: number }

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function ExcluirLancamento({
  origem,
  id,
  descricao = '',
  outros = [],
  resumo,
  onExcluido,
  variante = 'botao',
  centros = [],
  onTirarDoTotal,
}: {
  origem: 'banco' | 'a pagar'
  id: string
  /** Descrição do banco deste lançamento, para mostrar ao lado dos outros na escolha. */
  descricao?: string
  /** Outros lançamentos do banco que podem ser o mesmo pagamento: só com eles este pode sair. */
  outros?: OutroLancamento[]
  resumo: string
  onExcluido: () => void
  variante?: 'botao' | 'icone'
  /** Para o caso sem cópia: os centros "Não é gasto" viram as opções de tirar do total. */
  centros?: CostCenter[]
  onTirarDoTotal?: (centro: CostCenter) => Promise<void>
}) {
  const [aberto, setAberto] = useState(false)
  // Os motivos se editam em /listas → Motivos para excluir um lançamento.
  const motivos = useOpcoes('financeiro_motivo_exclusao')
  const [motivo, setMotivo] = useState<string>(motivos[0] ?? '')
  const [outro, setOutro] = useState('')
  const [busy, setBusy] = useState(false)
  // Fica, por padrão, o que diz quem recebeu: o pendente só diz o trilho ("SISPAG FORNECEDORES").
  const [escolhido, setFica] = useState<string>('')
  // A lista de outros muda depois de cada recarga (apagar uma cópia tira ela daqui): a escolha
  // que não existe mais volta para o padrão em vez de mandar um id apagado ao banco.
  const fica =
    outros.find((o) => o.id === escolhido)?.id ??
    (outros.find((o) => padraoDaRegra(o.descricao) != null) ?? outros[0])?.id ??
    ''
  const temCopia = outros.length > 0

  const caso: 'conta' | 'copia' | 'pagamento' =
    origem === 'a pagar' ? 'conta' : temCopia ? 'copia' : 'pagamento'
  const foraDoTotal = centros.filter(
    (c) => c.grupo === GRUPO_FORA_DO_TOTAL && c.active && c.name !== CENTRO_A_CONFIRMAR,
  )

  const confirmar = async () => {
    const texto = motivo === 'Outro' ? outro.trim() : motivo
    if (caso === 'conta' && !texto) {
      toast.error('Escreva o motivo.')
      return
    }
    setBusy(true)
    try {
      if (caso === 'conta') await excluirContaAPagar(id, texto)
      else await excluirLancamentoRepetido(id, fica || null)
      toast.success('Lançamento apagado. Dá para desfazer em “Excluídos”, no fim da página.')
      setAberto(false)
      onExcluido()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao apagar')
    } finally {
      setBusy(false)
    }
  }

  const tirar = async (c: CostCenter) => {
    if (!onTirarDoTotal) return
    setBusy(true)
    try {
      await onTirarDoTotal(c)
      setAberto(false)
    } finally {
      setBusy(false)
    }
  }

  const titulo = caso === 'conta' ? 'Apagar lançamento' : caso === 'copia' ? 'Apagar cópia repetida' : 'Este pagamento não se apaga'

  return (
    <>
      {variante === 'icone' ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Apagar ${resumo}`}
          title="Apagar"
          onClick={(e) => {
            e.stopPropagation()
            setAberto(true)
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : caso === 'pagamento' && !onTirarDoTotal ? (
        <span className="text-xs text-muted-foreground">
          Pagamento que saiu do banco não se apaga. Se não é gasto, escolha um centro de “Não é gasto”.
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={() => setAberto(true)}
        >
          <Trash2 className="size-3.5" /> {caso === 'copia' ? 'Apagar cópia repetida' : 'Apagar lançamento'}
        </Button>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{resumo}</DialogDescription>
          </DialogHeader>

          {caso === 'copia' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                No mesmo dia e com o mesmo valor, o banco tem {outros.length === 1 ? 'outro lançamento' : 'outros lançamentos'}.
                Se é o mesmo pagamento, este sai e fica o que você marcar, com a classificação deste se ele não tiver.
              </p>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Sai: </span>
                <span className="font-medium">{descricao || resumo}</span>
              </div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fica</div>
              <div className="grid gap-1.5">
                {outros.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={fica === o.id}
                    onClick={() => setFica(o.id)}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm',
                      fica === o.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
                    )}
                  >
                    <span className="truncate">{o.descricao}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{brl(o.amountCents)}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Se não é o mesmo pagamento (duas compras de mesmo valor no mesmo dia), cancele.
              </p>
            </div>
          )}

          {caso === 'conta' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                A conta sai do gasto e fica guardada como cancelada. A nota não volta a ser lançada.
              </p>
              <div className="grid gap-1.5">
                {motivos.map((m) => (
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

          {caso === 'pagamento' && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Este dinheiro saiu da conta do banco de verdade e não tem outro lançamento igual, então não é cópia. Se
                ele não é gasto, tire do total:
              </p>
              {onTirarDoTotal && foraDoTotal.length > 0 ? (
                <div className="grid gap-1.5">
                  {foraDoTotal.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void tirar(c)}
                      className="rounded-md border border-border px-3 py-2 text-left hover:bg-muted/40 disabled:opacity-50"
                    >
                      <span className="block text-sm font-medium">{c.name}</span>
                      {c.description ? <span className="block text-xs text-muted-foreground">{c.description}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Se o valor está certo e só a classificação está errada, troque o centro de custo na linha.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)} disabled={busy}>
              {caso === 'pagamento' ? 'Fechar' : 'Cancelar'}
            </Button>
            {caso !== 'pagamento' && (
              <Button variant="destructive" onClick={() => void confirmar()} disabled={busy}>
                {busy ? 'Apagando…' : 'Apagar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
