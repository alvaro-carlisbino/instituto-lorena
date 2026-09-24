import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, PackageX } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { LISTA_DE_KITS } from '@/components/kits/navegacaoDoKit'

export function VoltarParaKits({ rotulo = 'Kits dos pacientes', para = LISTA_DE_KITS }: { rotulo?: string; para?: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        to={para}
        className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden /> {rotulo}
      </Link>
    </div>
  )
}

/** Carregando, erro ou kit que não existe: a tela diz qual dos três, em vez de ficar em branco. */
export function EstadoDaTela({
  carregando,
  erro,
  vazio,
  children,
}: {
  carregando: boolean
  erro: string | null
  /** Mensagem quando carregou e não achou (kit apagado, link de outro polo). */
  vazio: string | null
  children: ReactNode
}) {
  if (carregando) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">Carregando…</span>
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    )
  }
  if (erro) {
    return (
      <div role="alert" className="mx-auto w-full max-w-3xl rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {erro}
      </div>
    )
  }
  if (vazio) return <EmptyState icon={PackageX} title={vazio} description="Volte para a lista de kits e abra de novo." />
  return <>{children}</>
}
