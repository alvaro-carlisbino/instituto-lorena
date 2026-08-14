import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, Home, Package, RefreshCw, Truck } from 'lucide-react'
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
 * Logística: o que ainda precisa sair, e por qual caminho.
 *
 * A régua NÃO é "tem etiqueta ou não". Só `envio_externo` (Correios via Melhor Envio) gera
 * etiqueta; retirada na clínica e entrega local de Maringá são resolvidas pela equipe e
 * nunca vão gerar uma. Medir todo mundo pela etiqueta acusava 85 pedidos "parados" num dia
 * em que nada estava parado — a maioria era retirada e motoboy.
 *
 * A conta do Melhor Envio é a fonte da verdade do envio (não existe tabela de envios), mas
 * o sinal primário aqui é o `tracking` que o próprio CRM carimba em
 * `lead.custom_fields.entrega`: ele não depende de casar nome ou telefone e por isso não
 * inventa pendência quando o destinatário foi digitado diferente do cadastro.
 */

/** Janela única para os dois lados. Comparar venda de 3 meses com as etiquetas recentes da conta cria pendência falsa. */
const DIAS = 60

/**
 * Acima disso, "sem etiqueta" não é pedido parado: é rastro perdido.
 *
 * Uma venda de 40 dias que não casou com nenhuma etiqueta quase certamente já foi entregue
 * — o que falta é o registro, porque o destinatário foi digitado diferente ou a etiqueta é
 * mais velha que a janela lida. Cobrar despacho disso é o alarme falso que mostrou 85
 * pedidos "parados" num dia em que nada estava parado.
 */
const DIAS_PENDENCIA_REAL = 21

type Modo = 'envio_externo' | 'retirada_clinica' | 'entrega_local_maringa' | 'indefinido'

type Venda = {
  id: string
  leadId: string | null
  nome: string
  telefone: string
  valorCents: number
  kit: string | null
  pagoEm: string | null
  modo: Modo
  cidade: string | null
  trackingDoLead: string | null
  /** Ids de pedido/carrinho ME que o CRM registrou na timeline deste lead. */
  meIds: string[]
}

/**
 * Ids de pedido ME citados na timeline: o CRM escreve "(#<id>)" no fechamento da venda e
 * "(carrinho #<id>)" no botão do painel. É a chave FORTE do casamento — não depende de o
 * destinatário ter sido digitado igual ao cadastro, nem de alguém ter aberto a ficha para
 * o rastreio ser carimbado. Dos 92 eventos de envio do último bimestre, 75 trazem o id.
 */
function idsMeDoTexto(conteudo: string): string[] {
  const out: string[] = []
  for (const m of conteudo.matchAll(/#\s*([0-9a-f]{8}-[0-9a-f-]{20,}|[0-9a-f]{12,})/gi)) out.push(m[1].toLowerCase())
  return out
}

const PRACA_LOCAL = new Set(['maringa', 'sarandi', 'paicandu', 'marialva'])

function semAcento(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Últimos 8 dígitos: ignora +55, DDD com e sem 9, e formatação. */
function chaveTelefone(v: string | null | undefined): string {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length >= 8 ? d.slice(-8) : ''
}

function chaveNome(v: string | null | undefined): string {
  return semAcento(String(v ?? ''))
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim()
}

/**
 * Modalidade da venda. Usa o `delivery_mode` quando existe; para o histórico anterior ao
 * campo, cai na mesma regra do backend: praça local (Maringá e vizinhas, PR) é entrega
 * interna, o resto vai pelos Correios. Sem endereço, fica `indefinido` e NÃO vira alarme —
 * não dá para cobrar envio de um pedido que ninguém sabe para onde vai.
 */
function classificar(entrega: Record<string, unknown> | null): { modo: Modo; cidade: string | null } {
  const cidade = entrega?.cidade != null ? String(entrega.cidade) : null
  const explicito = String(entrega?.delivery_mode ?? '').trim().toLowerCase()
  if (explicito === 'envio_externo' || explicito === 'retirada_clinica' || explicito === 'entrega_local_maringa') {
    return { modo: explicito as Modo, cidade }
  }
  const uf = String(entrega?.uf ?? '').trim().toUpperCase()
  if (cidade) {
    const c = semAcento(cidade.trim().toLowerCase())
    if (PRACA_LOCAL.has(c) && uf === 'PR') return { modo: 'entrega_local_maringa', cidade }
    return { modo: 'envio_externo', cidade }
  }
  return { modo: 'indefinido', cidade }
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

function diasDesde(iso: string | null): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null
}

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
  const [vendas, setVendas] = useState<Venda[]>([])
  const [erroMe, setErroMe] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErroMe(null)
    try {
      const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString()
      const [me, pagas] = await Promise.all([
        // Mesma janela dos dois lados: pedir só as vendas recentes e ler a conta do ME
        // inteira (ou vice-versa) produz pendência que não existe.
        listarEnviosMe({ sinceISO: desde }),
        (async (): Promise<Venda[]> => {
          if (!supabase) return []
          const { data } = await supabase
            .from('rede_payments')
            .select('id, lead_id, customer_name, phone, amount_cents, kit, paid_at, status')
            .in('status', ['paid', 'approved', 'confirmed'])
            .gte('paid_at', desde)
            .order('paid_at', { ascending: false })
            .limit(400)
          const linhas = (data ?? []) as Record<string, unknown>[]

          // A modalidade e o rastreio moram no lead, não no pagamento.
          const ids = [...new Set(linhas.map((r) => String(r.lead_id ?? '')).filter(Boolean))]
          const entregaPorLead = new Map<string, Record<string, unknown> | null>()
          const meIdsPorLead = new Map<string, string[]>()
          // `.in()` com centenas de ids estoura a URL do PostgREST — vai em lotes.
          for (let i = 0; i < ids.length; i += 100) {
            const lote = ids.slice(i, i + 100)
            const [{ data: leads }, { data: eventos }] = await Promise.all([
              supabase.from('leads').select('id, custom_fields').in('id', lote),
              supabase
                .from('interactions')
                .select('lead_id, content')
                .in('lead_id', lote)
                .eq('author', 'Melhor Envio')
                .gte('created_at', desde)
                .limit(1000),
            ])
            for (const l of (leads ?? []) as Record<string, unknown>[]) {
              const cf = (l.custom_fields ?? {}) as Record<string, unknown>
              entregaPorLead.set(String(l.id), (cf.entrega ?? null) as Record<string, unknown> | null)
            }
            for (const e of (eventos ?? []) as Record<string, unknown>[]) {
              const k = String(e.lead_id)
              const achados = idsMeDoTexto(String(e.content ?? ''))
              if (achados.length) meIdsPorLead.set(k, [...(meIdsPorLead.get(k) ?? []), ...achados])
            }
          }

          return linhas.map((r) => {
            const leadId = r.lead_id ? String(r.lead_id) : null
            const entrega = leadId ? entregaPorLead.get(leadId) ?? null : null
            const { modo, cidade } = classificar(entrega)
            return {
              id: String(r.id),
              leadId,
              nome: String(r.customer_name ?? '') || 'Cliente',
              telefone: String(r.phone ?? ''),
              valorCents: Number(r.amount_cents ?? 0),
              kit: (r.kit as string | null) ?? null,
              pagoEm: (r.paid_at as string | null) ?? null,
              modo,
              cidade,
              trackingDoLead: entrega?.tracking != null ? String(entrega.tracking) : null,
              meIds: leadId ? meIdsPorLead.get(leadId) ?? [] : [],
            }
          })
        })(),
      ])
      setEnvios(me.orders)
      setVendas(pagas)
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

  const { aDespachar, semRastro, aCaminho, internas, orfaos } = useMemo(() => {
    const porId = new Map<string, MeOrderResumo>()
    const porTelefone = new Map<string, MeOrderResumo>()
    const porNome = new Map<string, MeOrderResumo>()
    const porTracking = new Map<string, MeOrderResumo>()
    for (const o of envios) {
      porId.set(String(o.id).toLowerCase(), o)
      const t = chaveTelefone(o.toPhone)
      if (t) porTelefone.set(t, o)
      const n = chaveNome(o.toName)
      if (n) porNome.set(n, o)
      if (o.tracking) porTracking.set(o.tracking, o)
    }

    const casados = new Set<string>()
    const despachar: Venda[] = []
    const caminho: { venda: Venda; envio: MeOrderResumo | null }[] = []
    const dentro: Venda[] = []

    for (const v of vendas) {
      // Retirada e entrega local não passam pelos Correios: são trabalho da equipe, não
      // pendência de etiqueta. Ficam num bloco próprio, sem entrar no alarme.
      if (v.modo === 'retirada_clinica' || v.modo === 'entrega_local_maringa') {
        dentro.push(v)
        continue
      }
      if (v.modo === 'indefinido') continue

      // Ordem da certeza: id do pedido ME registrado no CRM → rastreio carimbado no lead →
      // telefone → nome. Nome é chute educado e por isso vem por último.
      const porRegistro = v.meIds.map((id) => porId.get(id)).find(Boolean)
      const porRastreio = v.trackingDoLead ? porTracking.get(v.trackingDoLead) : undefined
      const envio =
        porRegistro ?? porRastreio ?? porTelefone.get(chaveTelefone(v.telefone)) ?? porNome.get(chaveNome(v.nome)) ?? null
      if (envio) casados.add(envio.id)

      // O rastreio carimbado no lead já prova que a etiqueta existe, mesmo sem casar
      // com a conta (destinatário digitado diferente, etiqueta fora das páginas lidas).
      if (envio || v.trackingDoLead) caminho.push({ venda: v, envio })
      else despachar.push(v)
    }

    // Pendência de verdade é a recente. O que é antigo e não casou com nada já foi
    // entregue e perdeu o registro pelo caminho — vira conferência, não fila de despacho.
    const recente = (v: Venda) => {
      const d = diasDesde(v.pagoEm)
      return d == null || d <= DIAS_PENDENCIA_REAL
    }

    return {
      aDespachar: despachar.filter(recente),
      semRastro: despachar.filter((v) => !recente(v)),
      aCaminho: caminho,
      internas: dentro,
      orfaos: envios.filter((o) => !casados.has(o.id)),
    }
  }, [envios, vendas])

  return (
    <AppLayout
      title="Logística"
      subtitle={`Vendas pagas dos últimos ${DIAS} dias. Só envio pelos Correios gera etiqueta; retirada e entrega local ficam à parte.`}
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
          <div className="grid gap-3 sm:grid-cols-4">
            <Cartao titulo="A despachar" valor={aDespachar.length} destaque={aDespachar.length > 0} />
            <Cartao titulo="A caminho" valor={aCaminho.length} />
            <Cartao titulo="Retirada e local" valor={internas.length} />
            <Cartao titulo="Etiquetas sem venda" valor={orfaos.length} />
          </div>

          <Bloco
            icone={<AlertTriangle className="size-4" aria-hidden />}
            titulo="Correios, pago e ainda sem etiqueta"
            ajuda={`Envio externo pago nos últimos ${DIAS_PENDENCIA_REAL} dias e sem etiqueta. Gere pela ficha do pedido.`}
          >
            {aDespachar.length === 0 ? (
              <EmptyState icon={Package} title="Nada parado" description="Todo envio pelos Correios já tem etiqueta." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Pago em</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aDespachar.slice(0, 60).map((v) => {
                    const d = diasDesde(v.pagoEm)
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{v.cidade ?? '—'}</TableCell>
                        <TableCell className={cn('text-muted-foreground', d != null && d >= 3 && 'font-semibold text-amber-700')}>
                          {dia(v.pagoEm)}
                          {d != null ? ` · ${d}d` : ''}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(v.valorCents)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Bloco>

          {semRastro.length > 0 ? (
            <Bloco
              icone={<Package className="size-4" aria-hidden />}
              titulo="Antigos, sem rastro registrado"
              ajuda={`Envio externo de mais de ${DIAS_PENDENCIA_REAL} dias que não casou com nenhuma etiqueta. Quase sempre já foi entregue e o registro é que se perdeu — confira antes de tratar como pendência.`}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Pago em</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {semRastro.slice(0, 40).map((v) => {
                    const d = diasDesde(v.pagoEm)
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{v.cidade ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {dia(v.pagoEm)}
                          {d != null ? ` · ${d}d` : ''}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{brl(v.valorCents)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Bloco>
          ) : null}

          <Bloco
            icone={<Truck className="size-4" aria-hidden />}
            titulo="A caminho pelos Correios"
            ajuda="O rastreio abre no Melhor Rastreio."
          >
            {aCaminho.length === 0 ? (
              <EmptyState icon={Truck} title="Sem envios" description="Nenhum envio externo em trânsito na janela." />
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
                  {aCaminho.slice(0, 80).map(({ venda, envio }) => {
                    const est = envio ? ESTADO[String(envio.status ?? '').toLowerCase()] : undefined
                    const rastreio = envio?.tracking ?? venda.trackingDoLead
                    return (
                      <TableRow key={venda.id}>
                        <TableCell className="font-medium">{venda.nome}</TableCell>
                        <TableCell className="text-muted-foreground">{envio?.serviceName ?? '—'}</TableCell>
                        <TableCell>
                          <span className={cn(PILL, est?.cls ?? 'bg-muted text-muted-foreground ring-border')}>
                            {est?.label ?? (rastreio ? 'Etiqueta emitida' : '—')}
                          </span>
                        </TableCell>
                        <TableCell>
                          {rastreio ? (
                            <a
                              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                              href={`https://www.melhorrastreio.com.br/rastreio/${rastreio}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {rastreio} <ExternalLink className="size-3" aria-hidden />
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
            icone={<Home className="size-4" aria-hidden />}
            titulo="Retirada na clínica e entrega local"
            ajuda="Não geram etiqueta: quem entrega é a equipe. Está aqui só para você enxergar o volume."
          >
            {internas.length === 0 ? (
              <EmptyState icon={Home} title="Nenhuma" description="Nada de retirada ou entrega local na janela." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Como</TableHead>
                    <TableHead>Pago em</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {internas.slice(0, 60).map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.nome}</TableCell>
                      <TableCell>
                        <span className={cn(PILL, 'bg-muted text-muted-foreground ring-border')}>
                          {v.modo === 'retirada_clinica' ? 'Retirada' : 'Entrega local'}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{dia(v.pagoEm)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(v.valorCents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Bloco>

          <Bloco
            icone={<Package className="size-4" aria-hidden />}
            titulo="Etiqueta sem venda correspondente"
            ajuda="Costuma ser reenvio, ou nome e telefone digitados diferente do cadastro."
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
    <div className={cn('rounded-2xl bg-card p-4 shadow-sm ring-1', destaque ? 'ring-amber-500/40' : 'ring-border/60')}>
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
