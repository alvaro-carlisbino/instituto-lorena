import { useEffect, useState } from 'react'
import { Link2, Link2Off } from 'lucide-react'

import { cn } from '@/lib/utils'
import { type VendaDoPaciente, listVendasDoPaciente } from '@/services/resultadoProcedimentos'

const dataCurta = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'sem data')

/**
 * De qual venda é este kit. É o que liga o material que saiu à cirurgia no Resultado por
 * cirurgia. Mostra procedimento, data e situação, nunca o valor da cirurgia. Com um paciente só e uma venda perto da data, já vem escolhida:
 * a enfermagem não deveria ter que pensar nisso.
 */
export function VendaDoKitPicker({
  leadId,
  data,
  value,
  onChange,
  autoEscolher = false,
  disabled,
}: {
  leadId: string | null
  data?: string | null
  value: string | null
  onChange: (saleId: string | null) => void
  /** Na montagem: sem escolha ainda, pega a venda mais próxima da data. */
  autoEscolher?: boolean
  disabled?: boolean
}) {
  const [vendas, setVendas] = useState<VendaDoPaciente[] | null>(null)

  useEffect(() => {
    if (!leadId) return
    let vivo = true
    listVendasDoPaciente(leadId, data)
      .then((vs) => {
        if (!vivo) return
        setVendas(vs)
        if (autoEscolher && !value && vs.length > 0) onChange(vs[0].id)
      })
      .catch(() => vivo && setVendas([]))
    return () => {
      vivo = false
    }
    // Recarrega por paciente e data; value/onChange mudam a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, data])

  if (!leadId) {
    return <p className="text-xs text-muted-foreground">Escolha o paciente do CRM para ligar o kit à venda da cirurgia.</p>
  }
  if (vendas == null) return <p className="text-xs text-muted-foreground">Buscando vendas do paciente…</p>
  if (vendas.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
        <Link2Off className="size-3.5" aria-hidden /> Paciente sem venda na Central de Vendas: o custo deste kit fica sem receita.
      </p>
    )
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {vendas.map((v) => (
        <button
          key={v.id}
          type="button"
          disabled={disabled}
          onClick={() => onChange(v.id)}
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-60',
            value === v.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
          )}
        >
          <span className="flex items-center gap-1 font-medium">
            {value === v.id ? <Link2 className="size-3" aria-hidden /> : null}
            {v.procedimento || v.kind} · {dataCurta(v.dia)}
          </span>
          <span className="block text-muted-foreground">{v.status}</span>
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          'rounded-lg border px-2.5 py-1.5 text-xs text-muted-foreground disabled:opacity-60',
          value == null ? 'border-foreground' : 'border-border hover:bg-muted',
        )}
      >
        Sem venda
      </button>
    </div>
  )
}
