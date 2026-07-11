import { useEffect, useState } from 'react'
import { Search, User, MapPin, Route, Star, Stethoscope, CreditCard } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { useTenant } from '@/context/TenantContext'
import { searchLeadsByName } from '@/services/clinicalNotes'
import { fetchClientProfile, type ClientProfile } from '@/services/clientProfile'

const STAGE_LABEL: Record<string, string> = {
  novo: 'Novo lead', triagem: 'Triagem', contato: 'Contato', consulta: 'Consulta agendada',
  'stage-1777902160674': 'Consulta realizada', fechado: 'Encerrado', 'ligar-formulario': 'Ligar — Formulário',
}
const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const isPaid = (s: string) => ['paid', 'confirmed', 'received', 'approved'].includes(s)

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className="h-4 w-4 text-muted-foreground" /> {title}</p>
      {children}
    </div>
  )
}
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p className="text-sm text-foreground">{value || '—'}</p>
    </div>
  )
}

export function ClientProfilePage() {
  const { tenant } = useTenant()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; phone: string }>>([])
  const [leadId, setLeadId] = useState<string | null>(null)
  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (term.trim().length < 2 || leadId) { setResults([]); return }
    let cancelled = false
    searchLeadsByName(tenant.id, term).then((r) => { if (!cancelled) setResults(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [term, leadId, tenant.id])

  useEffect(() => {
    if (!leadId) { setProfile(null); return }
    let cancelled = false
    setLoading(true)
    fetchClientProfile(leadId).then((p) => { if (!cancelled) setProfile(p) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [leadId])

  const paidTotal = profile?.payments.filter((p) => isPaid(p.status)).reduce((s, p) => s + p.amountCents, 0) ?? 0

  return (
    <AppLayout title="Perfil do Cliente" subtitle="Visão consolidada — origem, jornada, feedback, notas e financeiro">
      {/* busca */}
      <div className="mb-6 max-w-lg">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar paciente pelo nome…"
            value={term}
            onChange={(e) => { setTerm(e.target.value); setLeadId(null) }}
          />
        </div>
        {!leadId && results.length > 0 && (
          <div className="mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-card">
            {results.map((r) => (
              <button key={r.id} onClick={() => { setLeadId(r.id); setTerm(r.name); setResults([]) }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60">
                <span className="font-medium">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.phone}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando perfil…</p>
      ) : !profile ? (
        <EmptyState icon={User} title="Busque um paciente" description="Digite o nome acima para ver o perfil consolidado." />
      ) : (
        <div className="space-y-4">
          {/* cabeçalho */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-foreground">{profile.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Cliente desde {new Date(profile.createdAt).toLocaleDateString('pt-BR')} · {profile.interactionsCount} interações
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{STAGE_LABEL[profile.stageId] ?? (profile.stageId || 'sem etapa')}</Badge>
                {paidTotal > 0 ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{brl(paidTotal)} pagos</Badge> : null}
                {profile.shospProntuario ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">Shosp #{profile.shospProntuario}</Badge> : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* identidade */}
            <Section icon={User} title="Identidade">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Telefone" value={profile.phone.startsWith('888001') ? 'sem nº real (ManyChat)' : profile.phone} />
                <Field label="CPF" value={profile.cpf} />
                <Field label="E-mail" value={profile.email} />
                <Field label="Canal" value={profile.channel} />
              </div>
            </Section>

            {/* origem */}
            <Section icon={MapPin} title="Origem / Atribuição">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fonte" value={profile.source} />
                <Field label="Canal Meta" value={profile.attributionChannel} />
                <Field label="Campanha" value={profile.attributionCampaign} />
              </div>
            </Section>
          </div>

          {/* jornada resumida */}
          <Section icon={Route} title="Jornada">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">Entrou {new Date(profile.createdAt).toLocaleDateString('pt-BR')}</Badge>
              <span className="text-muted-foreground">→</span>
              <Badge variant="outline">{STAGE_LABEL[profile.stageId] ?? profile.stageId}</Badge>
              {profile.lastInteractionAt ? (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">última interação {new Date(profile.lastInteractionAt).toLocaleDateString('pt-BR')}</span>
                </>
              ) : null}
            </div>
          </Section>

          {/* feedback */}
          <Section icon={Star} title={`Feedback (${profile.feedbacks.length})`}>
            {profile.feedbacks.length === 0 ? <p className="text-sm text-muted-foreground">Sem avaliações ainda.</p> : (
              <ul className="space-y-2">
                {profile.feedbacks.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge className={f.score != null && f.score >= 9 ? 'bg-emerald-100 text-emerald-700' : f.score != null && f.score <= 6 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                      {f.score ?? '—'}
                    </Badge>
                    <span className="text-foreground/90">{f.comment || <em className="text-muted-foreground">sem comentário</em>}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{new Date(f.when).toLocaleDateString('pt-BR')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* notas clínicas */}
          <Section icon={Stethoscope} title={`Notas clínicas (${profile.notes.length})`}>
            {profile.notes.length === 0 ? <p className="text-sm text-muted-foreground">Sem notas.</p> : (
              <ul className="space-y-2">
                {profile.notes.map((n) => (
                  <li key={n.id} className="rounded-lg border border-border/60 p-3 text-sm">
                    <div className="mb-1 flex items-center justify-between">
                      <Badge variant="outline">{n.category || 'nota'}</Badge>
                      <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('pt-BR')} · {n.author}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-foreground/90">{n.note}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* pagamentos */}
          <Section icon={CreditCard} title={`Pagamentos (${profile.payments.length})`}>
            {profile.payments.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum pagamento.</p> : (
              <ul className="space-y-1.5">
                {profile.payments.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="font-medium tabular-nums">{brl(p.amountCents)}</span>
                    <Badge className={isPaid(p.status) ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'}>{isPaid(p.status) ? 'pago' : p.status}</Badge>
                    <span className="text-xs text-muted-foreground">{p.gateway} · {p.method}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{new Date(p.when).toLocaleDateString('pt-BR')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </AppLayout>
  )
}
