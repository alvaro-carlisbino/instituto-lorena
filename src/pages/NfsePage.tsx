// Nota de serviço (NFS-e) da clínica, emitida pela Focus NFe no ambiente nacional.
//
// Até aqui o financeiro emitia cada nota à mão no portal nfse.gov.br, tela por tela: paciente,
// serviço, valores, tributação. Esta tela faz o mesmo clique a partir do CRM, com as regras
// dele cravadas no backend (`crm-focus-nfse`): só pessoa física, descrição de uma lista fechada
// por tipo de atendimento, PIS/COFINS não retidos sobre o bruto, competência = hoje.
//
// A emissão é assíncrona e a SEFIN leva minutos: a linha nasce "processando" e a tela relê
// sozinha até virar "autorizada" (PDF) ou "erro" (com o motivo). Ninguém marca status na mão.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Badge } from '@/components/ui/badge'
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
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CepInput, CpfInput, formatCpf } from '@/components/ui/masked-input'
import { SearchPicker, type PickerItem } from '@/components/ui/search-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useTenant } from '@/context/TenantContext'
import { downloadCsv } from '@/lib/csvExport'
import { hojeLocal } from '@/lib/diaLocal'
import { cn } from '@/lib/utils'
import { buscarPacientes, carregarPaciente360, type PacienteEncontrado } from '@/services/pacienteBusca'
import {
  exclusoesIbsCbsCents,
  nfseCancelar,
  nfseConsultar,
  nfseEmitir,
  nfseGetConfig,
  nfseListar,
  type NfseConfig,
  type NfseNote,
} from '@/services/nfseFocus'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataHora = (iso: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
/** Número puro para o CSV: sem "R$" e com vírgula, que é o que o Excel em português soma. */
const numeroCsv = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))

const ROTULO_STATUS: Record<string, string> = {
  autorizado: 'Autorizada',
  cancelado: 'Cancelada',
  processando_autorizacao: 'Processando',
}

/**
 * ISS + PIS + COFINS sobre o bruto — o que a nota vai mostrar como "Exclusões e Reduções da
 * Base de Cálculo" depois de autorizar. Só para a PRÉVIA do formulário: na lista e no CSV vale
 * o que a SEFIN registrou no XML, nunca esta estimativa. Ver `exclusoesIbsCbsCents`.
 */
const PCT_EXCLUSOES = 0.0565

/** "1.250,00" → centavos. */
function paraCentavos(v: string): number {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function diasAtras(n: number): string {
  const d = new Date(`${hojeLocal()}T12:00:00`)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

type FormTomador = {
  nome: string
  cpf: string
  email: string
  cep: string
  logradouro: string
  numero: string
  bairro: string
}
const TOMADOR_VAZIO: FormTomador = { nome: '', cpf: '', email: '', cep: '', logradouro: '', numero: '', bairro: '' }

/** Como cada status aparece. Tudo que não é autorizado/cancelado/processando é erro. */
function StatusBadge({ status }: { status: string }) {
  if (status === 'autorizado') {
    return <Badge variant="outline" className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400"><CheckCircle2 /> Autorizada</Badge>
  }
  if (status === 'cancelado') {
    return <Badge variant="secondary"><Ban /> Cancelada</Badge>
  }
  if (status === 'processando_autorizacao') {
    return <Badge variant="outline"><Loader2 className="animate-spin" /> Processando</Badge>
  }
  return <Badge variant="destructive"><XCircle /> Erro</Badge>
}

export function NfsePage() {
  const { tenant } = useTenant()
  const isSalesPolo = tenant.poloType === 'sales'

  const [cfg, setCfg] = useState<NfseConfig | null>(null)
  const [cfgErro, setCfgErro] = useState<string | null>(null)

  // Formulário
  const [paciente, setPaciente] = useState<PickerItem | null>(null)
  const [achados, setAchados] = useState<PacienteEncontrado[]>([])
  const [leadId, setLeadId] = useState<string | null>(null)
  const [tomador, setTomador] = useState<FormTomador>(TOMADOR_VAZIO)
  const [servico, setServico] = useState<string>('')
  const [valor, setValor] = useState('')
  const [mostrarEndereco, setMostrarEndereco] = useState(false)
  const [emitindo, setEmitindo] = useState(false)
  const [carregandoPaciente, setCarregandoPaciente] = useState(false)

  // Lista
  const [de, setDe] = useState(diasAtras(30))
  const [ate, setAte] = useState(hojeLocal())
  const [filtroStatus, setFiltroStatus] = useState<string>('todos')
  const [notas, setNotas] = useState<NfseNote[]>([])
  const [carregando, setCarregando] = useState(false)
  const [relendo, setRelendo] = useState<string | null>(null)

  // Cancelamento
  const [cancelando, setCancelando] = useState<NfseNote | null>(null)
  const [justificativa, setJustificativa] = useState('')
  const [enviandoCancel, setEnviandoCancel] = useState(false)

  useEffect(() => {
    nfseGetConfig()
      .then(setCfg)
      .catch((e) => setCfgErro(e instanceof Error ? e.message : String(e)))
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      setNotas(await nfseListar({ de, ate, status: filtroStatus === 'todos' ? null : filtroStatus }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao listar notas')
    } finally {
      setCarregando(false)
    }
  }, [de, ate, filtroStatus])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
  }, [carregar])

  // Enquanto houver nota "processando" na lista, relê a Focus a cada 30s. O webhook também
  // atualiza a tabela, mas a recepção não quer apertar F5 por 8 minutos para ver o PDF.
  const pendentes = useMemo(() => notas.filter((n) => n.status === 'processando_autorizacao').map((n) => n.ref), [notas])
  useEffect(() => {
    if (pendentes.length === 0) return
    const t = window.setInterval(async () => {
      await Promise.all(pendentes.slice(0, 10).map((ref) => nfseConsultar(ref).catch(() => null)))
      await carregar()
    }, 30_000)
    return () => window.clearInterval(t)
  }, [pendentes, carregar])

  const servicoEscolhido = useMemo(() => cfg?.servicos.find((s) => s.key === servico) ?? null, [cfg, servico])
  const cpfDigits = tomador.cpf.replace(/\D/g, '')
  const valorCents = paraCentavos(valor)
  const podeEmitir =
    !!cfg?.configured && !cfg.tributosPendentes && !emitindo &&
    cpfDigits.length === 11 && tomador.nome.trim().length >= 3 && !!servico && valorCents > 0

  async function escolherPaciente(pick: PickerItem) {
    setPaciente(pick)
    const p = achados.find((x) => `${x.tipo}:${x.ref}` === pick.id)
    setLeadId(p?.leadId ?? null)
    setTomador({ ...TOMADOR_VAZIO, nome: p?.nome ?? pick.label, cpf: p?.cpf ?? '' })
    if (!p) return
    // A ficha 360 traz o nome completo do cadastro, CPF, e-mail e o endereço de entrega.
    setCarregandoPaciente(true)
    try {
      const f = await carregarPaciente360(p.tipo, p.ref)
      const pac = f?.paciente
      if (pac) {
        setTomador({
          nome: pac.nome_completo || pac.nome || p.nome,
          cpf: pac.cpf || p.cpf || '',
          email: pac.email || '',
          cep: pac.entrega?.cep || '',
          logradouro: pac.entrega?.logradouro || '',
          numero: pac.entrega?.numero || '',
          bairro: pac.entrega?.bairro || '',
        })
        if (pac.entrega?.cep) setMostrarEndereco(true)
      }
    } catch {
      /* a busca já deu nome e CPF; o resto a pessoa completa */
    } finally {
      setCarregandoPaciente(false)
    }
  }

  function limparFormulario() {
    setPaciente(null)
    setLeadId(null)
    setTomador(TOMADOR_VAZIO)
    setServico('')
    setValor('')
    setMostrarEndereco(false)
  }

  async function emitir() {
    if (!podeEmitir) return
    setEmitindo(true)
    try {
      const r = await nfseEmitir({
        valorCents,
        servico,
        leadId,
        tomador: {
          documento: cpfDigits,
          nome: tomador.nome.trim(),
          email: tomador.email.trim() || undefined,
          cep: tomador.cep.replace(/\D/g, '') || undefined,
          logradouro: tomador.logradouro.trim() || undefined,
          numero: tomador.numero.trim() || undefined,
          bairro: tomador.bairro.trim() || undefined,
        },
      })
      if (r.ok) {
        toast.success('Nota enviada para a SEFIN. Ela aparece como "Processando" até a autorização chegar.')
        limparFormulario()
      } else {
        const motivo = r.erros?.map((e) => e.mensagem || e.codigo).filter(Boolean).join(' · ') || r.status
        toast.error(`A Focus recusou: ${motivo}`)
      }
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao emitir')
    } finally {
      setEmitindo(false)
    }
  }

  async function reler(ref: string) {
    setRelendo(ref)
    try {
      await nfseConsultar(ref)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao consultar')
    } finally {
      setRelendo(null)
    }
  }

  async function confirmarCancelamento() {
    if (!cancelando) return
    setEnviandoCancel(true)
    try {
      const r = await nfseCancelar(cancelando.ref, justificativa.trim())
      if (r.ok) {
        toast.success(`Nota ${cancelando.numero ?? ''} cancelada.`)
        setCancelando(null)
        setJustificativa('')
      } else {
        toast.error(r.detail || `A Focus não cancelou (${r.status}).`)
      }
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao cancelar')
    } finally {
      setEnviandoCancel(false)
    }
  }

  const totalAutorizado = useMemo(
    () => notas.filter((n) => n.status === 'autorizado').reduce((s, n) => s + n.valorServicoCents, 0),
    [notas],
  )

  /**
   * CSV do período para a planilha de controle do financeiro — que continua existindo até o
   * CRM substituir as planilhas. Traz o que ele lança à mão hoje lendo nota por nota, inclusive
   * as **exclusões da base do IBS/CBS** (ISS + PIS + COFINS), que o PDF da Focus deixa em branco.
   *
   * Nota de HOMOLOGAÇÃO fica de fora: não é documento fiscal, e uma linha dessas numa planilha
   * de controle vira receita que não existe. Fora significa fora — mas dito em voz alta, senão
   * o arquivo curto passa por completo.
   */
  const exportar = () => {
    const reais = numeroCsv
    const linhas = notas.filter((n) => n.ambiente === 'producao')
    const fora = notas.length - linhas.length
    if (linhas.length === 0) {
      toast.error(fora > 0
        ? 'Só há nota de homologação no período. Homologação não é documento fiscal e não entra na planilha.'
        : 'Nenhuma nota no período para exportar.')
      return
    }
    const header = [
      'Data', 'Hora', 'Número', 'Código de verificação', 'Tomador', 'CPF', 'Serviço',
      'Valor bruto', 'Alíquota ISS (%)', 'ISS', 'PIS', 'COFINS',
      'Exclusões (ISS+PIS+COFINS)', 'BC após exclusões', 'Status', 'PDF', 'XML', 'Referência',
    ]
    const body = linhas.map((n) => {
      const excl = exclusoesIbsCbsCents(n)
      const d = new Date(n.createdAt)
      return [
        d.toLocaleDateString('pt-BR'),
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        n.numero ?? '',
        n.codigoVerificacao ?? '',
        n.tomadorNome ?? '',
        n.tomadorDocumento ? formatCpf(n.tomadorDocumento) : '',
        n.descricaoServico ?? '',
        reais(n.valorServicoCents),
        n.aliquotaAplicada != null ? String(n.aliquotaAplicada).replace('.', ',') : '',
        reais(n.valorIssCents),
        reais(n.valorPisCents),
        reais(n.valorCofinsCents),
        reais(excl),
        excl != null ? reais(n.valorServicoCents - excl) : '',
        ROTULO_STATUS[n.status] ?? `Erro (${n.status})`,
        n.urlPdf ?? '',
        n.urlXml ?? '',
        n.ref,
      ]
    })
    downloadCsv(`nfse-clinica-${de}-a-${ate}.csv`, [header, ...body])
    toast.success(fora > 0
      ? `${linhas.length} nota(s) no arquivo. ${fora} de homologação ${fora === 1 ? 'ficou' : 'ficaram'} de fora: homologação não é documento fiscal.`
      : `${linhas.length} nota(s) no arquivo.`)
  }

  return (
    <AppLayout
      title="Nota de serviço (NFS-e)"
      subtitle="Emissão da nota da clínica no ambiente nacional, do jeito que o financeiro emite no portal: só pessoa física, descrição por tipo de atendimento, PIS/COFINS não retidos."
    >
      <FinanceTabs isSalesPolo={isSalesPolo} />

      {cfgErro && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 text-destructive" />
          <span>Não consegui ler a configuração da Focus: {cfgErro}</span>
        </div>
      )}
      {cfg && !cfg.configured && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 text-destructive" />
          <span>Este polo não tem a Focus NFe configurada. A NFS-e é da clínica.</span>
        </div>
      )}
      {cfg?.configured && cfg.ambiente === 'homologacao' && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 text-amber-600" />
          <span>
            <strong>Ambiente de homologação.</strong> As notas emitidas aqui não valem como documento fiscal. Servem para testar o fluxo.
          </span>
        </div>
      )}
      {cfg?.configured && cfg.tributosPendentes && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <ShieldAlert className="mt-0.5 size-4 text-destructive" />
          <span>Produção está travada: o percentual da Lei da Transparência não foi definido. Nada sai daqui até o financeiro configurar.</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        {/* ── Emitir ── */}
        <Card className="self-start">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="size-4" /> Emitir nota
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Paciente</Label>
              <SearchPicker
                title="Buscar paciente"
                placeholder="Escolher paciente"
                searchPlaceholder="Nome, telefone, CPF ou prontuário…"
                value={paciente}
                onSearch={async (q) => {
                  const lista = await buscarPacientes(q, 20, tenant.id)
                  setAchados(lista)
                  return lista.map((p) => ({
                    id: `${p.tipo}:${p.ref}`,
                    label: p.nome,
                    hint: [p.telefone, p.cpf ? `CPF ${formatCpf(p.cpf)}` : null].filter(Boolean).join(' · '),
                    searchable: [p.cpf, p.prontuario].filter(Boolean).join(' '),
                  }))
                }}
                onPick={(pick) => void escolherPaciente(pick)}
                onClear={limparFormulario}
              />
              <p className="text-[11px] text-muted-foreground">
                Escolher preenche nome, CPF e endereço do cadastro. Dá para corrigir antes de emitir.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="nome" className="text-xs">Nome completo do tomador</Label>
                <Input id="nome" value={tomador.nome} onChange={(e) => setTomador({ ...tomador, nome: e.target.value })} placeholder="Como está no documento" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cpf" className="text-xs">CPF</Label>
                <CpfInput id="cpf" value={tomador.cpf} onValueChange={(raw) => setTomador({ ...tomador, cpf: raw })} placeholder="000.000.000-00" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email" className="text-xs">E-mail (opcional)</Label>
                <Input id="email" type="email" value={tomador.email} onChange={(e) => setTomador({ ...tomador, email: e.target.value })} placeholder="recebe a nota" />
              </div>
            </div>

            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Só pessoa física. Nota para <strong>empresa (CNPJ)</strong> tem retenção diferente e é feita à mão pelo financeiro: avise o Kauan em vez de emitir aqui.
            </p>

            <div className="space-y-1">
              <Label className="text-xs">Serviço</Label>
              <Select value={servico} onValueChange={(v) => setServico(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Qual foi o atendimento?" />
                </SelectTrigger>
                <SelectContent>
                  {(cfg?.servicos ?? []).map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.descricao}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {servicoEscolhido && (
                <p className="text-[11px] text-muted-foreground">{servicoEscolhido.quando}</p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="valor" className="text-xs">Valor bruto (R$)</Label>
              <Input id="valor" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(e.target.value)} />
              {valorCents > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  ISS 2% ≈ {brl(Math.round(valorCents * 0.02))} · PIS 0,65% + COFINS 3% ≈ {brl(Math.round(valorCents * 0.0365))} (apuração própria, não retidos). A nota sai pelo bruto.
                  <br />
                  Exclusões da base do IBS/CBS ≈ {brl(Math.round(valorCents * PCT_EXCLUSOES))} (os três somados).
                </p>
              )}
            </div>

            <button
              type="button"
              className="text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => setMostrarEndereco((v) => !v)}
            >
              {mostrarEndereco ? 'Esconder endereço' : 'Endereço do tomador (opcional)'}
            </button>
            {mostrarEndereco && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="cep" className="text-xs">CEP</Label>
                  <CepInput id="cep" value={tomador.cep} onValueChange={(raw) => setTomador({ ...tomador, cep: raw })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="numero" className="text-xs">Número</Label>
                  <Input id="numero" value={tomador.numero} onChange={(e) => setTomador({ ...tomador, numero: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="logradouro" className="text-xs">Logradouro</Label>
                  <Input id="logradouro" value={tomador.logradouro} onChange={(e) => setTomador({ ...tomador, logradouro: e.target.value })} />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="bairro" className="text-xs">Bairro</Label>
                  <Input id="bairro" value={tomador.bairro} onChange={(e) => setTomador({ ...tomador, bairro: e.target.value })} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={() => void emitir()} disabled={!podeEmitir || carregandoPaciente}>
                {emitindo ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                Emitir NFS-e
              </Button>
              <Button variant="ghost" size="sm" onClick={limparFormulario} disabled={emitindo}>Limpar</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Competência é sempre a data de hoje. A SEFIN responde em alguns minutos; a nota aparece na lista como "Processando" e vira "Autorizada" sozinha.
            </p>
          </CardContent>
        </Card>

        {/* ── Lista ── */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="de" className="text-xs">De</Label>
              <Input id="de" type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ate" className="text-xs">Até</Label>
              <Input id="ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-[150px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v ?? 'todos')}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todas</SelectItem>
                  <SelectItem value="processando_autorizacao">Processando</SelectItem>
                  <SelectItem value="autorizado">Autorizadas</SelectItem>
                  <SelectItem value="cancelado">Canceladas</SelectItem>
                  <SelectItem value="erro_autorizacao">Com erro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" disabled={carregando} onClick={() => void carregar()}>
              <RefreshCw className={cn('size-4', carregando && 'animate-spin')} /> Atualizar
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={notas.length === 0}
              onClick={exportar}
              title="Baixa o período em CSV para lançar na planilha de controle, com ISS, PIS, COFINS e as exclusões da base do IBS/CBS."
            >
              <Download className="size-4" aria-hidden /> Exportar CSV
            </Button>
            <div className="flex-1" />
            <div className="text-right text-xs text-muted-foreground">
              {notas.filter((n) => n.status === 'autorizado').length} autorizada(s) · {brl(totalAutorizado)}
            </div>
          </div>

          {notas.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={carregando ? 'Carregando…' : 'Nenhuma nota no período'}
              description="As notas emitidas aqui aparecem nesta lista com status, PDF e o motivo quando a SEFIN recusa."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Emitida</TableHead>
                    <TableHead>Nº</TableHead>
                    <TableHead>Tomador</TableHead>
                    <TableHead>Serviço</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">ISS</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notas.map((n) => {
                    const erro = n.erros?.map((e) => e.mensagem || e.codigo).filter(Boolean).join(' · ')
                    const exclusao = exclusoesIbsCbsCents(n)
                    return (
                      <TableRow key={n.id}>
                        <TableCell className="whitespace-nowrap text-xs">{dataHora(n.createdAt)}</TableCell>
                        <TableCell className="text-xs font-medium">{n.numero ?? '—'}</TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="truncate text-sm">
                            {n.leadId ? <Link to={`/leads/${n.leadId}`} className="hover:underline">{n.tomadorNome ?? '—'}</Link> : (n.tomadorNome ?? '—')}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{n.tomadorDocumento ? formatCpf(n.tomadorDocumento) : '—'}</div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs">{n.descricaoServico ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm">{brl(n.valorServicoCents)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                          <div>{n.valorIssCents != null ? `${brl(n.valorIssCents)}${n.aliquotaAplicada != null ? ` (${n.aliquotaAplicada}%)` : ''}` : '—'}</div>
                          {exclusao != null && (
                            <div
                              className="text-[11px] text-muted-foreground/80"
                              title={`Exclusões e Reduções da Base de Cálculo do IBS/CBS: ISS ${brl(n.valorIssCents ?? 0)} + PIS ${brl(n.valorPisCents ?? 0)} + COFINS ${brl(n.valorCofinsCents ?? 0)}. O PDF da Focus deixa este campo em branco.`}
                            >
                              excl. {brl(exclusao)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1">
                              <StatusBadge status={n.status} />
                              {n.ambiente === 'homologacao' && <Badge variant="secondary">homologação</Badge>}
                            </div>
                            {erro && n.status !== 'autorizado' && n.status !== 'cancelado' && (
                              <span className="max-w-[260px] text-[11px] text-destructive">{erro}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {n.urlPdf && (
                              <Button size="sm" variant="outline" nativeButton={false} render={<a href={n.urlPdf} target="_blank" rel="noreferrer" />}>
                                <ExternalLink className="size-3.5" /> PDF
                              </Button>
                            )}
                            {n.urlXml && (
                              <Button size="sm" variant="ghost" nativeButton={false} render={<a href={n.urlXml} target="_blank" rel="noreferrer" />}>
                                XML
                              </Button>
                            )}
                            {/* A MESMA nota, desenhada pela SEFIN. O DANFSe do portal traz o bloco do
                                IBS/CBS que o PDF da Focus deixa em branco, e é o papel que o financeiro
                                compara. A consulta pública pede captcha; quem tem o portal do emitente
                                acha a nota pela lista de emitidas. */}
                            {n.urlConsulta && (
                              <Button size="sm" variant="ghost" nativeButton={false} render={<a href={n.urlConsulta} target="_blank" rel="noreferrer" />} title="Abrir esta nota no portal nacional (consulta pública, pede captcha)">
                                Portal
                              </Button>
                            )}
                            {n.status === 'processando_autorizacao' && (
                              <Button size="sm" variant="ghost" disabled={relendo === n.ref} onClick={() => void reler(n.ref)} title="Consultar a Focus agora">
                                <RefreshCw className={cn('size-3.5', relendo === n.ref && 'animate-spin')} />
                              </Button>
                            )}
                            {n.status === 'autorizado' && (
                              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setCancelando(n); setJustificativa('') }}>
                                Cancelar
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* O campo em branco no PDF que o financeiro cobrou. Fica escrito na tela porque a
              pergunta volta toda vez que alguém compara a nossa nota com a do portal. */}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <strong>"Exclusões e Reduções da Base de Cálculo"</strong> é ISS + PIS + COFINS, 5,65% do bruto: o que sai
            da base do IBS/CBS para o cálculo efetivo. O valor não existe no XML de nota nenhuma, nem na do portal
            nacional: quem calcula é o desenhista do PDF, e o da Focus só desenha quando a DPS leva o grupo IBS/CBS.
            <strong>Desde 21/ago a nota sai com o grupo</strong> (CST 000 · cClassTrib 000001 · indicador 030101,
            local da prestação), então o campo vem preenchido e o bloco traz junto o IBS e o CBS apurados. Nas notas
            emitidas antes disso o bloco saiu vazio, e nelas o número está aqui, na linha "excl.", e no CSV. O PDF do
            portal é outro desenho e sai pelo botão <strong>Portal</strong>. Em 2026 o IBS/CBS apurado é ano de teste.
          </p>
        </div>
      </div>

      <Dialog open={!!cancelando} onOpenChange={(o) => { if (!o && !enviandoCancel) setCancelando(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar a nota {cancelando?.numero ?? ''}</DialogTitle>
            <DialogDescription>
              {cancelando ? `${cancelando.tomadorNome ?? ''} · ${brl(cancelando.valorServicoCents)}. ` : ''}
              Cancelamento é ato fiscal e a SEFIN exige justificativa (mínimo 15 caracteres). Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="just" className="text-xs">Justificativa</Label>
            <Textarea id="just" rows={3} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Ex.: valor lançado errado; nota reemitida com o valor correto." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)} disabled={enviandoCancel}>Voltar</Button>
            <Button variant="destructive" onClick={() => void confirmarCancelamento()} disabled={enviandoCancel || justificativa.trim().length < 15}>
              {enviandoCancel ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
              Cancelar nota
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}

export default NfsePage
