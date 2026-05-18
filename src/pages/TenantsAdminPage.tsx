import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTenant } from '@/context/TenantContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'
import {
  createTenant,
  fetchAllTenants,
  fetchTenantIntegrations,
  updateTenantBrand,
  updateTenantIntegrations,
  type Tenant,
  type TenantBrand,
  type TenantIntegrations,
} from '@/services/tenant'

const EMPTY_BRAND: TenantBrand = {
  app_name: '',
  logo_url: null,
  primary_color: '#0ea5e9',
  accent_color: '#22d3ee',
  support_phone: null,
  support_email: null,
}

export function TenantsAdminPage() {
  const { isSuperAdmin, loading: tenantLoading } = useTenant()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [createOpen, setCreateOpen] = useState<boolean>(false)
  const [editing, setEditing] = useState<Tenant | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchAllTenants()
      setTenants(list)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar clínicas.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isSuperAdmin) void reload()
  }, [isSuperAdmin, reload])

  if (tenantLoading) {
    return (
      <AppLayout title="Clínicas">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">A carregar…</CardContent>
        </Card>
      </AppLayout>
    )
  }

  if (!isSuperAdmin) {
    return (
      <AppLayout title="Clínicas">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Acesso restrito ao super admin. Peça a um super admin para promover sua conta.
          </CardContent>
        </Card>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Clínicas (Multi-tenant)">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Clínicas</h1>
            <p className="text-xs text-muted-foreground">
              Cada clínica é um tenant isolado: dados, branding e integrações próprias.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>Nova clínica</Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <CreateTenantDialog
              onCreated={async () => {
                setCreateOpen(false)
                await reload()
              }}
            />
          </Dialog>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {loading ? 'A carregar…' : `${tenants.length} clínica(s)`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border/40">
              {tenants.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{t.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <code className="rounded bg-muted/60 px-1 py-0.5">{t.id}</code>
                      {' · '}
                      {t.brand.app_name}
                      {!t.active ? <span className="ml-2 text-amber-600">inativa</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="size-4 rounded-full border border-border/40"
                      style={{ backgroundColor: t.brand.primary_color }}
                      aria-label="Cor primária"
                    />
                    <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                      Editar
                    </Button>
                  </div>
                </li>
              ))}
              {!loading && tenants.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  Nenhuma clínica encontrada.
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <EditTenantDialog
            tenant={editing}
            onSaved={async () => {
              setEditing(null)
              await reload()
            }}
          />
        ) : null}
      </Dialog>
    </AppLayout>
  )
}

function CreateTenantDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [appName, setAppName] = useState('')
  const [primary, setPrimary] = useState(EMPTY_BRAND.primary_color)
  const [accent, setAccent] = useState(EMPTY_BRAND.accent_color)
  const [seed, setSeed] = useState(true)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async () => {
    if (!id.trim() || !name.trim()) {
      toast.error('Preencha slug e nome.')
      return
    }
    setSaving(true)
    try {
      await createTenant({
        id: id.trim(),
        name: name.trim(),
        brand: {
          ...EMPTY_BRAND,
          app_name: appName.trim() || name.trim(),
          primary_color: primary,
          accent_color: accent,
        },
        seedFromTemplate: seed,
      })
      toast.success('Clínica criada.')
      await onCreated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nova clínica</DialogTitle>
        <DialogDescription>
          Cria um tenant isolado. Marcando "Clonar template", copia pipelines, etapas, campos,
          salas e configs do Instituto Lorena como ponto de partida.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label htmlFor="t-id">Slug (URL-safe)</Label>
          <Input
            id="t-id"
            placeholder="clinica-x"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Letras minúsculas, números e hífen. Não muda depois.
          </p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="t-name">Nome legal</Label>
          <Input id="t-name" placeholder="Clínica X Ltda" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="t-app-name">Nome exibido no CRM</Label>
          <Input
            id="t-app-name"
            placeholder="Ex.: Clínica X · Atendimento"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="t-primary">Cor primária</Label>
            <Input id="t-primary" type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="t-accent">Cor de destaque</Label>
            <Input id="t-accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
          Clonar template do Instituto Lorena (pipelines, salas, etiquetas, configs de IA)
        </label>
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? 'A criar…' : 'Criar clínica'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

function EditTenantDialog({ tenant, onSaved }: { tenant: Tenant; onSaved: () => Promise<void> }) {
  const [brand, setBrand] = useState<TenantBrand>(tenant.brand)
  const [integrations, setIntegrations] = useState<TenantIntegrations>({
    manychat: {},
    evolution: {},
  })
  const [loadingIntegrations, setLoadingIntegrations] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setLoadingIntegrations(true)
    void fetchTenantIntegrations(tenant.id)
      .then(setIntegrations)
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler integrações.'))
      .finally(() => setLoadingIntegrations(false))
  }, [tenant.id])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateTenantBrand(tenant.id, brand)
      await updateTenantIntegrations(tenant.id, integrations)
      toast.success('Clínica atualizada.')
      await onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const mc = integrations.manychat
  const updateManychat = (patch: Partial<TenantIntegrations['manychat']>) => {
    setIntegrations((prev) => ({ ...prev, manychat: { ...prev.manychat, ...patch } }))
  }
  const updateManychatChannel = (
    ch: 'instagram' | 'whatsapp',
    patch: Partial<NonNullable<TenantIntegrations['manychat']['instagram']>>,
  ) => {
    setIntegrations((prev) => ({
      ...prev,
      manychat: { ...prev.manychat, [ch]: { ...(prev.manychat?.[ch] ?? {}), ...patch } },
    }))
  }

  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{tenant.name}</DialogTitle>
        <DialogDescription>
          Slug: <code className="rounded bg-muted/60 px-1">{tenant.id}</code>
        </DialogDescription>
      </DialogHeader>

      <section className="grid gap-3 border-b border-border/40 pb-4">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
          Marca
        </h3>
        <div className="grid gap-1">
          <Label htmlFor="b-name">Nome exibido</Label>
          <Input
            id="b-name"
            value={brand.app_name}
            onChange={(e) => setBrand({ ...brand, app_name: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="b-primary">Cor primária</Label>
            <Input
              id="b-primary"
              type="color"
              value={brand.primary_color}
              onChange={(e) => setBrand({ ...brand, primary_color: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="b-accent">Cor de destaque</Label>
            <Input
              id="b-accent"
              type="color"
              value={brand.accent_color}
              onChange={(e) => setBrand({ ...brand, accent_color: e.target.value })}
            />
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="b-logo">URL do logo (opcional)</Label>
          <Input
            id="b-logo"
            placeholder="https://…/logo.svg"
            value={brand.logo_url ?? ''}
            onChange={(e) => setBrand({ ...brand, logo_url: e.target.value || null })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="b-phone">Telefone de suporte</Label>
            <Input
              id="b-phone"
              value={brand.support_phone ?? ''}
              onChange={(e) => setBrand({ ...brand, support_phone: e.target.value || null })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="b-email">E-mail de suporte</Label>
            <Input
              id="b-email"
              type="email"
              value={brand.support_email ?? ''}
              onChange={(e) => setBrand({ ...brand, support_email: e.target.value || null })}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
          ManyChat
        </h3>
        {loadingIntegrations ? (
          <p className="text-xs text-muted-foreground">A carregar…</p>
        ) : (
          <>
            <div className="grid gap-1">
              <Label htmlFor="mc-api">API Key ManyChat</Label>
              <Input
                id="mc-api"
                placeholder="Em branco = usa secrets globais"
                value={mc.api_key ?? ''}
                onChange={(e) => updateManychat({ api_key: e.target.value || undefined })}
              />
            </div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Instagram (DM)
            </h4>
            <div className="grid gap-2 pl-3">
              <Input
                placeholder="flow_ns Instagram (content...)"
                value={mc.instagram?.flow_ns ?? ''}
                onChange={(e) => updateManychatChannel('instagram', { flow_ns: e.target.value || undefined })}
              />
              <Input
                placeholder="message_tag (HUMAN_AGENT…) — opcional"
                value={mc.instagram?.message_tag ?? ''}
                onChange={(e) => updateManychatChannel('instagram', { message_tag: e.target.value || undefined })}
              />
            </div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              WhatsApp via ManyChat
            </h4>
            <div className="grid gap-2 pl-3">
              <Input
                placeholder="flow_ns WhatsApp"
                value={mc.whatsapp?.flow_ns ?? ''}
                onChange={(e) => updateManychatChannel('whatsapp', { flow_ns: e.target.value || undefined })}
              />
              <Input
                placeholder="message_tag WhatsApp"
                value={mc.whatsapp?.message_tag ?? ''}
                onChange={(e) => updateManychatChannel('whatsapp', { message_tag: e.target.value || undefined })}
              />
            </div>
          </>
        )}
      </section>

      <div className={cn('mt-4 rounded-lg border border-border/40 bg-muted/20 p-3 text-[11px] text-muted-foreground')}>
        <strong className="text-foreground">Como apontar webhooks:</strong>
        <ul className="mt-1 list-disc pl-4">
          <li>
            ManyChat External Request: incluir <code className="rounded bg-background px-1">"tenant_slug": "{tenant.id}"</code>{' '}
            no body.
          </li>
          <li>
            WhatsApp (Evolution): associar a instância em{' '}
            <code className="rounded bg-background px-1">whatsapp_channel_instances.tenant_id = '{tenant.id}'</code>.
          </li>
        </ul>
      </div>

      <DialogFooter>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'A salvar…' : 'Salvar alterações'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
