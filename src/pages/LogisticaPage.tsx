import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Package, RefreshCw, Truck } from 'lucide-react'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listarEnviosMe, type MeOrderResumo } from '@/services/crmFrete'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'

/**
 * Logística: cruza a venda paga com a etiqueta na conta do Melhor Envio.
 *
 * Não existe tabela de envios no banco — a conta ME é a fonte da verdade e o CRM guarda só
 * o carimbo em `lead.custom_fields.entrega`. Então o casamento é feito aqui, e o que
 * interessa ao operador são justamente as duas pontas soltas: venda paga que nunca virou
 * etiqueta (o cliente está esperando) e etiqueta sem venda correspondente (pode ser
 * reenvio, pode ser erro de digitação no destinatário).
 */

type VendaPaga = {
  id: string
  nome: string
  telefone: string
  valorCents: number
  kit: string | null
  pagoEm: string | null
}

/** Últimos 8 dígitos: ignora +55, DDD com e sem 9, e formatação. */
function chaveTelefone(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d.slice(-8) : ''
}

function chaveNome(v: string | null | undefined): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()
}

function brl(cents: number | null): string {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dia(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

/** Estado do envio em português, a partir do status cru do Melhor Envio. */
const ESTADO: Record<string, { label: string; cls: string }> = {
  pending: { label: 'No carrinho', cls: 'bg-amber-500/10 text-amber-700 ring-amber-500/30' },
  paid: { label: 'Etiqueta paga', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  generated: { label: 'Etiqueta gerada', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  posted: { label: 'Postado', cls: 'bg-violet-500/10 text-violet-700 ring-violet-500/30' },
  delivered: { label: 'Entregue', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30' },
  canceled: { label: 'Cancelado', cls: 'bg-rose-500/10 text-rose-700 ring-rose-500/30' },
}

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1'

export function LogisticaPage() {
  const [carregando, setCarregando] = useState(true)
  const [envios, setEnvios] = useState<MeOrderResumo[]>([])
  const [vendas, setVendas] = useState<VendaPaga[]>([])
  const [erroMe, setErroMe] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErroMe(null)
    try {
      const [me, pagas] = await Promise.all([
        listarEnviosMe(3),
        (async (): Promise<VendaPaga[]> => {
          if (!supabase) return []
          const { data } = await supabase
            .from('rede_payments')
            .select('id, customer_name, phone, amount_cents, kit, paid_at, status')
            .in('status', ['paid', 'approved', 'confirmed'])
            .order('paid_at', { ascending: false })
            .limit(300)
          return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            id: String(r.id),
            nome: String(r.customer_name ?? '') || 'Cliente',
            telefone: String(r.phone ?? ''),
            valorCents: Number(r.amount_cents ?? 0),
            kit: (r.kit as string | null) ?? null,
            pagoEm: (r.paid_at as string | null) ?? null,
          }))
        })(),
      ])
      setEnvios(me.orders)
      setVendas(pagas)
      // 401 aqui é token revogado no painel do ME, não bug do CRM: quem renova é a tela
      // de integrações. Sem o aviso, a lista aparece vazia e parece que não há envio.
      if (!me.ok) setErroMe(me.error)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a logística.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const { comEtiqueta, semEtiqueta, orfaos } = useMemo(() => {
    const porTelefone = new Map<string, MeOrderResumo>()
    const porNome = new Map<string, MeOrderResumo>()
    for (const o of envios) {
      const t = chaveTelefone(o.toPhone)
      if (t) porTelefone.set(t, o)
      const n = chaveNome(o.toName)
      if (n) porNome.set(n, o)
    }

    const casados = new Set<string>()
    const com: { venda: VendaPaga; envio: MeOrderResumo }[] = []
    const sem: VendaPaga[] = []
    for (const v of vendas) {
      const envio = porTelefone.get(chaveTelefone(v.telefone)) ?? porNome.get(chaveNome(v.nome))
      if (envio) {
        casados.add(envio.id)
        com.push({ venda: v, envio })
      } else {
        sem.push(v)
      }
    }
    return { comEtiqueta: com, semEtiqueta: sem, orfaos: envios.filter((o) => !casados.has(o.id)) }
  }, [envios, vendas])

  return (
    <AppLayout
      title="Logística"
      subtitle="A venda paga de um lado, a etiqueta do Melhor Envio do outro. O que sobra é o que precisa de você."
      actions={
        <Button variant="outline" size="sm" className="rounded-xl" onClick={() => void carregar()} disabled={carregando}>
          <RefreshCw className={cn('size-3.5', carregando && 'animate-spin')} aria-hidden /> Atualizar
        </Button>
      }
    >
      {erroMe ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-amber-900">Não deu para ler a conta do Melhor Envio</p>
            <p className="text-amber-800">
              {erroMe.startsWith('http_401') || erroMe === 'not_connected'
                ? 'A conexão com o Melhor Envio expirou. Reconecte em Configuração → Integrações.'
                : erroMe}
            </p>
          </div>
        </div>
      ) : null}

      {carregando ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Cartao titulo="Pagas sem etiqueta" valor={semEtiqueta.length} destaque={semEtiqueta.length > 0} />
            <Cartao titulo="Com etiqueta" valor={comEtiqueta.length} />
            <Cartao titulo="Etiquetas sem venda" valor={orfaos.length} destaque={orfaos.length > 0} />
          </div>

          <Bloco
            icone={<AlertTriangle className="size-4" aria-hidden />}
            titulo="Venda paga que ainda não virou etiqueta"
            ajuda="O cliente pagou e está esperando. Gere o envio pela ficha do pedido."
          >
            {semEtiqueta.length === 0 ? (
              <EmptyState icon={Package} title="Nada parado" description="Toda venda paga recente tem etiqueta." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Kit</TableHead>
                    <TableHead>Pago em</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {semEtiqueta.slice(0, 60).map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.nome}</TableCell>
                      <TableCell className="text-muted-foreground">{v.kit ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{dia(v.pagoEm)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(v.valorCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Bloco>

          <Bloco
            icone={<Truck className="size-4" aria-hidden />}
            titulo="Envios em andamento"
            ajuda="Etiquetas casadas com a venda. O rastreio abre no Melhor Rastreio."
          >
            {comEtiqueta.length === 0 ? (
              <EmptyState icon={Truck} title="Sem envios" description="Nenhuma etiqueta casou com venda recente." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Rastreio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comEtiqueta.slice(0, 80).map(({ venda, envio }) => {
                    const est = ESTADO[String(envio.status ?? '').toLowerCase()]
                    return (
                      <TableRow key={envio.id}>
                        <TableCell className="font-medium">{venda.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{envio.serviceName ?? '—'}</TableCell>
                        <TableCell>
                          <span className={cn(PILL, est?.cls ?? 'bg-muted text-muted-foreground ring-border')}>
                            {est?.label ?? envio.status ?? '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          {envio.tracking ? (
                            <a
                              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                              href={`https://www.melhorrastreio.com.br/rastreio/${envio.tracking}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {envio.tracking} <ExternalLink className="size-3" aria-hidden />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">sem rastreio ainda</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Bloco>

          <Bloco
            icone={<Package className="size-4" aria-hidden />}
            titulo="Etiqueta sem venda correspondente"
            ajuda="Pode ser reenvio ou nome/telefone digitado diferente do cadastro."
          >
            {orfaos.length === 0 ? (
              <EmptyState icon={Package} title="Nenhuma sobra" description="Toda etiqueta casou com uma venda." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Destinatário</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Criada em</TableHead>
                    <TableHead>Rastreio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orfaos.slice(0, 40).map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium">{o.toName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{o.serviceName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{dia(o.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{o.tracking ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Bloco>
        </div>
      )}
    </AppLayout>
  )
}

function Cartao({ titulo, valor, destaque }: { titulo: string; valor: number; destaque?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-card p-4 shadow-sm ring-1',
        destaque ? 'ring-amber-500/40' : 'ring-border/60',
      )}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{valor}</p>
    </div>
  )
}

function Bloco({
  icone,
  titulo,
  ajuda,
  children,
}: {
  icone: React.ReactNode
  titulo: string
  ajuda: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border/60">
      <header className="mb-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">{icone} {titulo}</h2>
        <p className="text-xs text-muted-foreground">{ajuda}</p>
      </header>
      {children}
    </section>
  )
}
