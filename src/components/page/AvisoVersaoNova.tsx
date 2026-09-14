// Pergunta ao servidor, de tempos em tempos e quando a aba volta ao foco, se saiu versão nova.
// Ver src/lib/novaVersao.ts para o porquê de avisar em vez de recarregar sozinho.

import { useEffect } from 'react'
import { toast } from 'sonner'

import { temVersaoNova } from '@/lib/novaVersao'

const INTERVALO_MS = 5 * 60_000

export function AvisoVersaoNova() {
  useEffect(() => {
    if (!import.meta.env.PROD) return
    let avisado = false
    const conferir = async () => {
      if (avisado || document.visibilityState !== 'visible') return
      try {
        if (!(await temVersaoNova())) return
        avisado = true
        toast('Saiu uma versão nova do CRM', {
          id: 'versao-nova',
          description: 'Atualize para usar as telas novas. Salve o que estiver editando antes.',
          duration: Infinity,
          action: { label: 'Atualizar', onClick: () => window.location.reload() },
        })
      } catch {
        // Sem rede ou servidor fora: tenta de novo na próxima volta.
      }
    }
    const id = window.setInterval(() => void conferir(), INTERVALO_MS)
    const aoVoltar = () => void conferir()
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])
  return null
}
