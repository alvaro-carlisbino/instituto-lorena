import { useEffect, useState } from 'react'
import { Plus, Stethoscope, Search, User } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { pacienteTabs } from '@/lib/patientFileTabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import { useCrm } from '@/context/CrmContext'
import {
  fetchClinicalNotes, createClinicalNote, searchLeadsByName, NOTE_CATEGORIES, type ClinicalNote,
} from '@/services/clinicalNotes'

const CAT_LABEL: Record<string, string> = Object.fromEntries(NOTE_CATEGORIES.map((c) => [c.value, c.label]))

function catBadge(cat: string) {
  const label = CAT_LABEL[cat] ?? cat ?? 'Nota'
  const tone = cat === 'encaminhamento' ? 'bg-amber-100 text-amber-700'
    : cat === 'plano' ? 'bg-blue-100 text-blue-700'
    : cat === 'consulta' ? 'bg-emerald-100 text-emerald-700'
    : 'bg-muted text-muted-foreground'
  return <Badge className={`${tone} hover:${tone}`}>{label}</Badge>
}

export function ClinicalNotesPage() {
  const { tenant } = useTenant()
  const crm = useCrm()
  const canWrite = crm.currentPermission?.canRouteLeads ?? true

  const [notes, setNotes] = useState<ClinicalNote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // dialog nova nota
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; phone: string }>>([])
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [category, setCategory] = useState('observacao')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    fetchClinicalNotes({ limit: 100 })
      .then(setNotes).catch((e) => setError(e instanceof Error ? e.message : 'Falha')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [tenant.id])

  // busca de paciente (as-you-type)
  useEffect(() => {
    if (!open || term.trim().length < 2) { setResults([]); return }
    let cancelled = false
    searchLeadsByName(tenant.id, term).then((r) => { if (!cancelled) setResults(r) }).catch(() => {})
    return () => { cancelled = true }
  }, [term, open, tenant.id])

  const resetDialog = () => { setTerm(''); setResults([]); setPicked(null); setCategory('observacao'); setText('') }

  const save = async () => {
    if (!picked || !text.trim()) return
    setSaving(true)
    try {
      await createClinicalNote({ tenantId: tenant.id, leadId: picked.id, note: text, category })
      setOpen(false); resetDialog(); load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout
      title="Ficha do paciente"
      subtitle="Observações dos médicos e da recepção, para dar continuidade ao atendimento"
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Nova nota</Button>
        ) : null
      }
    >
      <SubTabs tabs={pacienteTabs()} />
      {canWrite ? (
          <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetDialog() }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Nova nota clínica</DialogTitle></DialogHeader>
              <div className="space-y-3">
                {/* paciente */}
                {picked ? (
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <span className="flex items-center gap-2 text-sm font-medium"><User className="h-3.5 w-3.5" /> {picked.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>trocar</Button>
                  </div>
                ) : (
                  <div>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input className="pl-8" placeholder="Buscar paciente pelo nome…" value={term} onChange={(e) => setTerm(e.target.value)} />
                    </div>
                    {results.length > 0 && (
                      <div className="mt-1 max-h-44 overflow-auto rounded-lg border border-border">
                        {results.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => { setPicked({ id: r.id, name: r.name }); setTerm(''); setResults([]) }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/60"
                          >
                            <span className="font-medium">{r.name}</span>
                            <span className="text-xs text-muted-foreground">{r.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* categoria */}
                <Select value={category} onValueChange={(v) => setCategory(v ?? 'observacao')}>
                  <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
                  <SelectContent>
                    {NOTE_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>

                {/* texto */}
                <Textarea rows={5} placeholder="Escreva a observação clínica…" value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <DialogFooter>
                <Button onClick={save} disabled={!picked || !text.trim() || saving}>
                  {saving ? 'Salvando…' : 'Salvar nota'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      {error ? (
        <EmptyState title="Não foi possível carregar" description={error} />
      ) : loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando notas…</p>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={Stethoscope}
          title="Nenhuma nota ainda"
          description="Ao finalizar uma consulta, registre aqui as observações. A recepção vê e dá continuidade."
        />
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <User className="h-3.5 w-3.5 text-muted-foreground" /> {n.patientName}
                </span>
                <div className="flex items-center gap-2">
                  {catBadge(n.category)}
                  <span className="text-xs text-muted-foreground">{new Date(n.createdAt).toLocaleString('pt-BR')}</span>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-foreground/90">{n.note}</p>
              {n.author ? <p className="mt-2 text-[11px] text-muted-foreground">por {n.author}</p> : null}
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  )
}
