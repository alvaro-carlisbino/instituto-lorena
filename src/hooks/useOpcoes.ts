import { useEffect, useMemo, useState } from 'react'

import { padraoDaLista, type ChaveLista } from '@/config/listas'
import { opcoesAtivas, opcoesEscolhiveis, type OpcaoEscolhivel } from '@/services/listas'

/**
 * As opções de uma lista configurável (ver `src/config/listas.ts`).
 *
 * Começa devolvendo o padrão do fonte e troca quando o banco responde. É de propósito: o
 * formulário abre com opção na tela mesmo antes da primeira resposta, e continua abrindo com
 * opção se a rede cair. Select vazio é um campo que a pessoa preenche errado em outro lugar.
 */
export function useOpcoes(chave: ChaveLista): string[] {
  const [opcoes, setOpcoes] = useState<string[]>(() => padraoDaLista(chave))

  useEffect(() => {
    let vivo = true
    void opcoesAtivas(chave).then((lista) => {
      if (vivo && lista.length > 0) setOpcoes(lista)
    })
    return () => {
      vivo = false
    }
  }, [chave])

  return opcoes
}

/**
 * O mesmo, garantindo que o valor JÁ GRAVADO apareça na lista.
 *
 * Editar um registro antigo cujo texto saiu da lista (foi renomeado, desativado, ou veio de
 * importação) não pode mostrar campo vazio: o select vazio parece "ninguém preencheu", e quem
 * for salvar apaga o que estava lá sem perceber.
 */
export function useOpcoesComAtual(chave: ChaveLista, atual: string | null | undefined): string[] {
  const opcoes = useOpcoes(chave)
  return useMemo(() => {
    const v = (atual ?? '').trim()
    if (!v || opcoes.includes(v)) return opcoes
    return [v, ...opcoes]
  }, [opcoes, atual])
}

/**
 * O mesmo, para lista em que o registro guarda um CÓDIGO e a tela mostra o rótulo
 * (categoria da nota clínica). Select com `value` no código e texto no rótulo.
 */
export function useOpcoesEscolhiveis(chave: ChaveLista): OpcaoEscolhivel[] {
  const [opcoes, setOpcoes] = useState<OpcaoEscolhivel[]>(() =>
    padraoDaLista(chave).map((l) => ({ label: l, value: l })),
  )

  useEffect(() => {
    let vivo = true
    void opcoesEscolhiveis(chave).then((lista) => {
      if (vivo && lista.length > 0) setOpcoes(lista)
    })
    return () => {
      vivo = false
    }
  }, [chave])

  return opcoes
}
