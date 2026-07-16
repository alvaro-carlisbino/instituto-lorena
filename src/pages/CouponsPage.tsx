import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { RefreshCw, Tag, Trash2, Plus } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { financeiroTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type Coupon,
  type CouponInput,
  deleteCoupon,
  listCoupons,
  setCouponActive,
  upsertCoupon,
} from '@/services/crmCoupons'

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function describeCoupon(c: Coupon): string {
  const off = c.kind === 'percent' ? `${c.value}% de desconto` : `${formatBRL(c.value)} de desconto`
  const parts = [off]
  if (c.min_amount_cents > 0) parts.push(`mín. ${formatBRL(c.min_amount_cents)}`)
  if (c.max_uses != null) parts.push(`${c.uses}/${c.max_uses} usos`)
  else parts.push(`${c.uses} usos`)
  if (c.valid_until) parts.push(`até ${new Date(c.valid_until).toLocaleDateString('pt-BR')}`)
  return parts.join(' · ')
}

const EMPTY: {
  code: string
  kind: 'percent' | 'fixed'
  value: string
  maxUses: string
  validUntil: string
  minAmount: string
  note: string
} = { code: '', kind: 'percent', value: '', maxUses: '', validUntil: '', minAmount: '', note: '' }

export function CouponsPage() {
  const { tenant } = useTenant()
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState<Coupon[]>([])
  const [loading, setLoading] = useState(false)
  const [couponToDelete, setCouponToDelete] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setRows(await listCoupons())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar cupons')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const handleSave = async () => {
    const code = form.code.trim().toUpperCase()
    if (code.length < 3) {
      toast.error('Código precisa de ao menos 3 caracteres.')
      return
    }
    const valueNum = Number(form.value.replace(',', '.'))
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      toast.error('Informe um valor de desconto válido.')
      return
    }
    if (form.kind === 'percent' && valueNum > 100) {
      toast.error('Percentual máximo é 100%.')
      return
    }
    const payload: CouponInput = {
      code,
      kind: form.kind,
      value: form.kind === 'percent' ? Math.round(valueNum) : Math.round(valueNum * 100),
      active: true,
      max_uses: form.maxUses.trim() ? Math.max(1, Math.round(Number(form.maxUses))) : null,
      valid_until: form.validUntil ? new Date(`${form.validUntil}T23:59:59`).toISOString() : null,
      min_amount_cents: form.minAmount.trim() ? Math.round(Number(form.minAmount.replace(',', '.')) * 100) : 0,
      note: form.note.trim() || null,
    }
    setSaving(true)
    try {
      await upsertCoupon(payload)
      toast.success(`Cupom ${code} salvo.`)
      setForm({ ...EMPTY })
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar cupom')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (c: Coupon) => {
    try {
      await setCouponActive(c.code, !c.active)
      setRows((prev) => prev.map((r) => (r.code === c.code ? { ...r, active: !c.active } : r)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha')
    }
  }

  const remove = async (code: string) => {
    try {
      await deleteCoupon(code)
      setRows((prev) => prev.filter((r) => r.code !== code))
      toast.success('Cupom excluído.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha')
    }
  }

  return (
    <AppLayout
      title="Cupons de desconto"
      subtitle="Códigos que a IA de vendas e os links de pagamento aplicam (Pix e cartão)."
    >
      <SubTabs tabs={financeiroTabs(tenant.poloType === 'sales')} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plus className="size-4 text-primary" /> Novo cupom
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cp-code">Código</Label>
              <Input
                id="cp-code"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="Ex.: BEMVINDO10"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="cp-kind">Tipo</Label>
                <Select value={form.kind} onValueChange={(v) => setForm((f) => ({ ...f, kind: v as 'percent' | 'fixed' }))}>
                  <SelectTrigger id="cp-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percentual (%)</SelectItem>
                    <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-value">{form.kind === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}</Label>
                <Input
                  id="cp-value"
                  inputMode="decimal"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder={form.kind === 'percent' ? 'Ex.: 10' : 'Ex.: 30,00'}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="cp-max">Limite de usos</Label>
                <Input
                  id="cp-max"
                  inputMode="numeric"
                  value={form.maxUses}
                  onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
                  placeholder="Ilimitado"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-until">Validade</Label>
                <Input
                  id="cp-until"
                  type="date"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-min">Valor mínimo do pedido (R$, opcional)</Label>
              <Input
                id="cp-min"
                inputMode="decimal"
                value={form.minAmount}
                onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))}
                placeholder="Ex.: 189,00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-note">Observação (opcional)</Label>
              <Input
                id="cp-note"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Ex.: campanha junho"
              />
            </div>
            <Button className="w-full" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Salvando…' : 'Salvar cupom'}
            </Button>
            <p className="text-[0.7rem] text-muted-foreground">
              O uso só é contado quando o pagamento é confirmado. Salvar com um código existente atualiza o cupom.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="size-4 text-primary" /> Cupons cadastrados
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {loading ? 'Carregando…' : 'Nenhum cupom cadastrado ainda.'}
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {rows.map((c) => (
                  <div key={c.code} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm font-bold">{c.code}</span>
                        <Badge
                          variant={c.active ? 'default' : 'secondary'}
                          className={c.active ? 'bg-emerald-500/15 text-emerald-600' : ''}
                        >
                          {c.active ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{describeCoupon(c)}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void toggleActive(c)}>
                      {c.active ? 'Desativar' : 'Ativar'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCouponToDelete(c.code)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={couponToDelete !== null}
        onOpenChange={(open) => { if (!open) setCouponToDelete(null) }}
        title="Excluir cupom?"
        description={
          couponToDelete
            ? `O cupom ${couponToDelete} será excluído de forma permanente e deixará de ser aplicado. Esta ação não pode ser desfeita.`
            : ''
        }
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        onConfirm={() => {
          if (couponToDelete) void remove(couponToDelete)
          setCouponToDelete(null)
        }}
      />
    </AppLayout>
  )
}
