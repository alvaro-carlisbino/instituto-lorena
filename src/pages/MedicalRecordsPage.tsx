import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { FileLock, ShieldAlert, PencilLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AppLayout } from '@/layouts/AppLayout'
import {
  createMedicalRecord,
  fetchPatientConsents,
  listMedicalRecords,
  RECORD_TYPES,
  setPatientConsent,
  type MedicalRecord,
} from '@/services/medicalRecords'

export function MedicalRecordsPage() {
  const [params, setParams] = useSearchParams()
  const [leadId, setLeadId] = useState<string>(params.get('lead') ?? '')
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [recordType, setRecordType] = useState<string>('evolucao')
  const [content, setContent] = useState<string>('')
  const [saving, setSaving] = useState<boolean>(false)
  const [consent, setConsent] = useState<boolean | null>(null)

  const load = async (id: string) => {
    if (!id.trim()) return
    setLoading(true)
    try {
      const [list, consents] = await Promise.all([
        listMedicalRecords(id.trim()),
        fetchPatientConsents(id.trim()),
      ])
      setRecords(list)
      setConsent(consents.medical_care)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar prontuário.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (leadId) void load(leadId)
  }, [leadId])

  const handleGrantConsent = async () => {
    try {
      await setPatientConsent({
        leadId,
        purpose: 'medical_care',
        granted: true,
        source: 'in_person',
        evidence: { granted_via: 'manual_admin_action', at: new Date().toISOString() },
      })
      toast.success('Consentimento registrado.')
      setConsent(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar consentimento.')
    }
  }

  const handleSave = async () => {
    if (!content.trim()) {
      toast.error('Preencha o conteúdo.')
      return
    }
    setSaving(true)
    try {
      await createMedicalRecord({ leadId, recordType, content })
      toast.success('Registro adicionado ao prontuário.')
      setContent('')
      await load(leadId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppLayout title="Prontuário">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="ID do lead/paciente"
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            className="max-w-sm"
          />
          <Button
            onClick={() => {
              setParams({ lead: leadId })
              void load(leadId)
            }}
            disabled={!leadId.trim()}
          >
            Abrir
          </Button>
        </div>

        {!leadId.trim() ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Informe o ID do paciente para abrir o prontuário. Cada registro fica imutável
              (append-only) — correções são feitas com registro do tipo "Errata".
            </CardContent>
          </Card>
        ) : null}

        {leadId.trim() && consent === false ? (
          <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
            <CardContent className="flex items-start gap-3 pt-5 text-sm">
              <ShieldAlert className="size-5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="font-semibold">Consentimento LGPD pendente</p>
                <p className="text-xs text-muted-foreground">
                  Pra registrar prontuário, o paciente precisa consentir explicitamente o uso de
                  dados sensíveis para atendimento (LGPD art. 11). Registre o consentimento quando
                  o paciente assinar o termo presencial ou autorizar verbalmente.
                </p>
                <Button size="sm" className="mt-2" onClick={handleGrantConsent}>
                  Registrar consentimento agora
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {leadId.trim() && consent ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <PencilLine className="size-4" />
                Novo registro
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-2">
                <Label>Tipo</Label>
                <Select value={recordType} onValueChange={setRecordType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECORD_TYPES.map((t) => (
                      <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Conteúdo</Label>
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={5}
                  placeholder="Descrição clínica…"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Salvando…' : 'Adicionar ao prontuário'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {leadId.trim() ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileLock className="size-4" />
                Histórico ({records.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <p className="text-xs text-muted-foreground">Carregando…</p>
              ) : records.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem registros ainda.</p>
              ) : (
                <ul className="grid gap-3">
                  {records.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border/40 p-3">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="font-semibold uppercase tracking-wide">{r.record_type}</span>
                        <span>{new Date(r.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Por <span className="font-medium text-foreground">{r.author_name}</span>
                        {r.author_crm ? ` · ${r.author_crm}` : ''}
                        {r.signed_at ? ' · ✓ assinado' : ' · assinatura pendente'}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{r.content}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </AppLayout>
  )
}
