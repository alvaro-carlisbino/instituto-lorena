import { toast } from 'sonner'

import { imprimirHtml } from '@/lib/exportar'
import {
  type ConfigEtiqueta,
  type PacoteParaEtiqueta,
  etiquetasZpl,
  folhaDeEtiquetas,
  guardarConfigEtiqueta,
  larguraDaLogo,
  lerConfigEtiqueta,
} from '@/lib/etiquetaCme'
import { ErroZebra, type GraficoZpl, type ImpressoraZebra, acharImpressora, enviarZpl, imagemParaGrafico } from '@/lib/zebra'

// Impressão das etiquetas da CME: direto na Zebra pelo Browser Print (ZPL), ou pela janela de
// impressão do navegador quando assim configurado ou quando a Zebra não responde.

/** Logo horizontal monocromática, recortada rente ao desenho (assets/Logo_..._Monocromia_BG_Branco). */
export const LOGO_ETIQUETA = '/marca/lorena-etiqueta.png'

export async function logoDaEtiqueta(config: ConfigEtiqueta): Promise<GraficoZpl | null> {
  if (!config.logo) return null
  try {
    return await imagemParaGrafico(LOGO_ETIQUETA, larguraDaLogo(config))
  } catch {
    return null
  }
}

/** Manda o ZPL para a impressora guardada; se ela sumiu, procura de novo e guarda a que achou. */
export async function enviarParaZebra(zpl: string, config: ConfigEtiqueta = lerConfigEtiqueta()): Promise<ImpressoraZebra> {
  if (config.zebra) {
    try {
      await enviarZpl(config.zebra, zpl)
      return config.zebra
    } catch (e) {
      if (!(e instanceof ErroZebra) || e.motivo !== 'impressora') throw e
    }
  }
  const { escolhida } = await acharImpressora(config.zebra?.uid)
  await enviarZpl(escolhida, zpl)
  guardarConfigEtiqueta({ ...lerConfigEtiqueta(), zebra: escolhida })
  return escolhida
}

export function imprimirPelaJanela(pacotes: PacoteParaEtiqueta[], config: ConfigEtiqueta = lerConfigEtiqueta()): void {
  try {
    imprimirHtml(folhaDeEtiquetas(pacotes, config))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Falha ao imprimir')
  }
}

const etiquetas = (n: number) => `${n} ${n === 1 ? 'etiqueta' : 'etiquetas'}`

/** Etiquetas dos pacotes, do jeito configurado em /cme/etiqueta. Se a Zebra falhar, oferece a janela. */
export async function imprimirEtiquetasCme(pacotes: PacoteParaEtiqueta[]): Promise<void> {
  if (pacotes.length === 0) {
    toast.error('Nenhum pacote para imprimir.')
    return
  }
  const config = lerConfigEtiqueta()
  if (config.impressao === 'navegador') {
    imprimirPelaJanela(pacotes, config)
    return
  }
  try {
    const logo = await logoDaEtiqueta(config)
    const impressora = await enviarParaZebra(etiquetasZpl(pacotes, config, logo), config)
    toast.success(`${etiquetas(pacotes.length)} na ${impressora.name}.`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'A Zebra não respondeu.', {
      description: 'Confira a Zebra em CME, Etiqueta e impressora. Ou imprima pela janela do navegador.',
      action: { label: 'Imprimir pela janela', onClick: () => imprimirPelaJanela(pacotes, config) },
      duration: 20_000,
    })
  }
}
