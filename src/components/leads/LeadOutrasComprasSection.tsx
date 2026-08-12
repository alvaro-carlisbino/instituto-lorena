import { useEffect, useId, useMemo, useState } from 'react'
import { Package, TriangleAlert, Truck } from 'lucide-react'

import { PoloBadge } from '@/components/leads/PaymentBadge'
import { useTenant } from '@/context/TenantContext'
import { nfeSelo, type NfeSelo, type NfeTom } from '@/lib/nfeSelo'
import { cn } from '@/lib/utils'
import { carregarComprasDaPessoa, comprasEmCache, type CompraDaPessoa } from '@/services/crmComprasDaPessoa'

/**
 * "Cadê meu pedido?" quando o pedido está em OUTRO cadastro.
 *
 * 12/ago: a paciente consultou na clínica (lead do ManyChat, telefone sintético), comprou no site
 * do Tricopill na mesma tarde — o checkout criou um lead novo, em outro polo — e no dia da entrega
 * cobrou nota fiscal e reclamou da embalagem no WhatsApp da CLÍNICA. A atendente abriu a ficha e
 * não viu pedido, rastreio nem nota, porque tudo no 360 casa por `lead_id` único.
 *
 * Esta seção é SÓ LEITURA e cada linha vem etiquetada com o polo dono (PoloBadge). Sem etiqueta,
 * uma lista que mistura clínica e vendas é o primeiro passo para alguém somar os dois no
 * faturamento — e a regra da casa é que kanban, /leads e financeiro seguem por polo de propósito.
 * Não há aqui nenhum botão que mova lead ou venda de polo, e nunca deve haver.
 *
 * Sem compra em outro cadastro a seção some (`return null`): num CRM de clínica isso é a maioria
 * das fichas, e um bloco vazio em todas elas seria só ruído. O ERRO, esse, aparece: silenciar a
 * falha recria exatamente o problema que motivou a seção — a atendente concluindo que não existe
 * compra quando o sistema só não conseguiu olhar.
 */

const PILL = 'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1'

const TOM_NFE: Record<NfeTom, string> = {
  ok: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  falha: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300',
  pendente: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300',
  ausente: 'bg-muted text-muted-foreground ring-border/40',
}

// Mesma regra canônica de "pago" do BI e do selo de pagamento do card.
const PAGOS = new Set(['paid', 'pago', 'available', 'approved', 'completed'])
const FALHOS = new Set(['failed', 'declined', 'denied', 'refused', 'error', 'canceled', 'cancelled', 'cancelado'])

const brl = (centavos: number | null | undefined) =>
  ((centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dia = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

function seloDoPagamento(c: CompraDaPessoa): { label: string; cls: string } {
  const s = (c.status ?? '').toLowerCase()
  if (c.pagoEm || PAGOS.has(s)) return { label: 'Pago', cls: TOM_NFE.ok }
  if (FALHOS.has(s)) return { label: 'Falhou', cls: TOM_NFE.falha }
  return { label: 'Aguardando', cls: TOM_NFE.pendente }
}

/** Nota só existe em `rede_payments`; os outros gateways nem têm a coluna, e dizer "sem nota"
 *  para eles seria inventar uma informação que o CRM não tem. */
function seloDaNota(c: CompraDaPessoa): NfeSelo {
  if (c.origem === 'rede_payments') return nfeSelo(c.nfeStatus, c.nfeNumero)
  return {
    label: 'NF-e não registrada',
    tom: 'ausente',
    detalhe: 'Esta cobrança veio de um gateway que não guarda estado de nota no CRM. Confira no Bling antes de responder ao cliente.',
  }
}

function descreveItens(c: CompraDaPessoa): string {
  if (c.itens && c.itens.length > 0) {
    return c.itens.map((it) => `${it.qty ?? 1}× ${it.nome ?? 'item sem nome'}`).join(', ')
  }
  return c.descricao ?? c.kit ?? 'Pedido sem descrição'
}

/**
 * O que esconder: só o que a tela JÁ mostra, e o critério disso é o POLO do pagamento, não a
 * identidade do lead. "Pedidos da loja", o 360 e a lista de pagamentos leem sob a RLS
 * `tenant_id = current_tenant_id()` — uma compra do Tricopill pendurada num lead da CLÍNICA
 * (há 9 assim na base) não aparece em nenhuma delas mesmo sendo o mesmo lead. Filtrar por
 * `mesmoLead` sozinho jogava fora exatamente esse caso, que é o incidente de 12/ago outra vez.
 */
const visiveis = (linhas: CompraDaPessoa[] | null, poloAtivo: string) =>
  (linhas ?? []).filter((c) => !(c.mesmoLead && c.tenantId === poloAtivo))

/** Compara nome de gente sem punir acento, caixa ou espaço dobrado. */
const chaveDeNome = (v: string | null | undefined) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

function LinhaDeCompra({
  compra,
  compact,
  nomeDoLead,
}: {
  compra: CompraDaPessoa
  compact: boolean
  nomeDoLead?: string
}) {
  const pag = seloDoPagamento(compra)
  const nota = seloDaNota(compra)
  // O comprador que está no PAGAMENTO. A RPC casa irmão por DDD + 8 últimos dígitos, e telefone
  // repetido existe (linha de casal, número reciclado, celular da recepção): sem o nome na tela a
  // atendente não tem como perceber que a compra é de outra pessoa e responde sobre um pedido que
  // não é do cliente dela — valor, itens e rastreio de terceiro. Quando bate com o nome da ficha,
  // não polui: some.
  const comprador = compra.clienteNome
  const outroNome = !!comprador && !!nomeDoLead && chaveDeNome(comprador) !== chaveDeNome(nomeDoLead)
  const meta = [
    compra.metodo ? `${compra.metodo}${compra.parcelas && compra.parcelas > 1 ? ` ${compra.parcelas}x` : ''}` : null,
    compra.origin ? `via ${compra.origin}` : null,
    compra.freteCentavos ? `frete ${brl(compra.freteCentavos)}` : null,
    compra.pedidoBling ? `pedido #${compra.pedidoBling}` : null,
    // De onde veio o vínculo. Sem isso a compra de outra pessoa apareceria como mágica e
    // ninguém teria como desconfiar de um casamento errado.
    `casou por ${compra.casouPor}`,
  ].filter(Boolean).join(' · ')

  return (
    <div className={cn('rounded-md border border-border bg-background', compact ? 'px-2 py-1.5' : 'px-3 py-2')}>
      <div className="flex flex-wrap items-center gap-1.5">
        <PoloBadge name={compra.poloNome ?? compra.tenantId} />
        <span className="text-[11px] tabular-nums text-muted-foreground">{dia(compra.pagoEm ?? compra.criadoEm)}</span>
        <span className={cn('ml-auto font-semibold tabular-nums', compact ? 'text-xs' : 'text-sm')}>
          {brl(compra.valorCentavos)}
        </span>
      </div>

      <div className={cn('mt-1 break-words', compact ? 'text-xs' : 'text-sm')}>{descreveItens(compra)}</div>

      {outroNome ? (
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            Comprador: <strong className="font-semibold">{comprador}</strong> — nome diferente do
            desta ficha. Confirme antes de responder: pode ser a mesma pessoa com outro cadastro, ou
            outra pessoa no mesmo telefone.
          </span>
        </p>
      ) : comprador && !nomeDoLead ? (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Comprador: {comprador}</p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={cn(PILL, pag.cls)} title={`Status no gateway: ${compra.status ?? 'sem status'}`}>
          {pag.label}
        </span>
        <span className={cn(PILL, TOM_NFE[nota.tom])} title={nota.detalhe}>
          {nota.label}
        </span>
      </div>

      {compra.rastreioCodigo ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <Truck className="size-3.5 shrink-0" aria-hidden />
          <span className="font-mono text-foreground">{compra.rastreioCodigo}</span>
          {compra.rastreioServico ? <span>{compra.rastreioServico}</span> : null}
          {compra.rastreioStatus ? <span>· {compra.rastreioStatus}</span> : null}
          {compra.rastreioAtualizadoEm ? <span>· atualizado em {dia(compra.rastreioAtualizadoEm)}</span> : null}
        </div>
      ) : null}

      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{meta}</div>
    </div>
  )
}

export function LeadOutrasComprasSection({
  leadId,
  nomeDoLead,
  compact = false,
  className,
}: {
  leadId: string
  /** Nome de quem está na ficha. Sem ele a linha não tem como avisar que o comprador é outro. */
  nomeDoLead?: string
  /** Densidade da coluna do /chat: texto menor, caixa mais apertada. */
  compact?: boolean
  className?: string
}) {
  const headingId = useId()
  const { tenant } = useTenant()
  const [linhas, setLinhas] = useState<CompraDaPessoa[]>(() => comprasEmCache(leadId) ?? [])
  const [carregando, setCarregando] = useState(() => comprasEmCache(leadId) == null)
  const [erro, setErro] = useState<string | null>(null)
  // Filtra na renderização, não na gravação do estado: o polo ativo pode trocar sem que a RPC
  // seja chamada de novo (switcher de workspace), e o que fica escondido depende dele.
  const compras = useMemo(() => visiveis(linhas, tenant.id), [linhas, tenant.id])

  useEffect(() => {
    let vivo = true
    // Resposta ainda quente: entrega sem passar por "carregando". Vale para a troca de lead, que
    // o inicializador de estado acima não pega (ele só roda na primeira montagem).
    const guardado = comprasEmCache(leadId)
    if (guardado) {
      setLinhas(guardado)
      setErro(null)
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    carregarComprasDaPessoa(leadId)
      .then((dados) => {
        if (vivo) setLinhas(dados)
      })
      .catch((e) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'Não deu para conferir as outras compras.')
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [leadId])

  // Carregando discreto: uma linha de texto, sem caixa. A maioria das fichas termina sem nada
  // para mostrar, e uma moldura que aparece e some em toda ficha é pior que a espera.
  if (carregando) {
    return (
      <p className={cn('text-[11px] text-muted-foreground', className)}>Conferindo compras em outros cadastros…</p>
    )
  }

  if (erro) {
    return (
      <p className={cn('text-[11px] text-destructive', className)} title={erro}>
        Não deu para conferir compras em outros cadastros. Não conclua que não existe — tente de novo.
      </p>
    )
  }

  if (compras.length === 0) return null

  const Cabecalho = compact ? 'h3' : 'h2'

  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-md border border-border/80 bg-muted/10', compact ? 'p-2' : 'p-3', className)}
    >
      <Cabecalho
        id={headingId}
        className={cn(
          'mb-1 flex items-center gap-1.5 font-bold uppercase tracking-widest text-muted-foreground',
          compact ? 'text-[10px]' : 'text-xs',
        )}
      >
        <Package className="size-3.5 shrink-0" aria-hidden /> Outras compras desta pessoa
        <span className="font-mono font-normal text-foreground/70">({compras.length})</span>
      </Cabecalho>

      <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
        Compras que as outras seções desta tela não alcançam: estão em outro cadastro, ou em outro
        polo. Só leitura: nada aqui move lead nem venda. Confira o nome do comprador antes de
        responder.
      </p>

      <div className="space-y-1.5">
        {compras.map((c) => (
          <LinhaDeCompra
            key={`${c.origem}:${c.pagamentoId}`}
            compra={c}
            compact={compact}
            nomeDoLead={nomeDoLead}
          />
        ))}
      </div>
    </section>
  )
}
