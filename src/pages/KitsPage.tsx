import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { AppLayout } from '@/layouts/AppLayout'
import { KitsLista } from '@/components/kits/KitsLista'
import { LivroControlados } from '@/components/kits/LivroControlados'
import { ModelosKit } from '@/components/kits/ModelosKit'
import { MontarKit } from '@/components/kits/MontarKit'
import { useTenant } from '@/context/TenantContext'
import { combinaBusca } from '@/lib/busca'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import {
  type ControlledLogRow,
  type KitCost,
  type KitTemplate,
  type StockKit,
  listControlledLog,
  listItemLastCosts,
  listKitCosts,
  listKitTemplates,
  listKits,
} from '@/services/estoqueKits'

// Kits: cada tela no próprio endereço e no menu lateral (24/09/2026). Antes era uma página só com
// abas internas (Montar, Kits, Modelos, Controlados) e um botão escondido para a Conferência do
// SPA, por cima de uma barra de abas do estoque inteiro. A equipe se perdia todo dia: o menu dizia
// "Kits cirúrgicos" e a tela certa estava duas camadas abaixo.

type Partes = { itens?: boolean; modelos?: boolean; kits?: boolean; controlados?: boolean }

/** Carrega só o que a tela usa. `recarregar` não pisca a tela: `carregando` vale para a primeira carga. */
function useDadosDosKits(partes: Partes) {
  const [items, setItems] = useState<StockItem[]>([])
  const [templates, setTemplates] = useState<KitTemplate[]>([])
  const [kits, setKits] = useState<StockKit[]>([])
  const [controlledLog, setControlledLog] = useState<ControlledLogRow[]>([])
  const [kitCosts, setKitCosts] = useState<Map<string, KitCost>>(new Map())
  const [lastCosts, setLastCosts] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const { itens, modelos, kits: comKits, controlados } = partes

  const recarregar = useCallback(async () => {
    try {
      const [it, tpls, ks, log, costs, last] = await Promise.all([
        itens ? listStockItems() : Promise.resolve(null),
        modelos ? listKitTemplates() : Promise.resolve(null),
        comKits ? listKits() : Promise.resolve(null),
        // O livro tem busca: carrega um histórico que valha a pena buscar, não só os 50 últimos.
        controlados ? listControlledLog(1000) : Promise.resolve(null),
        comKits ? listKitCosts() : Promise.resolve(null),
        comKits ? listItemLastCosts() : Promise.resolve(null),
      ])
      if (it) setItems(it)
      if (tpls) setTemplates(tpls)
      if (ks) setKits(ks)
      if (log) setControlledLog(log)
      if (costs) setKitCosts(costs)
      if (last) setLastCosts(last)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar kits')
    } finally {
      setCarregando(false)
    }
  }, [itens, modelos, comKits, controlados])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  const trocarItem = useCallback((item: StockItem) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i))), [])

  return { items, templates, kits, controlledLog, kitCosts, lastCosts, carregando, recarregar, trocarItem }
}

/** /kits/montar */
export function KitMontarPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const d = useDadosDosKits({ itens: true, modelos: true })
  return (
    <AppLayout title="Montar kit" subtitle="Escolha o modelo e o paciente, bipe o que entra na bandeja e toque em Montar kit.">
      <MontarKit
        tenantId={tenant.id}
        items={d.items}
        templates={d.templates}
        onItemAtualizado={d.trocarItem}
        onMontado={() => navigate('/kits')}
      />
    </AppLayout>
  )
}

/**
 * /kits: os kits dos pacientes. Também atende os links antigos das abas (`/kits?aba=montar`,
 * `?aba=modelos`, `?kit=<id>`), que estão em favoritos e no Resultado por cirurgia.
 */
export function KitsPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const d = useDadosDosKits({ itens: true, kits: true })
  const aba = params.get('aba')
  const kitDaUrl = params.get('kit')

  // Busca: paciente, kit e procedimento no histórico inteiro (banco); item, nos kits já carregados.
  const [busca, setBusca] = useState('')
  const termo = useDeferredValue(busca.trim())
  const [doBanco, setDoBanco] = useState<{ termo: string; kits: StockKit[] } | null>(null)
  useEffect(() => {
    if (termo.length < 2) return
    let vivo = true
    const t = window.setTimeout(() => {
      listKits(undefined, termo)
        .then((kits) => vivo && setDoBanco({ termo, kits }))
        .catch((e) => vivo && toast.error(e instanceof Error ? e.message : 'Falha na busca de kits'))
    }, 300)
    return () => {
      vivo = false
      window.clearTimeout(t)
    }
  }, [termo])
  const porItemId = useMemo(() => new Map(d.items.map((i) => [i.id, i.name] as const)), [d.items])
  const kitsNaTela = useMemo(() => {
    if (termo.length < 2) return d.kits
    const locais = d.kits.filter(
      (k) =>
        combinaBusca(termo, k.patientName, k.name, k.procedureLabel) ||
        k.items.some((l) => combinaBusca(termo, l.label, porItemId.get(l.itemId))),
    )
    const vistos = new Set(locais.map((k) => k.id))
    const remotos = doBanco?.termo === termo ? doBanco.kits.filter((k) => !vistos.has(k.id)) : []
    return [...locais, ...remotos].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [termo, d.kits, doBanco, porItemId])

  if (kitDaUrl) return <Navigate to={`/kits/${kitDaUrl}/editar`} replace />
  if (aba === 'montar') {
    const resto = new URLSearchParams(params)
    resto.delete('aba')
    const qs = resto.toString()
    return <Navigate to={`/kits/montar${qs ? `?${qs}` : ''}`} replace />
  }
  if (aba === 'modelos') return <Navigate to="/kits/modelos" replace />
  if (aba === 'controlados') return <Navigate to="/kits/controlados" replace />

  return (
    <AppLayout title="Kits dos pacientes" subtitle="Kits montados, usados e cancelados. Registre o uso depois do procedimento e corrija o que for preciso.">
      <KitsLista
        kits={kitsNaTela}
        busca={busca}
        onBusca={setBusca}
        buscando={termo.length >= 2 && doBanco?.termo !== termo}
        items={d.items}
        kitCosts={d.kitCosts}
        lastCosts={d.lastCosts}
        loading={d.carregando}
        onRegistrarUso={(k) => navigate(`/kits/${k.id}/uso`)}
        onEditar={(k) => navigate(`/kits/${k.id}/editar`)}
        onOutroKit={(k) => navigate(`/kits/montar?do-kit=${k.id}`)}
        onMudou={() => void d.recarregar()}
      />
    </AppLayout>
  )
}

/** /kits/modelos */
export function KitModelosPage() {
  const d = useDadosDosKits({ itens: true, modelos: true })
  return (
    <AppLayout title="Modelos de kit" subtitle="A lista fixa de cada kit. Mudar um modelo vale para os próximos kits, não para os já montados.">
      <ModelosKit templates={d.templates} items={d.items} onMudou={() => void d.recarregar()} />
    </AppLayout>
  )
}

/** /kits/controlados */
export function KitControladosPage() {
  const d = useDadosDosKits({ itens: true, controlados: true })
  const nomes = useMemo(() => new Map(d.items.map((i) => [i.id, i.name] as const)), [d.items])
  return (
    <AppLayout title="Livro de controlados" subtitle="Toda entrada e saída de medicamento controlado, com o paciente.">
      <LivroControlados rows={d.controlledLog} nomes={nomes} />
    </AppLayout>
  )
}

export default KitsPage
