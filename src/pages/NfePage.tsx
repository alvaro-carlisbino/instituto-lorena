import { diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, RefreshCw, ShieldAlert, CheckCircle2, XCircle, Loader2, Settings2, AlertTriangle, FileWarning } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  type NfeBacklog,
  type NfeBacklogFaixa,
  type NfeOrderRow,
  getBlingOrderConfig,
  setBlingOrderConfig,
  nfeBacklog,
  nfeListBling,
  nfeEmitOrder,
} from '@/services/crmBling'
import { useTenant } from '@/context/TenantContext'

// Emissão de NF-e em lote: depois da conciliação do dia, o operador filtra as vendas pagas,
// marca as que quer, e emite todas de uma vez pelo Bling. Cada linha volta com o desfecho
// (número da nota ou o motivo da rejeição do SEFAZ). Só o polo Tricopill tem Bling/NF-e.
//
// A tela também é o lugar onde o BURACO fiscal aparece, e isso é metade do trabalho dela.
// Ela abria em hoje..hoje, dizia "nenhum pedido no período" num dia sem venda e pintava
// rascunho de verde "Emitida" — enquanto todo o histórico de vendas pagas seguia sem uma
// única nota autorizada e o cliente já perguntava "não veio nota fiscal?". Agora o tamanho
// do backlog é a primeira coisa da página, sai do nosso banco (não do Bling), não depende
// do filtro e distingue rascunho de nota. Nada aqui transmite sozinho: quem aperta o botão
// é gente, e transmitir é ato fiscal.

// Usa o fuso DO NEGÓCIO, não o do navegador: o relatório é da clínica em Maringá mesmo
// quando alguém abre de outro fuso.
const todayStr = () => hojeLocal()
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtCpf = (v: string) => {
  const d = String(v ?? '').replace(/\D/g, '')
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (d || '—')
}
const fmtDate = (iso: string | null) => {
  if (!iso) return ''
  // Data do pedido vem como YYYY-MM-DD do Bling; parse local pra não voltar um dia no fuso.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}

type RowState = NfeOrderRow & { emitting?: boolean }

/**
 * Estado REAL da nota de um pedido.
 *
 * A tela pintava de verde "Emitida Nº X" qualquer linha com número — e rascunho do Bling
 * também tem número (todos os rascunhos gravados até hoje têm). Rascunho não é nota: não foi
 * à SEFAZ, não vale para o cliente e não vale para o contador. Número com status desconhecido
 * também não vira verde — o lado seguro é "não sabemos se saiu".
 */
type NfeEstado = 'autorizada' | 'transmitida' | 'rascunho' | 'erro' | 'indefinida' | 'ausente'
function estadoDaNota(r: { nfeStatus: string | null; nfeNumero: string | null }): NfeEstado {
  const s = (r.nfeStatus ?? '').toLowerCase()
  if (s.includes('autoriz')) return 'autorizada'
  // 'emitida' é só o 2xx do envio ao Bling. Quem autoriza é a SEFAZ, de forma assíncrona, e o
  // CRM não relê — então isto NÃO é verde. Preventivo: hoje não há nenhuma linha assim na base.
  if (s.includes('emit') || s.includes('transmit') || s.includes('enviad')) return 'transmitida'
  if (s.includes('erro') || s.includes('rejeit') || s.includes('deneg') || s.includes('fail')) return 'erro'
  if (s.includes('rascunho')) return 'rascunho'
  return r.nfeNumero ? 'indefinida' : 'ausente'
}
function rotuloEstado(estado: NfeEstado, numero: string | null): string {
  // 'gerada' é o marcador que a emissão em lote grava quando o Bling não devolve número.
  const n = numero && numero !== 'gerada' ? ` Nº ${numero}` : ''
  if (estado === 'autorizada') return `Autorizada${n}`
  if (estado === 'transmitida') return `Transmitida${n} · aguarda SEFAZ`
  if (estado === 'rascunho') return `Rascunho${n}`
  if (estado === 'indefinida') return `Documento${n} · estado não confirmado`
  if (estado === 'erro') return n ? `Erro · rascunho${n}` : 'Erro'
  return 'Sem nota'
}
const TITULO_ESTADO: Record<NfeEstado, string> = {
  autorizada: 'Nota autorizada pela SEFAZ.',
  transmitida: 'O Bling aceitou a transmissão, mas a autorização da SEFAZ é assíncrona e o CRM não relê. Confira no Bling antes de dizer ao cliente que a nota saiu.',
  rascunho: 'Rascunho no Bling: o documento existe, mas NÃO foi transmitido à SEFAZ — não vale como nota. A transmissão é feita no Bling.',
  indefinida: 'O Bling já tem documento para este pedido, mas o CRM não registrou se ele foi autorizado. Confira no Bling antes de dizer ao cliente que a nota saiu.',
  erro: 'A emissão falhou. O motivo está logo abaixo.',
  ausente: 'Nenhuma nota foi gerada para este pedido.',
}
const ESTADO_META: Record<NfeEstado, { cls: string; linha?: string }> = {
  autorizada: { cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300', linha: 'bg-emerald-500/[0.06]' },
  transmitida: { cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300', linha: 'bg-amber-500/[0.06]' },
  rascunho: { cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300', linha: 'bg-amber-500/[0.06]' },
  indefinida: { cls: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300', linha: 'bg-amber-500/[0.06]' },
  erro: { cls: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300', linha: 'bg-rose-500/[0.06]' },
  ausente: { cls: 'bg-muted text-muted-foreground ring-border/40' },
}

const TONS = {
  rose: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300',
  amber: 'bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300',
  muted: 'bg-muted text-muted-foreground ring-border/40',
} as const

/** Uma fatia do backlog (quantos pedidos e quanto dinheiro). Some quando é zero. */
function Faixa({ rotulo, faixa, tom }: { rotulo: string; faixa: NfeBacklogFaixa; tom: keyof typeof TONS }) {
  if (faixa.pedidos === 0) return null
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ring-1', TONS[tom])}>
      <strong className="font-semibold tabular-nums">{faixa.pedidos}</strong> {rotulo}
      <span className="tabular-nums opacity-80">· {brl(faixa.valorCents)}</span>
    </span>
  )
}

// Período padrão da lista: 30 dias, não "hoje". Abrir em hoje..hoje fazia a tela dizer
// "nenhum pedido de venda no Bling no período" num dia sem venda, e quem abria ia embora
// achando que estava tudo em dia — com o backlog inteiro atrás daquela frase.
const INICIO_PADRAO_DIAS = 30

export function NfePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [from, setFrom] = useState(diaLocalComOffset(-(INICIO_PADRAO_DIAS - 1)))
  const [to, setTo] = useState(todayStr())
  // O período que foi de fato CARREGADO, para rotular os números pelo que está na tela e
  // não pelo que está digitado no filtro (o card já disse "hoje" com outro filtro na tela).
  const [carregado, setCarregado] = useState<{ de: string; ate: string } | null>(null)
  const [backlog, setBacklog] = useState<NfeBacklog | null>(null)
  const [backlogErro, setBacklogErro] = useState<string | null>(null)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [emitting, setEmitting] = useState(false)

  // Config fiscal (o contador informa o ID da natureza de operação no Bling).
  const [naturezaId, setNaturezaId] = useState('')
  const [transmit, setTransmit] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const savedNaturezaRef = useRef('')

  useEffect(() => {
    if (!isSalesPolo) return
    let alive = true
    void getBlingOrderConfig()
      .then((c) => {
        if (!alive) return
        setNaturezaId(c.naturezaOperacaoId)
        savedNaturezaRef.current = c.naturezaOperacaoId
        setTransmit(c.autoNfeTransmit)
      })
      .catch(() => {})
      .finally(() => { if (alive) setConfigLoaded(true) })
    return () => { alive = false }
  }, [isSalesPolo])

  const load = async () => {
    const de = from
    const ate = to
    setLoading(true)
    setSelected(new Set())
    setCarregado({ de, ate })
    // O buraco fiscal sai do NOSSO banco, então roda solto: se o token do Bling estiver
    // fora do ar a lista some, mas o tamanho do backlog continua na tela.
    void (async () => {
      try {
        setBacklogErro(null)
        setBacklog(await nfeBacklog(de, ate))
      } catch (e) {
        setBacklogErro(e instanceof Error ? e.message : 'Falha ao medir o backlog de NF-e')
      }
    })()
    try {
      const list = await nfeListBling(de, ate)
      setRows(list)
      setErroLista(null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao carregar os pedidos do Bling'
      // Zera as linhas: manter a lista velha embaixo de um período novo é a mesma mentira
      // que o filtro padrão fazia — a tela passaria a descrever um período que não carregou.
      setRows([])
      setErroLista(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isSalesPolo) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSalesPolo])

  const saveConfig = async () => {
    setSavingConfig(true)
    try {
      await setBlingOrderConfig({ naturezaOperacaoId: naturezaId.trim(), autoNfeTransmit: transmit })
      savedNaturezaRef.current = naturezaId.trim()
      toast.success('Configuração fiscal salva.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSavingConfig(false)
    }
  }

  // Só dá pra emitir quem ainda não tem nota; pedido cancelado no Bling também fica de fora.
  // (Continua valendo o número, não o estado: pedido com rascunho volta 'alreadyEmitted' do
  // Bling, então reselecionar só duplicaria rascunho — a transmissão se faz no Bling.)
  const pending = useMemo(() => rows.filter((r) => !r.nfeNumero && !r.canceled), [rows])
  const naLista = useMemo(() => {
    let autorizadas = 0
    let rascunhos = 0
    for (const r of rows) {
      const e = estadoDaNota(r)
      if (e === 'autorizada') autorizadas += 1
      else if (e === 'rascunho') rascunhos += 1
    }
    return { autorizadas, rascunhos }
  }, [rows])
  const selectableIds = useMemo(() => pending.map((r) => r.orderId), [pending])
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  const toggleAll = () => {
    setSelected((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set()
      return new Set(selectableIds)
    })
  }
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const patchRow = (orderId: string, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r) => (r.orderId === orderId ? { ...r, ...patch } : r)))
  }

  const emitSelected = async () => {
    const ids = [...selected].filter((id) => selectableIds.includes(id))
    if (ids.length === 0) return
    if (!naturezaId.trim()) {
      toast.error('Configure a natureza de operação da NF-e antes de emitir (seção Configuração fiscal).')
      return
    }
    setEmitting(true)
    let ok = 0
    let fail = 0
    // Sequencial: o Bling limita ~3 req/s e a emissão fiscal não deve correr em paralelo.
    // Sequencial não basta, porém: CADA nota gasta 4-6 chamadas ao Bling (pedido + produto
    // por item + contato + nota + envio), então sem respiro entre as notas o lote estoura o
    // teto e volta 429 no meio — foi o que derrubou 6 linhas em 25/jul/2026. A edge já faz
    // retry com backoff; esta pausa evita chegar no limite em primeiro lugar.
    let primeira = true
    for (const id of ids) {
      if (!primeira) await new Promise((r) => setTimeout(r, 700))
      primeira = false
      patchRow(id, { emitting: true, nfeError: null })
      try {
        const res = await nfeEmitOrder(id, transmit)
        if (res.ok || res.alreadyEmitted) {
          ok += 1
          patchRow(id, {
            emitting: false,
            nfeNumero: res.numero ?? 'gerada',
            // Não carimba 'emitida' por conta própria: com transmissão desligada o Bling
            // devolve 'rascunho', e em alreadyEmitted não devolve status nenhum — dizer
            // "emitida" ali é a mesma mentira que pintava rascunho de verde.
            nfeStatus: res.alreadyEmitted ? null : (res.status ?? null),
            nfeError: null,
          })
          setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
        } else {
          fail += 1
          // Se o rascunho nasceu e só a TRANSMISSÃO falhou, a nota já existe no Bling —
          // mostrar o número evita que o operador reemita e duplique o rascunho.
          patchRow(id, {
            emitting: false,
            nfeStatus: 'erro',
            nfeNumero: res.numero ?? null,
            nfeError: res.message ?? 'Falha ao emitir',
          })
        }
      } catch (e) {
        fail += 1
        patchRow(id, { emitting: false, nfeStatus: 'erro', nfeError: e instanceof Error ? e.message : 'Falha ao emitir' })
      }
    }
    setEmitting(false)
    // Com a transmissão desligada o que sai do Bling é RASCUNHO. Dizer "nota emitida" aqui
    // era o que fazia todo mundo achar que a nota tinha saído — e o cliente perguntar depois.
    const feito = transmit
      ? `${ok} ${ok === 1 ? 'nota emitida' : 'notas emitidas'}`
      : `${ok} ${ok === 1 ? 'rascunho gerado' : 'rascunhos gerados'} no Bling (rascunho ainda não é nota: falta transmitir)`
    if (fail === 0) toast.success(`${feito}.`)
    else if (ok === 0) toast.error(`Nada saiu. ${fail} com erro (veja o motivo em cada linha).`)
    else toast.warning(`${feito}, ${fail} com erro. Confira as linhas em vermelho.`)
    // O backlog acabou de mudar de tamanho; remede sem recarregar a lista do Bling.
    if (ok > 0 && carregado) {
      void nfeBacklog(carregado.de, carregado.ate).then(setBacklog).catch(() => {})
    }
  }

  const selectedCount = [...selected].filter((id) => selectableIds.includes(id)).length
  const naturezaMissing = configLoaded && !savedNaturezaRef.current
  const semBuraco = backlog != null && !backlogErro && backlog.total.semNota.pedidos === 0

  if (!isSalesPolo) {
    return (
      <AppLayout title="Emissão de NF-e" subtitle="Disponível no polo Tricopill (onde fica a integração com o Bling).">
        <EmptyState icon={FileText} title="NF-e é do polo Tricopill" description="Troque para o workspace Tricopill para emitir notas." />
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title="Emissão de NF-e"
      subtitle="O que está sem nota, e todos os pedidos de venda do Bling no período. Marque os que quer e gere as notas de uma vez."
    >
      <FinanceTabs isSalesPolo={isSalesPolo} />

      {/* O tamanho do buraco vem ANTES de tudo e NÃO depende do filtro de período: a tela
          abria em hoje..hoje e, num dia sem venda, dizia "nenhum pedido no período" com o
          histórico inteiro sem nota atrás daquela frase. Este bloco é o único que não passa
          pelo Bling — sai do nosso banco, contado lá (o PostgREST corta em 1000 calado). */}
      <Card className={cn('mb-4', semBuraco ? 'border-border' : 'border-amber-500/40 bg-amber-500/[0.05]')}>
        <CardContent className="space-y-2 pt-4 text-xs">
          <div className="flex items-center gap-1.5 font-medium">
            {semBuraco
              ? <CheckCircle2 className="size-3.5 text-emerald-600" />
              : <AlertTriangle className="size-3.5 text-amber-600" />}
            Vendas pagas sem nota fiscal — todo o histórico do polo
          </div>

          {backlogErro ? (
            <p className="text-destructive">
              Não consegui medir o backlog agora ({backlogErro}). O número não some por isso: clique
              em Carregar de novo antes de concluir que está tudo em dia.
            </p>
          ) : !backlog ? (
            <p className="text-muted-foreground">Somando as vendas pagas sem nota...</p>
          ) : semBuraco ? (
            <p>
              Nenhuma venda paga sem nota. {backlog.total.autorizada.pedidos} autorizadas até hoje.
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <strong className="text-2xl font-semibold tabular-nums">{backlog.total.semNota.pedidos}</strong>
                <span>{backlog.total.semNota.pedidos === 1 ? 'pedido pago' : 'pedidos pagos'} ·</span>
                <strong className="text-2xl font-semibold tabular-nums">{brl(backlog.total.semNota.valorCents)}</strong>
                {backlog.maisAntigoSemNota ? (
                  <span className="text-muted-foreground">o mais antigo é de {fmtDate(backlog.maisAntigoSemNota)}</span>
                ) : null}
              </p>

              {/* A frase dura só aparece enquanto for verdade: na primeira nota autorizada
                  ela vira o contador, sem ninguém precisar lembrar de apagar o texto. */}
              {backlog.total.autorizada.pedidos === 0 ? (
                <p>
                  <strong>Nenhuma NF-e foi autorizada pela SEFAZ até hoje.</strong> O certificado digital
                  do Bling segue pendente — sem ele a emissão para em rascunho, e rascunho não é nota:
                  não vale para o cliente que pede a nota nem para o contador.
                </p>
              ) : (
                <p>
                  {backlog.total.autorizada.pedidos} {backlog.total.autorizada.pedidos === 1 ? 'nota autorizada' : 'notas autorizadas'} pela
                  SEFAZ ({brl(backlog.total.autorizada.valorCents)}). O resto acima continua sem nota.
                </p>
              )}

              {/* Estas três faixas PARTICIONAM o "sem nota": somadas, dão o número do título.
                  A quarta é subconjunto da primeira e por isso vem separada, com o rótulo
                  dizendo "destes" — juntar as quatro numa fileira só fazia a conta estourar. */}
              <div className="flex flex-wrap gap-1.5">
                <Faixa rotulo="sem nenhuma tentativa" faixa={backlog.total.semTentativa} tom="rose" />
                <Faixa rotulo="parou em rascunho no Bling" faixa={backlog.total.rascunho} tom="amber" />
                <Faixa rotulo="deu erro na transmissão" faixa={backlog.total.erro} tom="rose" />
                {backlog.total.transmitida.pedidos > 0 ? (
                  <Faixa rotulo="transmitida, sem retorno da SEFAZ" faixa={backlog.total.transmitida} tom="amber" />
                ) : null}
              </div>
              {backlog.total.semPedidoBling.pedidos > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  <Faixa
                    rotulo="destes, sem pedido no Bling (nem dá pra emitir aqui)"
                    faixa={backlog.total.semPedidoBling}
                    tom="muted"
                  />
                </div>
              ) : null}

              {backlog.periodo && carregado ? (
                <p className="text-muted-foreground">
                  No período carregado ({fmtDate(carregado.de)} a {fmtDate(carregado.ate)}, por data de
                  pagamento): <strong className="text-foreground">{backlog.periodo.semNota.pedidos}</strong> sem
                  nota · <strong className="text-foreground">{brl(backlog.periodo.semNota.valorCents)}</strong>.
                  A lista abaixo é por data do PEDIDO no Bling, então os dois recortes não batem linha a linha.
                </p>
              ) : null}

              {backlog.parcial ? (
                <p className="text-destructive">
                  A leitura bateu no limite de páginas — o número acima está SUBESTIMADO.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pré-requisito fiscal */}
      {naturezaMissing ? (
        <Card className="mb-4 border-amber-300 bg-amber-50/60">
          <CardContent className="flex items-start gap-2 py-3 text-sm text-amber-800">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-semibold">Falta a configuração fiscal para emitir.</p>
              <p className="text-amber-700">
                Informe a natureza de operação abaixo e garanta que os produtos no Bling tenham NCM, CFOP e origem
                preenchidos (isso o contador faz). Sem isso o SEFAZ rejeita a nota.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Configuração fiscal */}
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="size-4 text-primary" /> Configuração fiscal
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="nfe-natureza">ID da natureza de operação (Bling)</Label>
            <Input
              id="nfe-natureza"
              value={naturezaId}
              onChange={(e) => setNaturezaId(e.target.value.replace(/\D/g, ''))}
              placeholder="Ex.: 12345678"
              inputMode="numeric"
              className="w-[200px]"
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="nfe-transmit" checked={transmit} onCheckedChange={(checked) => setTransmit(checked)} />
            <Label htmlFor="nfe-transmit" className="font-normal">
              Transmitir ao SEFAZ na hora (senão fica em rascunho no Bling)
            </Label>
          </div>
          <Button variant="outline" onClick={() => void saveConfig()} disabled={savingConfig}>
            {savingConfig ? 'Salvando...' : 'Salvar configuração'}
          </Button>
        </CardContent>
      </Card>

      {/* Filtro de período */}
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="nfe-from">De</Label>
            <Input id="nfe-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nfe-to">Até</Label>
            <Input id="nfe-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Carregar
          </Button>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {rows.length > 0 ? (
              <span>
                {pending.length} sem nota · {naLista.rascunhos} em rascunho · {naLista.autorizadas} autorizadas
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="size-4 text-primary" /> Pedidos do Bling ({rows.length})
            {carregado ? (
              <span className="text-xs font-normal text-muted-foreground">
                {fmtDate(carregado.de)} a {fmtDate(carregado.ate)}, por data do pedido
              </span>
            ) : null}
          </CardTitle>
          <Button onClick={() => void emitSelected()} disabled={emitting || selectedCount === 0}>
            {emitting ? (
              <><Loader2 className="size-4 animate-spin" /> Emitindo...</>
            ) : (
              <>Emitir selecionadas ({selectedCount})</>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={
                loading
                  ? 'Carregando...'
                  : erroLista
                    ? 'Não consegui falar com o Bling'
                    : 'Nenhum pedido de venda no Bling neste período'
              }
              // "Nenhum pedido" nunca quer dizer "nada pendente": o backlog está no card
              // de cima e não depende deste filtro.
              description={
                erroLista
                  ? `${erroLista} O backlog acima continua valendo — ele sai do banco do CRM, não do Bling.`
                  : 'Ajuste as datas e clique em Carregar. Aparecem aqui todos os pedidos do Bling, inclusive os criados fora do CRM.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todas" />
                    </TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>CPF</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Pedido Bling</TableHead>
                    <TableHead>NF-e</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const temNota = !!r.nfeNumero
                    const estado = estadoDaNota(r)
                    return (
                      <TableRow key={r.orderId} className={cn(ESTADO_META[estado].linha, r.canceled && 'opacity-50')}>
                        <TableCell>
                          <Checkbox
                            checked={selected.has(r.orderId)}
                            onCheckedChange={() => toggleOne(r.orderId)}
                            disabled={temNota || r.emitting || r.canceled}
                            aria-label={`Selecionar ${r.name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <span className="line-clamp-1 max-w-[14rem]" title={r.name}>{r.name}</span>
                          {r.canceled ? <span className="text-xs text-muted-foreground">(cancelado)</span> : null}
                        </TableCell>
                        <TableCell className="tabular-nums">{fmtCpf(r.cpf)}</TableCell>
                        <TableCell className="text-right tabular-nums">{brl(r.valueCents)}</TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{fmtDate(r.date)}</TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">#{r.orderNumero || r.orderId}</TableCell>
                        <TableCell>
                          {r.emitting ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" /> Emitindo...
                            </span>
                          ) : (
                            <div className="flex flex-col items-start gap-0.5">
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ring-1',
                                  ESTADO_META[estado].cls,
                                )}
                                title={TITULO_ESTADO[estado]}
                              >
                                {estado === 'autorizada' ? <CheckCircle2 className="size-3.5" /> : null}
                                {estado === 'erro' ? <XCircle className="size-3.5" /> : null}
                                {estado === 'rascunho' || estado === 'indefinida' ? <FileWarning className="size-3.5" /> : null}
                                {rotuloEstado(estado, r.nfeNumero)}
                              </span>
                              {estado === 'erro' && r.nfeError ? (
                                <span className="line-clamp-2 max-w-[280px] text-[11px] text-rose-600 dark:text-rose-300" title={r.nfeError}>
                                  {r.nfeError}
                                </span>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </AppLayout>
  )
}
