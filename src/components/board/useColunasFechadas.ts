import { useCallback, useEffect, useState } from 'react'

/**
 * Quais colunas do quadro ficam fechadas, lembrado por navegador.
 *
 * O padrão importa mais que a memória: num funil de seis colunas, duas são
 * arquivo (não convertido, encerrado) e concentram 114 dos 174 pacientes. Nascer
 * com elas fechadas é o que faz caber na tela o que precisa de contato hoje.
 */
export function useColunasFechadas(chave: string, padrao: string[] = []) {
  const [fechadas, setFechadas] = useState<Set<string>>(() => {
    if (typeof localStorage === 'undefined') return new Set(padrao)
    try {
      const salvo = localStorage.getItem(chave)
      if (salvo == null) return new Set(padrao)
      const lista = JSON.parse(salvo)
      return new Set(Array.isArray(lista) ? lista.map(String) : padrao)
    } catch {
      return new Set(padrao)
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(chave, JSON.stringify([...fechadas]))
    } catch {
      /* navegador sem storage: a preferência vale só para esta sessão */
    }
  }, [chave, fechadas])

  const alternar = useCallback((id: string, fechada: boolean) => {
    setFechadas((atual) => {
      const proximo = new Set(atual)
      if (fechada) proximo.add(id)
      else proximo.delete(id)
      return proximo
    })
  }, [])

  const abrirTodas = useCallback(() => setFechadas(new Set()), [])

  return { fechadas, alternar, abrirTodas }
}
