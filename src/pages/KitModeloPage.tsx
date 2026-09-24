import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { EditorModelo } from '@/components/kits/EditorModelo'
import { EstadoDaTela, VoltarParaKits } from '@/components/kits/TelaDoKit'
import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import { type KitTemplate, listKitTemplates } from '@/services/estoqueKits'

const LISTA_DE_MODELOS = '/kits/modelos'

/** /kits/modelos/novo e /kits/modelos/:modeloId: a lista padrão da bandeja. */
export function KitModeloPage() {
  const { modeloId = 'novo' } = useParams()
  const navigate = useNavigate()
  const novo = modeloId === 'novo'
  const [modelo, setModelo] = useState<KitTemplate | null>(null)
  const [items, setItems] = useState<StockItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([listStockItems(), novo ? Promise.resolve([] as KitTemplate[]) : listKitTemplates()])
      .then(([it, modelos]) => {
        if (!vivo) return
        setItems(it)
        setModelo(modelos.find((m) => m.id === modeloId) ?? null)
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'Falha ao carregar o modelo'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [modeloId, novo])

  return (
    <AppLayout
      title={novo ? 'Novo modelo de kit' : modelo ? `Modelo: ${modelo.name}` : 'Editar modelo'}
      subtitle="Bipe os itens da bandeja ou busque pelo nome. Bipar de novo soma +1."
    >
      <VoltarParaKits rotulo="Modelos de kit" para={LISTA_DE_MODELOS} />
      <EstadoDaTela carregando={carregando} erro={erro} vazio={!novo && !modelo ? 'Modelo não encontrado' : null}>
        <EditorModelo
          key={modeloId}
          modelo={modelo}
          items={items}
          voltarPara={LISTA_DE_MODELOS}
          onSalvo={() => navigate(LISTA_DE_MODELOS, { replace: true })}
          onItemAtualizado={(item) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))}
        />
      </EstadoDaTela>
    </AppLayout>
  )
}
