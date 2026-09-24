import { useCallback, useEffect, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { toast } from 'sonner'

import { type StockItem, listStockItems } from '@/services/estoqueCompras'
import { type ConsumoSetor, type SetorKit, type StockKit, buscarKit, listConsumoSetor, listItemLastCosts, setorDoModelo } from '@/services/estoqueKits'

// Registrar uso, editar kit e editar modelo eram popups em cima da lista. Com 90 itens no
// celular o popup cobria a tela inteira de qualquer jeito, fechava com um toque fora e não
// tinha endereço: voltar do navegador saía do CRM, recarregar perdia tudo. Agora são telas.

export const LISTA_DE_KITS = '/kits'

/** Volta para onde a pessoa veio (lista de kits, resultado da cirurgia); sem histórico, para a lista. */
export function voltarDaTela(navigate: NavigateFunction, destino = LISTA_DE_KITS) {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  if (idx && idx > 0) navigate(-1)
  else navigate(destino, { replace: true })
}

/** Carrega o kit da URL e os itens de estoque (nome, código, saldo, controlado). */
export function useKitDaTela(kitId: string, { comCustos = false, comConsumo = false } = {}) {
  const [kit, setKit] = useState<StockKit | null>(null)
  const [items, setItems] = useState<StockItem[]>([])
  const [lastCosts, setLastCosts] = useState<Map<string, number>>(new Map())
  const [consumo, setConsumo] = useState<ConsumoSetor[]>([])
  const [setor, setSetor] = useState<SetorKit | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    Promise.all([
      buscarKit(kitId),
      listStockItems(),
      comCustos ? listItemLastCosts() : Promise.resolve(new Map<string, number>()),
      comConsumo ? listConsumoSetor() : Promise.resolve([] as ConsumoSetor[]),
    ])
      .then(async ([k, it, custos, cfg]) => {
        const s = comConsumo && k?.templateId ? await setorDoModelo(k.templateId) : null
        if (!vivo) return
        setKit(k)
        setItems(it)
        setLastCosts(custos)
        setConsumo(cfg)
        setSetor(s)
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'Falha ao carregar o kit'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [kitId, comCustos, comConsumo])

  const recarregarKit = useCallback(async () => {
    try {
      setKit(await buscarKit(kitId))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao recarregar o kit')
    }
  }, [kitId])

  const trocarItem = useCallback((item: StockItem) => setItems((prev) => prev.map((i) => (i.id === item.id ? item : i))), [])

  return { kit, items, lastCosts, consumo, setor, carregando, erro, recarregarKit, trocarItem }
}
