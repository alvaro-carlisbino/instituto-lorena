import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, RefreshCw } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { SkeletonBlocks } from '@/components/SkeletonBlocks'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  fetchTricopillReengage,
  STATUS_LABEL,
  TRACK_LABEL,
  type ReengageOverview,
} from '@/services/tricopillReengage'

const ANALISE_TABS = [
  { to: '/tricopill-bi', label: 'BI de vendas' },
  { to: '/tricopill-loja', label: 'Loja (site)' },
  { to: '/tricopill-reengajamento', label: 'Reengajamento' },
]

const firstName = (s: string | null) => {
  const first = String(s ?? '').trim().split(/\s+/)[0] || ''
  return first.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '') || 'Cliente'
}

function StatCard({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 transition-all hover:bg-card/80">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">{label}</p>
      <p className={cn('mt-2 text-3xl font-black tabular-nums tracking-tight', tone)}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground/70">{hint}</p> : null}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 mt-2 flex items-center gap-3">
      <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/50">{children}</h3>
      <div className="h-px flex-1 bg-border/40" />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'converted'
      ? 'bg-emerald-500/10 text-emerald-600'
      : status === 'stopped'
        ? 'bg-rose-500/10 text-rose-600'
        : status === 'active'
          ? 'bg-primary/10 text-primary'
          : 'bg-muted/50 text-foreground/70'
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold', tone)}>
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

export function TricopillReengagePage() {
  const [data, setData] = useState<ReengageOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTricopillReengage()
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const m = data?.metrics
  const ativos = useMemo(() => data?.ativos ?? [], [data])
  const fila = useMemo(() => data?.fila ?? [], [data])

  if (loading && !data) {
    return (
      <AppLayout title="Reengajamento Tricopill">
        <SkeletonBlocks rows={6} />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Reengajamento — follow-up e recompra sem fim"
      actions={
        <div className="flex items-center gap-2">
          <Link to="/tricopill" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'rounded-lg')}>
            <MessageSquare className="size-4 mr-2" />
            Conversas
          </Link>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className={cn(buttonVariants({ size: 'sm' }), 'rounded-lg')}
          >
            <RefreshCw className={cn('size-4 mr-2', loading && 'animate-spin')} />
            Atualizar
          </button>
        </div>
      }
    >
      <SubTabs tabs={ANALISE_TABS} />

      {error ? (
        <p className="mb-6 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
      ) : null}

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Silenciosos"
          value={m?.silenciosos ?? 0}
          hint={`${m?.silenciosos_7d ?? 0} há +7 dias · reativáveis`}
          tone="text-amber-600"
        />
        <StatCard
          label="Em reativação"
          value={m?.em_reativacao ?? 0}
          hint="recebendo a cadência A"
          tone="text-primary"
        />
        <StatCard
          label="Em recompra"
          value={m?.em_recompra ?? 0}
          hint={`${m?.compradores ?? 0} compradores no total`}
          tone="text-emerald-600"
        />
        <StatCard
          label="Reativados (venderam)"
          value={m?.reativados_convertidos ?? 0}
          hint="sumiram, voltaram e compraram"
          tone="text-emerald-600"
        />
      </section>

      <p className="mb-8 rounded-xl border border-border/60 bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="text-foreground/80">Como funciona:</strong> quem some depois da gente falar por último entra na{' '}
        <strong>Reativação</strong> (toques em 0, 3, 10, 24, 45 dias, depois mensal e trimestral, sem fim). Quem comprou entra na{' '}
        <strong>Recompra</strong> quando o frasco está acabando (reposição → assinatura → winback). O relógio zera quando a pessoa
        responde; quem manda "SAIR" sai na hora. Contato interno e nome sem letra são barrados. Dispara 1x/dia, no máximo{' '}
        <strong>25 mensagens</strong> por rodada.
      </p>

      <SectionTitle>Em andamento ({ativos.length})</SectionTitle>
      <section className="mb-8 rounded-xl border border-border bg-card p-6">
        {ativos.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Ninguém em cadência ainda.</p>
        ) : (
          <Table className="w-full text-xs">
            <TableHeader>
              <TableRow className="text-left text-muted-foreground">
                <TableHead className="pb-2">Cliente</TableHead>
                <TableHead className="pb-2">Trilha</TableHead>
                <TableHead className="pb-2 text-right">Toque nº</TableHead>
                <TableHead className="pb-2">Status</TableHead>
                <TableHead className="pb-2">Último envio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ativos.map((a, i) => (
                <TableRow key={`${a.patient_name}-${a.track}-${i}`} className="border-t border-border/20">
                  <TableCell className="py-1.5 font-medium">{firstName(a.patient_name)}</TableCell>
                  <TableCell className="py-1.5">{TRACK_LABEL[a.track] ?? a.track}</TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums">{a.step}</TableCell>
                  <TableCell className="py-1.5"><StatusBadge status={a.status} /></TableCell>
                  <TableCell className="py-1.5 text-muted-foreground">
                    {a.last_sent_at ? new Date(a.last_sent_at).toLocaleDateString('pt-BR') : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <SectionTitle>Na fila — vão entrar ({fila.length})</SectionTitle>
      <section className="rounded-xl border border-border bg-card p-6">
        {fila.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Fila vazia — todo mundo elegível já está em cadência.</p>
        ) : (
          <Table className="w-full text-xs">
            <TableHeader>
              <TableRow className="text-left text-muted-foreground">
                <TableHead className="pb-2">Cliente</TableHead>
                <TableHead className="pb-2">Situação</TableHead>
                <TableHead className="pb-2 text-right">Dias em silêncio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fila.map((f, i) => (
                <TableRow key={`${f.patient_name}-${i}`} className="border-t border-border/20">
                  <TableCell className="py-1.5 font-medium">{firstName(f.patient_name)}</TableCell>
                  <TableCell className="py-1.5">
                    {f.situacao === 'comprou' ? 'Comprou (aguardando frasco acabar)' : 'Silencioso'}
                  </TableCell>
                  <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                    {f.dias_silencio != null ? `${f.dias_silencio}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </AppLayout>
  )
}
