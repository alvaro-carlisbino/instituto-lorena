import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import { Check, ClipboardList, PackagePlus, Printer, RefreshCw, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { SearchField } from '@/components/ui/search-field'
import { type PickerItem, SearchPicker } from '@/components/ui/search-picker'
import { Switch } from '@/components/ui/switch'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import { ScanBar } from '@/components/estoque/ScanBar'
import { VincularCodigoDialog } from '@/components/estoque/VincularCodigoDialog'
import { CabecalhoGrupo } from '@/components/kits/CabecalhoGrupo'
import { agruparMatMed, formatBRL, formatQtd, itemEhEscolha, produtosParaBusca, semCodigoBipado } from '@/components/kits/kitUi'
import { VendaDoKitPicker } from '@/components/kits/VendaDoKitPicker'
import { beep } from '@/lib/beep'
import { combinaBusca } from '@/lib/busca'
import { hojeLocal } from '@/lib/diaLocal'
import { acharItemPorCodigo } from '@/lib/estoqueCodigo'
import { ehCodigoDePacote } from '@/lib/etiquetaCme'
import {
  type LinhaMontagem,
  aplicarBipe,
  assinaturaDoModelo,
  atualizarPeloModelo,
  diferencaDoModelo,
  novaChave,
  resumirMontagem,
} from '@/lib/kitMontagem'
import { type PacienteDoKit, dicaDoPaciente } from '@/lib/pacienteDoKit'
import { cn } from '@/lib/utils'
import { agendaDoDiaParaKit, buscarPacientesDoKit, cirurgiasParaKit, horarioDoShosp } from '@/services/pacienteDoKit'
import type { StockItem } from '@/services/estoqueCompras'
import { type StockWarehouse, listWarehouseBalances, listWarehouses } from '@/services/estoqueArmazens'
import { type KitTemplate, createKit, imprimirFolhaDeItens } from '@/services/estoqueKits'
import { SITUACAO_PACOTE, acharPacote, usarPacotesNoKit } from '@/services/cme'

type Rascunho = {
  templateId: string
  leadId: string
  /** Venda da Central de Vendas: é o que põe o custo do kit na conta da cirurgia. */
  clinicSaleId: string | null
  leadName: string
  paciente: string
  procedimento: string
  data: string
  /** Setor de onde sai o material. Nulo = o do modelo (ou o padrão). */
  setorId?: string | null
  /** Prontuário do Shosp de quem não tem cadastro no CRM (o kit fica com o nome). */
  prontuario?: string | null
  /** Horário do Shosp de onde o paciente veio: casa o kit com o atendimento na conferência do SPA. */
  agendamento?: string | null
  /** Pacotes esterilizados da CME bipados na bandeja: ficam ligados ao paciente ao montar. */
  pacotesCme?: Array<{ codigo: string; nome: string; lote: string }>
  /** Retrato do modelo quando a bandeja foi carregada: diferente do de agora = o modelo mudou. */
  assinaturaModelo?: string
  /** Quando a bandeja começou: rascunho esquecido de outro dia fica à vista. */
  iniciadaEm?: string
  linhas: LinhaMontagem[]
}

const VAZIO: Rascunho = { templateId: '', leadId: '', clinicSaleId: null, leadName: '', paciente: '', procedimento: '', data: '', linhas: [] }

// O picker devolve no onPick o mesmo objeto que recebeu: o paciente inteiro (lead, prontuário,
// data do horário) vai junto do id e do rótulo.
type ItemPaciente = PickerItem & { paciente: PacienteDoKit }
const paraPicker = (lista: PacienteDoKit[]): ItemPaciente[] =>
  lista.map((p) => ({ id: p.chave, label: p.nome, hint: dicaDoPaciente(p), paciente: p }))

const quandoComecou = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Montar um Kit Cirúrgico CC é bipar 90 itens. A tela do CRM remonta quando a aba volta do
// foco, então sem rascunho guardado uma troca de aba jogava fora a bandeja inteira.
const chaveRascunho = (tenantId: string) => `kits:montagem:${tenantId}`
function lerRascunho(tenantId: string): Rascunho {
  try {
    const bruto = window.localStorage.getItem(chaveRascunho(tenantId))
    return bruto ? { ...VAZIO, ...(JSON.parse(bruto) as Partial<Rascunho>) } : VAZIO
  } catch {
    return VAZIO
  }
}

type Filtro = 'todos' | 'faltam' | 'problema'

export function MontarKit({
  tenantId,
  items,
  templates,
  onMontado,
  onItemAtualizado,
}: {
  tenantId: string
  items: StockItem[]
  templates: KitTemplate[]
  onMontado: () => void
  /** Código novo ensinado a um item: a página troca o item na lista para o próximo bipe achar. */
  onItemAtualizado: (item: StockItem) => void
}) {
  const [r, setR] = useState<Rascunho>(() => lerRascunho(tenantId))
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [pesquisa, setPesquisa] = useState('')
  const termo = useDeferredValue(pesquisa)
  const [editando, setEditando] = useState<string | null>(null)
  const [trocarModelo, setTrocarModelo] = useState<string | null>(null)
  const [recarregarModelo, setRecarregarModelo] = useState(false)
  const [codigoDesconhecido, setCodigoDesconhecido] = useState<string | null>(null)
  const [ultimaLeitura, setUltimaLeitura] = useState<string | null>(null)
  const [destaque, setDestaque] = useState<string | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const listaRef = useRef<HTMLDivElement>(null)
  // Leitor USB manda um código atrás do outro mais rápido que o React renderiza: o bipe lê a
  // bandeja daqui, senão o segundo bipe partiria da lista de antes do primeiro e o apagaria.
  const linhasRef = useRef(r.linhas)
  useEffect(() => {
    linhasRef.current = r.linhas
  }, [r.linhas])

  useEffect(() => {
    try {
      window.localStorage.setItem(chaveRascunho(tenantId), JSON.stringify(r))
    } catch {
      /* sem armazenamento: segue sem rascunho */
    }
  }, [r, tenantId])

  // O material sai do setor e, se lá não tiver, do Principal (stock_kit_montar): o aviso de
  // "sem saldo" olha esses dois, não o total de todos os setores.
  const [setores, setSetores] = useState<StockWarehouse[]>([])
  const [saldosPorSetor, setSaldosPorSetor] = useState<Array<{ warehouseId: string; itemId: string; qty: number }> | null>(null)
  useEffect(() => {
    Promise.all([listWarehouses(), listWarehouseBalances()])
      .then(([whs, saldos]) => {
        setSetores(whs)
        setSaldosPorSetor(saldos)
      })
      .catch(() => setSaldosPorSetor(null))
  }, [items])
  const modeloEscolhido = templates.find((t) => t.id === r.templateId)
  const setorEfetivo = r.setorId ?? modeloEscolhido?.warehouseId ?? setores.find((w) => w.isDefault)?.id ?? null

  const porId = useMemo(() => new Map(items.map((i) => [i.id, i] as const)), [items])
  const saldo = useMemo(() => {
    if (!saldosPorSetor || !setorEfetivo) return new Map(items.map((i) => [i.id, i.qty] as const))
    const padrao = setores.find((w) => w.isDefault)?.id ?? null
    const m = new Map<string, number>()
    for (const b of saldosPorSetor) {
      if (b.warehouseId === setorEfetivo) m.set(b.itemId, (m.get(b.itemId) ?? 0) + b.qty)
      else if (b.warehouseId === padrao && b.qty > 0) m.set(b.itemId, (m.get(b.itemId) ?? 0) + b.qty)
    }
    return m
  }, [items, saldosPorSetor, setorEfetivo, setores])
  const busca = useMemo(() => produtosParaBusca(items), [items])
  const resumo = useMemo(() => resumirMontagem(r.linhas, saldo), [r.linhas, saldo])
  const escolhas = r.linhas.filter((l) => itemEhEscolha(porId.get(l.itemId)?.name))
  const temControlado = r.linhas.some((l) => porId.get(l.itemId)?.controlled)
  const nomePaciente = r.paciente.trim() || r.leadName

  // Bandeja × modelo de agora. Com a assinatura guardada, compara o retrato; rascunho antigo
  // (sem assinatura) compara os itens que vieram do modelo.
  const diferenca = useMemo(
    () => (modeloEscolhido ? diferencaDoModelo(r.linhas, modeloEscolhido.items) : { sairam: 0, entraram: 0 }),
    [modeloEscolhido, r.linhas],
  )
  const modeloMudou =
    Boolean(modeloEscolhido) &&
    r.linhas.length > 0 &&
    (r.assinaturaModelo
      ? r.assinaturaModelo !== assinaturaDoModelo(modeloEscolhido?.items ?? [])
      : diferenca.sairam + diferenca.entraram > 0)

  // Agenda do Shosp de hoje: é o que a busca de paciente mostra antes de digitar.
  const [agendaDeHoje, setAgendaDeHoje] = useState<PacienteDoKit[]>([])
  const setorDoModelo = modeloEscolhido?.setor ?? null
  const ehSpa = setorDoModelo === 'spa'
  useEffect(() => {
    let vivo = true
    // Kit de cirurgia: agenda do centro cirúrgico (cirurgia não está no Shosp). SPA e sem modelo: Shosp.
    ;(setorDoModelo === 'cirurgia' ? cirurgiasParaKit(hojeLocal()) : agendaDoDiaParaKit(hojeLocal(), setorDoModelo))
      .then((lista) => vivo && setAgendaDeHoje(lista))
      .catch(() => vivo && setAgendaDeHoje([]))
    return () => {
      vivo = false
    }
  }, [setorDoModelo])
  const sugestoesAgenda = useMemo(() => paraPicker(agendaDeHoje), [agendaDeHoje])

  const set = (patch: Partial<Rascunho>) => setR((prev) => ({ ...prev, ...patch }))
  const setLinha = (chave: string, patch: Partial<LinhaMontagem>) =>
    setR((prev) => ({ ...prev, linhas: prev.linhas.map((l) => (l.chave === chave ? { ...l, ...patch } : l)) }))

  const escolherPaciente = (item: PickerItem) => {
    const p = (item as Partial<ItemPaciente>).paciente
    const leadId = p ? p.leadId : item.id.startsWith('lead:') ? item.id.slice(5) : null
    setR((prev) => ({
      ...prev,
      leadId: leadId ?? '',
      leadName: leadId ? p?.nome || item.label : '',
      // Escolhido na agenda cirúrgica: a venda da cirurgia já vem junto.
      clinicSaleId: p?.saleId ?? null,
      // Sem cadastro no CRM, o kit fica com o nome que está no Shosp.
      paciente: leadId ? '' : p?.nome || item.label,
      prontuario: p?.prontuario ?? null,
      agendamento: p?.agendamento ?? null,
      // Escolhido na agenda do dia: a data do kit é a do horário, se ainda não tinha data.
      data: prev.data || p?.data || '',
    }))
  }

  // Vindo da conferência do SPA (/kits/montar?agendamento=…): já entra com o paciente do horário.
  const [params, setParams] = useSearchParams()
  const agendamentoDaUrl = params.get('agendamento')
  useEffect(() => {
    if (!agendamentoDaUrl) return
    let vivo = true
    void horarioDoShosp(agendamentoDaUrl).then((p) => {
      if (!vivo) return
      if (p) {
        setR((prev) => ({
          ...prev,
          leadId: p.leadId ?? '',
          leadName: p.leadId ? p.nome : '',
          clinicSaleId: null,
          paciente: p.leadId ? '' : p.nome,
          prontuario: p.prontuario,
          agendamento: p.agendamento ?? null,
          data: p.data ?? prev.data,
        }))
        toast.success(`Paciente do horário: ${p.nome}. Agora escolha o modelo do kit.`)
      } else {
        toast.error('Horário não encontrado na agenda do Shosp.')
      }
      setParams(
        (atual) => {
          const n = new URLSearchParams(atual)
          n.delete('agendamento')
          return n
        },
        { replace: true },
      )
    })
    return () => {
      vivo = false
    }
  }, [agendamentoDaUrl, setParams])

  const aplicarModelo = (templateId: string) => {
    const tpl = templates.find((t) => t.id === templateId)
    set({
      templateId,
      // Modelo novo, setor do modelo novo: a troca feita à mão valia para o anterior.
      setorId: null,
      assinaturaModelo: assinaturaDoModelo(tpl?.items ?? []),
      iniciadaEm: new Date().toISOString(),
      linhas: (tpl?.items ?? []).map((i) => ({
        chave: novaChave(),
        itemId: i.itemId,
        qty: i.qty,
        conferido: 0,
        avulso: false,
        cobrancaCents: 0,
      })),
    })
    setFiltro('todos')
  }

  /** Traz a bandeja para o modelo de agora, sem perder o que já foi conferido. */
  const atualizarBandeja = () => {
    if (!modeloEscolhido) return
    const linhas = atualizarPeloModelo(linhasRef.current, modeloEscolhido.items)
    linhasRef.current = linhas
    set({ linhas, assinaturaModelo: assinaturaDoModelo(modeloEscolhido.items) })
    setFiltro('todos')
    toast.success(`Bandeja atualizada: ${linhas.length} itens do ${modeloEscolhido.name}.`)
  }

  const escolherModelo = (templateId: string) => {
    // Tocar no modelo que já está escolhido não pode ser um botão morto: com bandeja vazia,
    // carrega; com bandeja, oferece recarregar pelo modelo atual.
    if (templateId === r.templateId) {
      if (r.linhas.length === 0) aplicarModelo(templateId)
      else setRecarregarModelo(true)
      return
    }
    if (r.linhas.length > 0) setTrocarModelo(templateId)
    else aplicarModelo(templateId)
  }

  // Leva a linha bipada para a vista e pisca: com 90 itens, o bipe precisa mostrar onde caiu.
  useEffect(() => {
    if (!destaque) return
    listaRef.current?.querySelector(`[data-chave="${destaque}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const t = window.setTimeout(() => setDestaque(null), 1400)
    return () => window.clearTimeout(t)
  }, [destaque])

  const bipar = (item: StockItem) => {
    const vazia = linhasRef.current.length === 0
    const res = aplicarBipe(linhasRef.current, item.id)
    linhasRef.current = res.linhas
    set(vazia ? { linhas: res.linhas, iniciadaEm: new Date().toISOString() } : { linhas: res.linhas })
    const linha = res.linhas.find((l) => l.chave === res.chave)
    // A linha bipada precisa aparecer: busca que não acha este item sai da frente.
    if (pesquisa && !combinaBusca(pesquisa, item.name, item.sku, item.barcode)) setPesquisa('')
    beep(true)
    setDestaque(res.chave)
    setUltimaLeitura(
      res.resultado === 'novo'
        ? `${item.name}: entrou como avulso`
        : `${item.name}: ${formatQtd(linha?.conferido ?? 0)} de ${formatQtd(linha?.qty ?? 0)}${res.resultado === 'a_mais' ? ' (a mais)' : ''}`,
    )
  }

  // Etiqueta da CME (EAN 29…): não é item de estoque, é o pacote esterilizado que vai para o paciente.
  const biparPacoteCme = async (code: string) => {
    if ((r.pacotesCme ?? []).some((p) => p.codigo === code)) {
      setUltimaLeitura(`Pacote ${code} já está no kit`)
      return
    }
    try {
      const p = await acharPacote(code)
      if (!p) {
        beep(false)
        toast.error(`Nenhum pacote da CME com o código ${code}.`)
        return
      }
      if (p.situacao !== 'ok') {
        beep(false)
        toast.error(`${p.materialNome} (lote ${p.lote}): ${SITUACAO_PACOTE[p.situacao].rotulo}.`)
        return
      }
      beep(true)
      setR((prev) => ({ ...prev, pacotesCme: [...(prev.pacotesCme ?? []), { codigo: p.codigo, nome: p.materialNome, lote: p.lote }] }))
      setUltimaLeitura(`CME: ${p.materialNome} · lote ${p.lote}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao consultar o pacote')
    }
  }

  const onCode = (code: string) => {
    setPesquisa((p) => semCodigoBipado(p, code))
    if (ehCodigoDePacote(code)) {
      void biparPacoteCme(code.trim())
      return
    }
    const item = acharItemPorCodigo(items, code)
    if (!item) {
      beep(false)
      setCodigoDesconhecido(code)
      return
    }
    bipar(item)
  }

  const limpar = () => {
    setR(VAZIO)
    setPesquisa('')
    setUltimaLeitura(null)
  }

  const montar = async () => {
    setConfirmar(false)
    const linhas = r.linhas.filter((l) => l.itemId && l.qty > 0)
    setSalvando(true)
    try {
      const tpl = templates.find((t) => t.id === r.templateId)
      const nome = tpl?.name || 'Kit avulso'
      const { kitId, movements, controlled } = await createKit({
        templateId: tpl?.id || null,
        name: nome,
        leadId: r.leadId || null,
        clinicSaleId: r.leadId && !ehSpa ? r.clinicSaleId : null,
        shospProntuario: r.prontuario ?? null,
        shospAgendamento: r.agendamento ?? null,
        patientName: nomePaciente,
        procedureLabel: r.procedimento,
        scheduledFor: r.data || null,
        warehouseId: setorEfetivo,
        items: linhas.map((l) => ({ itemId: l.itemId, qty: l.qty, isExtra: l.avulso, chargeCents: l.cobrancaCents })),
      })
      toast.success(
        `${nome} montado${nomePaciente ? ` para ${nomePaciente}` : ''}: ${movements} ${movements === 1 ? 'baixa' : 'baixas'} no estoque` +
          (controlled > 0 ? `, ${controlled} no livro de controlados.` : '.'),
      )
      const pacotes = (r.pacotesCme ?? []).map((p) => p.codigo)
      if (pacotes.length > 0) {
        try {
          await usarPacotesNoKit(pacotes, kitId)
          toast.success(`${pacotes.length} ${pacotes.length === 1 ? 'pacote da CME ligado' : 'pacotes da CME ligados'} ao paciente.`)
        } catch (e) {
          toast.error(`Kit montado, mas os pacotes da CME não foram ligados: ${e instanceof Error ? e.message : 'erro'}`)
        }
      }
      limpar()
      onMontado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao montar kit')
    } finally {
      setSalvando(false)
    }
  }

  const pedirMontagem = () => {
    if (resumo.linhas === 0) {
      toast.error('Escolha um modelo ou bipe ao menos um item.')
      return
    }
    if (temControlado && !nomePaciente) {
      toast.error('O kit tem item controlado: informe o paciente (livro de controlados).')
      return
    }
    if (resumo.faltaConferir > 0 || resumo.semSaldo.size > 0 || escolhas.length > 0) setConfirmar(true)
    else void montar()
  }

  const linhasVisiveis = r.linhas.filter((l) => {
    const item = porId.get(l.itemId)
    if (termo && !combinaBusca(termo, item?.name, item?.sku, item?.barcode)) return false
    if (filtro === 'faltam') return l.conferido < l.qty
    if (filtro === 'problema') return resumo.semSaldo.has(l.itemId) || itemEhEscolha(item?.name) || !l.itemId
    return true
  })
  const linhaEditada = r.linhas.find((l) => l.chave === editando) ?? null
  const progresso = resumo.linhas > 0 ? Math.round((resumo.completas / resumo.linhas) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <section className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-2 sm:p-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Paciente</Label>
          <SearchPicker
            title="Buscar paciente"
            placeholder="Buscar paciente no CRM ou na agenda do Shosp"
            searchPlaceholder="Nome ou telefone…"
            emptyLabel="Ninguém com esse nome no CRM nem no Shosp. Digite o nome no campo abaixo."
            value={
              r.leadId
                ? { id: `lead:${r.leadId}`, label: r.leadName || 'Paciente' }
                : r.prontuario && r.paciente
                  ? { id: `shosp:${r.prontuario}`, label: r.paciente }
                  : null
            }
            sugestoes={sugestoesAgenda}
            tituloSugestoes={setorDoModelo === 'cirurgia' ? 'Cirurgias de hoje e amanhã' : setorDoModelo === 'spa' ? 'Spa Capilar hoje (Shosp)' : 'Agenda de hoje no Shosp'}
            onSearch={async (q) => paraPicker(await buscarPacientesDoKit(tenantId, q))}
            onPick={escolherPaciente}
            onClear={() => set({ leadId: '', leadName: '', clinicSaleId: null, prontuario: null, agendamento: null, paciente: '' })}
          />
          {!r.leadId && r.prontuario ? (
            <p className="text-xs text-muted-foreground">
              Paciente do Shosp (prontuário {r.prontuario}) sem cadastro no CRM: o kit fica com o nome.
            </p>
          ) : null}
          {!r.leadId && !r.prontuario ? (
            <Input
              value={r.paciente}
              onChange={(e) => set({ paciente: e.target.value })}
              placeholder="Ou digite o nome, se não tiver cadastro"
              aria-label="Nome do paciente"
              className="h-9"
            />
          ) : null}
        </div>
        {/* Kit do SPA não é da cirurgia: o seletor escolhia sozinho a venda da cirurgia do paciente. */}
        {r.leadId && !ehSpa ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Venda da cirurgia</Label>
            <VendaDoKitPicker
              key={r.leadId}
              leadId={r.leadId}
              data={r.data || null}
              value={r.clinicSaleId}
              autoEscolher
              onChange={(clinicSaleId) => set({ clinicSaleId })}
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="kit-proc">Procedimento</Label>
          <Input
            id="kit-proc"
            value={r.procedimento}
            onChange={(e) => set({ procedimento: e.target.value })}
            placeholder="Ex.: FUE 2.500 folículos"
            className="h-9"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kit-data">{ehSpa ? 'Data do atendimento' : 'Data da cirurgia'}</Label>
          <Input id="kit-data" type="date" value={r.data} onChange={(e) => set({ data: e.target.value })} className="h-9" />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Modelo</h2>
          {r.linhas.length > 0 ? (
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void imprimirFolhaDeItens({
                    kitNome: templates.find((t) => t.id === r.templateId)?.name || 'Kit avulso',
                    paciente: nomePaciente || null,
                    procedimento: r.procedimento || null,
                    data: r.data || null,
                    linhas: r.linhas,
                    itens: new Map(items.map((i) => [i.id, { name: i.name, controlled: i.controlled, category: i.category }] as const)),
                  }).catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao imprimir'))
                }
              >
                <Printer className="size-4" aria-hidden /> Imprimir folha
              </Button>
              <Button variant="ghost" size="sm" onClick={limpar} className="text-muted-foreground">
                Começar de novo
              </Button>
            </div>
          ) : null}
        </div>
        {setores.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Label htmlFor="kit-setor-estoque" className="font-normal text-muted-foreground">
              Material sai de
            </Label>
            <Select
              value={setorEfetivo ?? ''}
              onValueChange={(v) => set({ setorId: !v || v === (modeloEscolhido?.warehouseId ?? setores.find((w) => w.isDefault)?.id) ? null : v })}
            >
              <SelectTrigger id="kit-setor-estoque" className="h-8 w-auto min-w-40">
                <span className="truncate text-sm font-medium">{setores.find((w) => w.id === setorEfetivo)?.name ?? 'Setor'}</span>
              </SelectTrigger>
              <SelectContent>
                {setores.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => escolherModelo(t.id)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                r.templateId === t.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              <span className="block font-medium">{t.name}</span>
              <span className="block text-xs text-muted-foreground">{t.items.length} itens</span>
            </button>
          ))}
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum modelo ainda. Crie em Modelos de kit, no menu, ou bipe os itens avulsos.</p>
          ) : null}
        </div>
        {r.linhas.length > 0 && r.iniciadaEm ? (
          <p className="text-xs text-muted-foreground">
            Bandeja começada em {quandoComecou(r.iniciadaEm)}. Se não é deste kit, toque em Começar de novo.
          </p>
        ) : null}
        {modeloMudou && modeloEscolhido ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
            <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="min-w-0 flex-1">
              O modelo <span className="font-medium">{modeloEscolhido.name}</span> mudou depois que esta bandeja foi começada
              {r.assinaturaModelo ? '' : ` (${[
                diferenca.sairam > 0 ? `${diferenca.sairam} ${diferenca.sairam === 1 ? 'item saiu' : 'itens saíram'}` : '',
                diferenca.entraram > 0 ? `${diferenca.entraram} ${diferenca.entraram === 1 ? 'item entrou' : 'itens entraram'}` : '',
              ]
                .filter(Boolean)
                .join(', ')})`}
              . O que já foi conferido continua marcado.
            </p>
            <Button size="sm" onClick={atualizarBandeja} className="shrink-0">
              <RefreshCw className="size-4" aria-hidden /> Atualizar a bandeja
            </Button>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="sticky top-0 z-10 space-y-2.5 rounded-t-xl border-b border-border bg-card p-3 sm:p-4">
          <ScanBar onCode={onCode} ultimaLeitura={ultimaLeitura} placeholder="Bipe cada item que entra na bandeja" />
          {ultimaLeitura ? (
            <p className="truncate text-xs text-muted-foreground" aria-live="polite">
              Último: {ultimaLeitura}
            </p>
          ) : null}
          {(r.pacotesCme ?? []).length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">Pacotes da CME:</span>
              {(r.pacotesCme ?? []).map((p) => (
                <span key={p.codigo} className="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pl-2 pr-0.5">
                  {p.nome} · {p.lote}
                  <button
                    type="button"
                    aria-label={`Tirar ${p.nome} do kit`}
                    className="rounded-full px-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setR((prev) => ({ ...prev, pacotesCme: (prev.pacotesCme ?? []).filter((x) => x.codigo !== p.codigo) }))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {resumo.linhas > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {resumo.completas} de {resumo.linhas} conferidos
                </span>
                <span className="text-muted-foreground tabular-nums">{progresso}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${progresso}%` }} />
              </div>
              <SearchField
                value={pesquisa}
                onChange={setPesquisa}
                label="Buscar item na bandeja"
                resultados={linhasVisiveis.length}
                className="pt-1"
              />
              <div className="flex gap-1.5 overflow-x-auto pt-1">
                {(
                  [
                    ['todos', `Todos ${resumo.linhas}`],
                    ['faltam', `Faltam ${resumo.faltaConferir}`],
                    ['problema', `Atenção ${new Set([...resumo.semSaldo, ...escolhas.map((e) => e.itemId)]).size}`],
                  ] as Array<[Filtro, string]>
                ).map(([f, label]) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFiltro(f)}
                    className={cn(
                      'shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium',
                      filtro === f ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {r.linhas.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">Escolha um modelo ou comece a bipar</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Com modelo, cada bipe marca o item como conferido. Item bipado que não está no modelo entra como avulso.
            </p>
          </div>
        ) : (
          <div ref={listaRef}>
            {agruparMatMed(linhasVisiveis, (l) => porId.get(l.itemId)?.name, (l) => porId.get(l.itemId)?.category).map((g) => (
              <div key={g.grupo}>
                <CabecalhoGrupo grupo={g.grupo} rotulo={g.rotulo} total={g.linhas.length} />
                <ul className="divide-y divide-border">
                  {g.linhas.map((l) => {
                      const item = porId.get(l.itemId)
                      const completo = l.conferido >= l.qty
                      const semSaldo = resumo.semSaldo.has(l.itemId)
                      const escolha = itemEhEscolha(item?.name)
                      return (
                        <li
                          key={l.chave}
                          data-chave={l.chave}
                          className={cn('flex items-center gap-2.5 px-3 py-2.5 transition-colors sm:px-4', destaque === l.chave && 'bg-emerald-500/10')}
                        >
                          <button
                            type="button"
                            onClick={() => setLinha(l.chave, { conferido: completo ? 0 : l.qty })}
                            className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums',
                              completo
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : l.conferido > 0
                                  ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                  : 'border-border text-muted-foreground',
                            )}
                            aria-label={completo ? `Desmarcar ${item?.name ?? 'item'}` : `Marcar ${item?.name ?? 'item'} como conferido`}
                          >
                            {completo ? <Check className="size-4" aria-hidden /> : l.conferido > 0 ? formatQtd(l.conferido) : null}
                          </button>
                          <button type="button" onClick={() => setEditando(l.chave)} className="min-w-0 flex-1 text-left">
                            <span className="block text-sm font-medium leading-snug">{item?.name ?? 'Escolher item'}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span className={cn(semSaldo && 'font-medium text-destructive')}>
                                saldo {formatQtd(item?.qty ?? 0)} {item?.unit}
                              </span>
                              {escolha ? (
                                <span className="font-medium text-amber-600 dark:text-amber-400">trocar pelo item certo</span>
                              ) : null}
                              {l.avulso ? <span>avulso</span> : null}
                              {l.cobrancaCents > 0 ? <span>{formatBRL(l.cobrancaCents)}</span> : null}
                              {item?.controlled ? (
                                <span className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                                  <ShieldAlert className="size-3" aria-hidden /> controlado
                                </span>
                              ) : null}
                            </span>
                          </button>
                          <QtyStepper
                            value={l.qty}
                            min={0}
                            label={item?.name ?? 'item'}
                            onChange={(qty) => setLinha(l.chave, { qty, conferido: Math.min(l.conferido, qty) })}
                          />
                        </li>
                      )
                  })}
                </ul>
              </div>
            ))}
            {linhasVisiveis.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {termo ? `Nenhum item com "${termo}" na bandeja.` : 'Nada neste filtro.'}
              </p>
            ) : null}
          </div>
        )}

        <div className="border-t border-border p-3 sm:p-4">
          <SearchPicker
            title="Adicionar item à bandeja"
            placeholder="Adicionar item sem bipar"
            searchPlaceholder="Nome, SKU ou código…"
            items={busca}
            value={null}
            onPick={(p) => {
              const item = porId.get(p.id)
              if (item) bipar(item)
            }}
          />
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-3 border-t border-border bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgb(0_0_0/0.25)] sm:mx-0 sm:rounded-xl sm:border sm:px-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            {resumo.linhas === 0 ? (
              'Nada na bandeja ainda'
            ) : (
              <>
                <span className="font-medium text-foreground">{resumo.linhas} itens</span>
                {resumo.faltaConferir > 0 ? ` · ${resumo.faltaConferir} sem conferir` : ' · tudo conferido'}
                {resumo.semSaldo.size > 0 ? <span className="text-destructive"> · {resumo.semSaldo.size} sem saldo</span> : null}
              </>
            )}
          </div>
          <Button onClick={pedirMontagem} disabled={salvando || resumo.linhas === 0} className="h-10 shrink-0 px-4">
            <PackagePlus className="size-4" aria-hidden />
            {salvando ? 'Montando…' : 'Montar kit'}
          </Button>
        </div>
      </div>

      <Dialog open={linhaEditada != null} onOpenChange={(open) => !open && setEditando(null)}>
        <DialogContent className="sm:max-w-md">
          {linhaEditada ? (
            <>
              <DialogHeader>
                <DialogTitle>Item da bandeja</DialogTitle>
                <DialogDescription>Troque o produto, ajuste a quantidade ou marque cobrança.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Produto</Label>
                  <SearchPicker
                    title="Trocar produto"
                    placeholder="Escolher produto"
                    searchPlaceholder="Nome, SKU ou código…"
                    items={busca}
                    value={
                      linhaEditada.itemId
                        ? { id: linhaEditada.itemId, label: porId.get(linhaEditada.itemId)?.name ?? 'Item' }
                        : null
                    }
                    onPick={(p) => setLinha(linhaEditada.chave, { itemId: p.id })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label>Quantidade</Label>
                  <QtyStepper
                    value={linhaEditada.qty}
                    label="quantidade"
                    onChange={(qty) => setLinha(linhaEditada.chave, { qty, conferido: Math.min(linhaEditada.conferido, qty) })}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="linha-avulso" className="font-normal">
                    Avulso (fora do modelo)
                  </Label>
                  <Switch
                    id="linha-avulso"
                    checked={linhaEditada.avulso}
                    onCheckedChange={(v) => setLinha(linhaEditada.chave, { avulso: Boolean(v) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="linha-cobranca">Cobrança do paciente (R$)</Label>
                  <Input
                    key={linhaEditada.chave}
                    id="linha-cobranca"
                    inputMode="decimal"
                    placeholder="0,00"
                    defaultValue={linhaEditada.cobrancaCents > 0 ? (linhaEditada.cobrancaCents / 100).toFixed(2).replace('.', ',') : ''}
                    onBlur={(e) => {
                      const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'))
                      setLinha(linhaEditada.chave, { cobrancaCents: Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0 })
                    }}
                    className="h-9"
                  />
                </div>
              </div>
              <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => {
                    set({ linhas: r.linhas.filter((l) => l.chave !== linhaEditada.chave) })
                    setEditando(null)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden /> Tirar da bandeja
                </Button>
                <Button onClick={() => setEditando(null)}>Pronto</Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={trocarModelo != null}
        onOpenChange={(open) => !open && setTrocarModelo(null)}
        title="Trocar o modelo?"
        description="A bandeja atual, com o que já foi conferido, será substituída pelos itens do novo modelo."
        confirmLabel="Trocar modelo"
        variant="default"
        onConfirm={() => {
          if (trocarModelo) aplicarModelo(trocarModelo)
          setTrocarModelo(null)
        }}
      />

      <ConfirmDialog
        open={recarregarModelo}
        onOpenChange={setRecarregarModelo}
        title="Recarregar o modelo?"
        description={`A bandeja volta a ter os ${modeloEscolhido?.items.length ?? 0} itens do ${modeloEscolhido?.name ?? 'modelo'} de agora. O que já foi conferido continua marcado; item que saiu do modelo sai da bandeja.`}
        confirmLabel="Recarregar"
        variant="default"
        icon={RefreshCw}
        onConfirm={() => {
          atualizarBandeja()
          setRecarregarModelo(false)
        }}
      />

      <ConfirmDialog
        open={confirmar}
        onOpenChange={setConfirmar}
        title="Montar mesmo assim?"
        description={[
          resumo.faltaConferir > 0 ? `${resumo.faltaConferir} ${resumo.faltaConferir === 1 ? 'item não foi conferido' : 'itens não foram conferidos'}.` : '',
          resumo.semSaldo.size > 0 ? `${resumo.semSaldo.size} ${resumo.semSaldo.size === 1 ? 'item fica' : 'itens ficam'} com saldo negativo.` : '',
          escolhas.length > 0 ? `${escolhas.length} ${escolhas.length === 1 ? 'item ainda é' : 'itens ainda são'} escolha do modelo (ex.: curativo fem/mas) e vai sair do item errado.` : '',
          'A baixa no estoque acontece agora.',
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel="Montar kit"
        variant="default"
        icon={TriangleAlert}
        onConfirm={() => void montar()}
      />

      <VincularCodigoDialog
        codigo={codigoDesconhecido}
        itens={items}
        onClose={() => setCodigoDesconhecido(null)}
        onVinculado={(item) => {
          setCodigoDesconhecido(null)
          onItemAtualizado(item)
          bipar(item)
        }}
      />
    </div>
  )
}
