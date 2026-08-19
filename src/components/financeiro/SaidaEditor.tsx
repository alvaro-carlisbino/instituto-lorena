// A /gastos junta duas origens numa tabela só, então "editar" precisa saber de onde a linha veio:
// lançamento do banco abre o editor do extrato (contraparte, centro, rateio — valor e data vêm do
// banco e não se mexem), parcela abre o editor de conta a pagar. Sem isto a tela mostrava R$ 1,2
// milhão de saída por mês e não deixava corrigir uma vírgula: quem visse centro de custo errado
// tinha que adivinhar em qual das outras duas telas aquela linha morava.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { LancamentoEditor } from '@/components/financeiro/LancamentoEditor'
import { ParcelaEditor } from '@/components/financeiro/ParcelaEditor'
import { type Payable, getPayable } from '@/services/estoqueCompras'
import {
  type CostCenter,
  type FinCategory,
  type FinTransaction,
  getTransaction,
} from '@/services/financeiro'

export function SaidaEditor({
  origem,
  id,
  categorias,
  centros,
  onSalvo,
  onCancelar,
}: {
  origem: 'banco' | 'a pagar'
  id: string
  categorias: FinCategory[]
  centros: CostCenter[]
  onSalvo: () => void
  onCancelar: () => void
}) {
  const [txn, setTxn] = useState<FinTransaction | null>(null)
  const [parcela, setParcela] = useState<Payable | null>(null)
  const [carregando, setCarregando] = useState(true)

  // Cada linha aberta monta o seu próprio editor (a chave da <Fragment> é origem+id), então o
  // estado inicial já é "carregando" e o efeito só mexe em estado dentro do callback da busca.
  useEffect(() => {
    let vivo = true
    const busca = origem === 'banco' ? getTransaction(id) : getPayable(id)
    void busca
      .then((r) => {
        if (!vivo) return
        if (!r) {
          toast.error('Este lançamento não existe mais. Atualize a tela.')
          return
        }
        if (origem === 'banco') setTxn(r as FinTransaction)
        else setParcela(r as Payable)
      })
      .catch((e: unknown) => {
        if (vivo) toast.error(e instanceof Error ? e.message : 'Falha ao abrir o lançamento')
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [origem, id])

  if (carregando) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">Abrindo…</p>
  }
  if (txn) {
    return (
      <LancamentoEditor
        lancamento={txn}
        categorias={categorias}
        centros={centros}
        onSalvo={onSalvo}
      />
    )
  }
  if (parcela) {
    return (
      <ParcelaEditor
        parcela={parcela}
        categorias={categorias}
        centros={centros}
        onSalvo={onSalvo}
        onCancelar={onCancelar}
      />
    )
  }
  return <p className="px-1 py-2 text-xs text-muted-foreground">Nada para editar aqui.</p>
}
