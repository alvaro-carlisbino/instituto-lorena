import { supabase } from '@/lib/supabaseClient'

/**
 * Produção do centro cirúrgico: o que o sistema da enfermagem cronometrou.
 *
 * O espelho `srg_*` guarda etapa por etapa desde nov/2025 (extração, implante,
 * anestesia, RPA, alta) e nenhuma tela lia isso. Aqui saem tempo de sala, tempo
 * por etapa, folículo por hora e quanto rende a hora de sala.
 *
 * Duas honestidades que a RPC devolve junto e a tela precisa mostrar:
 *   • `qualidade.duracao_suspeita` — cirurgia com duração fora de 1h..20h ficou de
 *     fora da conta. É registro esquecido aberto, não cirurgia de 3 dias.
 *   • `resumo.base_valor_hora` — quantas cirurgias entraram no R$/hora. Só entra
 *     quem tem venda vinculada E duração plausível, hoje uma minoria.
 */

export type CirurgiaResumo = {
  cirurgias: number
  finalizadas: number
  em_processo: number
  horas_sala: number
  mediana_horas: number | null
  p90_horas: number | null
  foliculos_extraidos: number
  foliculos_implantados: number
  meta_total: number
  aproveitamento_meta_pct: number | null
  foliculos_por_hora: number | null
  receita_cents: number
  ticket_medio_cents: number | null
  valor_hora_sala_cents: number | null
  /** Cirurgias que têm valor E duração — a base real do R$/hora. */
  base_valor_hora: number
  horas_valor_hora: number
}

export type CirurgiaAnalytics = {
  range: { de: string; ate: string }
  resumo: CirurgiaResumo
  por_mes: Array<{
    mes: string
    cirurgias: number
    horas: number
    mediana_horas: number | null
    foliculos: number
    receita_cents: number
    valor_hora_cents: number | null
  }>
  por_etapa: Array<{ etapa: string; cirurgias: number; mediana_min: number; p90_min: number }>
  por_medico: Array<{
    medico: string
    cirurgias: number
    horas: number
    mediana_horas: number | null
    foliculos: number
    foliculos_por_hora: number | null
    receita_cents: number
  }>
  por_sala: Array<{ sala: string; cirurgias: number; horas: number; mediana_horas: number | null }>
  qualidade: {
    sem_duracao: number
    duracao_suspeita: number
    sem_venda_vinculada: number
    ultimo_sync: string | null
  }
}

/** Como a equipe chama cada etapa. O banco guarda o código do sistema PHP. */
export const ETAPA_LABEL: Record<string, string> = {
  'PRE-CIRURGICO': 'Pré-cirúrgico',
  ANESTESIA1: 'Anestesia 1',
  PRE_INSICOES: 'Pré-incisões',
  ANESTESIA2: 'Anestesia 2',
  EXTRACAO: 'Extração',
  IMPLANTE: 'Implante',
  RPA: 'RPA (recuperação)',
  ALTA_ANESTESICA: 'Alta anestésica',
  ALTA: 'Alta',
}

export async function fetchCirurgiaAnalytics(de: string, ate: string): Promise<CirurgiaAnalytics | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_cirurgia_analytics', { p_de: de, p_ate: ate })
  if (error) throw new Error(error.message)
  return (data as CirurgiaAnalytics) ?? null
}
