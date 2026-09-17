// Pergunta ao servidor, de tempos em tempos e quando a aba volta ao foco, se saiu versão nova,
// e conta o que mudou. Ver src/lib/novaVersao.ts para o porquê de avisar em vez de recarregar
// sozinho, e src/lib/notasDaVersao.ts para de onde vêm as notas.

import { useEffect } from 'react'
import { toast } from 'sonner'

import {
  type NotaDaVersao,
  NOTAS_DESTE_BUILD,
  buscarNotasDoServidor,
  gravarNotaVista,
  lerNotaVista,
  notasDesde,
  notasNovas,
  resumoDoAviso,
} from '@/lib/notasDaVersao'
import { temVersaoNova } from '@/lib/novaVersao'

const INTERVALO_MS = 5 * 60_000
const SALVE_ANTES = 'Salve o que estiver editando antes de atualizar.'
const SEM_NOTAS = 'Atualize para usar as telas novas. Salve o que estiver editando antes.'

// Espera a tela montar antes de mostrar o "O que mudou". Também protege o StrictMode do dev:
// o efeito roda duas vezes, a primeira é desmontada e cancela o agendamento antes de gravar a
// nota como vista, então a segunda ainda mostra.
const ESPERA_O_QUE_MUDOU_MS = 1_500
const DURACAO_O_QUE_MUDOU_MS = 60_000

// Com o botão ao lado do texto, em 400 px as notas ficavam espremidas numa coluna estreita.
// Quebrando a linha, o texto usa a largura toda e o botão desce quando não cabe. O `!` é porque
// o CSS do sonner entra fora das camadas do Tailwind e ganharia da classe comum.
const CLASSES_DO_AVISO = { toast: 'flex-wrap!' }

function DescricaoDasNotas({ notas, rodape }: { notas: NotaDaVersao[]; rodape?: string }) {
  const resumo = resumoDoAviso(notas)
  // Cor própria: o sonner pinta a descrição com o cinza fixo do tema claro (o Toaster não
  // recebe o tema), que some no fundo do tema escuro.
  return (
    <div className="mt-1 space-y-2 text-popover-foreground">
      {resumo.notas.map((n) => (
        <div key={n.id}>
          <p className="font-medium">{n.titulo}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {n.itens.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
      {resumo.resto && <p className="text-muted-foreground">{resumo.resto}</p>}
      {rodape && <p className="font-medium">{rodape}</p>}
    </div>
  )
}

export function AvisoVersaoNova() {
  // Versão nova no ar enquanto a aba está aberta. Só em produção: no dev o hash não muda.
  useEffect(() => {
    if (!import.meta.env.PROD) return
    let avisado = false
    const conferir = async () => {
      if (avisado || document.visibilityState !== 'visible') return
      try {
        if (!(await temVersaoNova())) return
      } catch {
        // Sem rede ou servidor fora: tenta de novo na próxima volta.
        return
      }
      avisado = true
      // Sem notas (rede falhou, ou o deploy não trouxe nota nova) o aviso sai com o texto
      // genérico: o essencial é a pessoa saber que tem versão nova.
      const doServidor = await buscarNotasDoServidor()
      const novas = notasNovas(doServidor, NOTAS_DESTE_BUILD)
      toast('Saiu uma versão nova do CRM', {
        id: 'versao-nova',
        description: novas.length > 0 ? <DescricaoDasNotas notas={novas} rodape={SALVE_ANTES} /> : SEM_NOTAS,
        duration: Infinity,
        classNames: CLASSES_DO_AVISO,
        action: {
          label: 'Atualizar',
          onClick: () => {
            // A pessoa acabou de ler as notas aqui: grava antes do reload para o "O que mudou"
            // não repetir a mesma coisa ao abrir a versão nova.
            if (doServidor[0]) gravarNotaVista(doServidor[0].id)
            window.location.reload()
          },
        },
      })
    }
    const id = window.setInterval(() => void conferir(), INTERVALO_MS)
    const aoVoltar = () => void conferir()
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  // Ao abrir: quem recarregou por conta própria (F5, fechou e abriu) não viu o aviso acima.
  // Mostra uma vez o que saiu desde a última nota vista neste navegador.
  useEffect(() => {
    const maisNova = NOTAS_DESTE_BUILD[0]
    if (!maisNova) return
    const timer = window.setTimeout(() => {
      const vista = lerNotaVista()
      if (vista === maisNova.id) return
      gravarNotaVista(maisNova.id)
      // Primeiro acesso neste navegador: não há "desde quando", então só marca.
      if (vista === null) return
      const desde = notasDesde(NOTAS_DESTE_BUILD, vista)
      if (desde.length === 0) return
      toast('O que mudou no CRM', {
        id: 'o-que-mudou',
        description: <DescricaoDasNotas notas={desde} />,
        duration: DURACAO_O_QUE_MUDOU_MS,
        classNames: CLASSES_DO_AVISO,
        action: { label: 'Entendi', onClick: () => {} },
      })
    }, ESPERA_O_QUE_MUDOU_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return null
}
