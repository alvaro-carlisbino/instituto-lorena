// Navegação do financeiro em DOIS níveis.
//
// A clínica via 14 abas numa régua só, que quebrava linha e não dizia nada sobre o que era
// parecido com o quê. Pior: três delas ("Extrato", "Conciliação", "Contas & caixa") leem o
// mesmo `fin_transactions` com verbos diferentes, e ninguém adivinhava isso pelo nome.
//
// Aqui o primeiro nível é a PERGUNTA que a pessoa tem ("quanto entra", "quanto sai", "o que o
// banco diz", "está tudo certo?"), e o segundo é a ferramenta. Nada sumiu — tudo virou sub-aba
// do grupo a que pertence, então quem já sabia o caminho continua chegando lá.

import { NavLink, useLocation } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { FINANCE_GROUPS, abasVisiveis as visiveis, grupoDaRota } from '@/config/financeNav'

export function FinanceTabs({ isSalesPolo }: { isSalesPolo: boolean }) {
  const { pathname } = useLocation()
  const grupo = grupoDaRota(pathname)

  const grupos = FINANCE_GROUPS.filter((g) => visiveis(g.tabs, isSalesPolo).length > 0)
  const abas = visiveis(grupo.tabs, isSalesPolo)

  return (
    <div className="mb-4 space-y-2">
      {/* Nível 1: a pergunta. Link vai pra primeira aba visível do grupo. */}
      <nav aria-label="Áreas do financeiro" className="flex gap-1 overflow-x-auto">
        {grupos.map((g) => {
          const destino = visiveis(g.tabs, isSalesPolo)[0]?.to ?? '#'
          const ativo = g.id === grupo.id
          return (
            <NavLink
              key={g.id}
              to={destino}
              className={cn(
                'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                ativo
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground',
              )}
            >
              {g.label}
            </NavLink>
          )
        })}
      </nav>

      {/* Nível 2: a ferramenta dentro do grupo. Some quando o grupo tem uma coisa só. */}
      {abas.length > 1 && (
        <nav aria-label="Seções da página" className="flex gap-1 overflow-x-auto border-b border-border">
          {abas.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end
              className={({ isActive }) =>
                cn(
                  '-mb-px whitespace-nowrap rounded-t-md border-b-2 px-3.5 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset',
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
