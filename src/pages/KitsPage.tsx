import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Boxes, Layers, PackageCheck, ShieldAlert } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { KitsLista } from '@/components/kits/KitsLista'
import { LivroControlados } from '@/components/kits/LivroControlados'
import { ModelosKit } from '@/components/kits/ModelosKit'
import { MontarKit } from '@/components/kits/MontarKit'
import { useTenant } from '@/context/TenantContext'
import { estoqueTabs } from '@/pages/EstoquePage'
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

type Aba = 'montar' | 'kits' | 'modelos' | 'controlados'
const ABAS: Aba[] = ['montar', 'kits', 'modelos', 'controlados']

export function KitsPage() {
  const { tenant } = useTenant()
  // A aba mora na URL: a tela remonta quando o navegador volta do foco, e sem isso a
  // enfermeira no meio de um "Registrar uso" caía de novo em Montar.
  const [params, setParams] = useSearchParams()
  const aba: Aba = ABAS.includes(params.get('aba') as Aba) ? (params.get('aba') as Aba) : 'montar'
  const irPara = useCallback(
    (a: Aba) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('aba', a)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  const [items, setItems] = useState<StockItem[]>([])
  const [templates, setTemplates] = useState<KitTemplate[]>([])
  const [kits, setKits] = useState<StockKit[]>([])
  const [controlledLog, setControlledLog] = useState<ControlledLogRow[]>([])
  const [kitCosts, setKitCosts] = useState<Map<string, KitCost>>(new Map())
  const [lastCosts, setLastCosts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  // `loading` só vale para a primeira carga (nasce true); recarregar depois de uma ação não
  // pisca a tela inteira de "Carregando…".
  const load = async () => {
    try {
      const [it, tpls, ks, log, costs, last] = await Promise.all([
        listStockItems(),
        listKitTemplates(),
        listKits(),
        listControlledLog(),
        listKitCosts(),
        listItemLastCosts(),
      ])
      setItems(it)
      setTemplates(tpls)
      setKits(ks)
      setControlledLog(log)
      setKitCosts(costs)
      setLastCosts(last)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar kits')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // `/kits?aba=kits&kit=<id>` era o link antigo da edição (Resultado por cirurgia, favoritos):
  // a edição virou tela, então o link velho segue para ela.
  const kitDaUrl = params.get('kit')
  useEffect(() => {
    if (kitDaUrl) navigate(`/kits/${kitDaUrl}/editar`, { replace: true })
  }, [kitDaUrl, navigate])

  const trocarItem = useCallback(
    (item: StockItem) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i))),
    [],
  )

  const nomes = useMemo(() => new Map(items.map((i) => [i.id, i.name] as const)), [items])
  const abertos = kits.filter((k) => k.status === 'montado').length

  return (
    <AppLayout title="Kits cirúrgicos" subtitle="Monte bipando, registre o uso depois da cirurgia e devolva a sobra ao estoque.">
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />

      <Tabs value={aba} onValueChange={(v) => irPara(v as Aba)}>
        <TabsList className="overflow-x-auto">
          <TabsTrigger value="montar">
            <Boxes aria-hidden /> Montar
          </TabsTrigger>
          <TabsTrigger value="kits">
            <PackageCheck aria-hidden /> Kits
            {abertos > 0 ? (
              <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground">{abertos}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="modelos">
            <Layers aria-hidden /> Modelos
          </TabsTrigger>
          <TabsTrigger value="controlados">
            <ShieldAlert aria-hidden /> Controlados
          </TabsTrigger>
        </TabsList>

        <TabsContent value="montar">
          <MontarKit
            tenantId={tenant.id}
            items={items}
            templates={templates}
            onItemAtualizado={trocarItem}
            onMontado={() => {
              void load()
              irPara('kits')
            }}
          />
        </TabsContent>
        <TabsContent value="kits">
          <KitsLista
            kits={kits}
            items={items}
            kitCosts={kitCosts}
            lastCosts={lastCosts}
            loading={loading}
            onRegistrarUso={(k) => navigate(`/kits/${k.id}/uso`)}
            onEditar={(k) => navigate(`/kits/${k.id}/editar`)}
            onMudou={() => void load()}
          />
        </TabsContent>
        <TabsContent value="modelos">
          <ModelosKit templates={templates} items={items} onMudou={() => void load()} />
        </TabsContent>
        <TabsContent value="controlados">
          <LivroControlados rows={controlledLog} nomes={nomes} />
        </TabsContent>
      </Tabs>

    </AppLayout>
  )
}
