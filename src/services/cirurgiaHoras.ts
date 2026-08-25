import { supabase } from '@/lib/supabaseClient'

/**
 * O que aconteceu DENTRO da cirurgia: hora a hora, e quem estava em cada lado.
 *
 * A pergunta que originou isto: "como eu sei que foi realmente uma hora, ou se
 * foi 40 minutos? Leonardo fez uma hora?". A tela de produção mostra a cirurgia
 * inteira; o bloco de hora é o que responde por pessoa.
 *
 * Duas honestidades que as RPC devolvem junto, e a tela precisa mostrar:
 *   • `fonte_inicio` — 'registrado' é o início que a sala digitou; 'encadeado' é
 *     deduzido do fim do bloco anterior do mesmo lado. Deduzido vale como pista,
 *     não como medida, e por isso aparece marcado.
 *   • `base_horas` — quantos blocos da pessoa têm as DUAS pontas do relógio. É a
 *     base do folículo/hora dela. Sem isso, quem tem 2 blocos cronometrados de 12
 *     aparece com uma produtividade que ninguém mediu.
 */

export type BlocoHora = {
  id: number
  hora: number
  /** DIREITA | ESQUERDA | CENTRO — null nos blocos antigos, sem lado. */
  lado: string | null
  implantador: string | null
  auxiliares: string[]
  inicio: string | null
  fim: string | null
  fonte_inicio: 'registrado' | 'encadeado' | null
  duracao_min: number | null
  /** Preenchido quando a janela existe mas é impossível (negativa ou > 12 h). */
  duracao_suspeita_min: number | null
  foliculos: number
  foliculos_hora: number | null
}

export type PessoaNaCirurgia = {
  implantador: string
  blocos: number
  blocos_com_duracao: number
  minutos: number
  foliculos: number
  lados: string | null
  foliculos_hora: number | null
  base_horas: number
}

export type CirurgiaDetalhe = {
  cirurgia: {
    id: number
    paciente: string
    prontuario: string | null
    lead_id: string | null
    dia: string | null
    status: string | null
    sala: string | null
    idade: number | null
    meta: number | null
    medico: string | null
    anestesista: string | null
    hora_inicio: string | null
    dt_fim: string | null
    total_extraidos: number
    total_implantados: number
    synced_at: string | null
  } | null
  etapas: Array<{ etapa: string; inicio: string | null; fim: string | null; duracao_min: number | null }>
  blocos: BlocoHora[]
  por_pessoa: PessoaNaCirurgia[]
  qualidade: {
    blocos: number
    sem_inicio: number
    inicio_encadeado: number
    sem_fim: number
    duracao_suspeita: number
    sem_implantador: number
  }
}

export type ImplantadorPeriodo = {
  implantador_id: number | null
  implantador: string
  cirurgias: number
  blocos: number
  base_horas: number
  horas: number
  foliculos: number
  foliculos_bloco: number | null
  foliculos_hora: number | null
  pct_meta: number | null
  lados: string | null
}

export type EquipeSala = {
  range: { de: string; ate: string; meta: number }
  resumo: {
    pessoas: number
    cirurgias: number
    blocos: number
    blocos_com_duracao: number
    horas: number
    foliculos: number
    foliculos_hora: number | null
  }
  por_pessoa: ImplantadorPeriodo[]
  por_cirurgia: Array<{
    surgery_id: number
    dia: string
    paciente: string
    status: string | null
    meta: number | null
    blocos: number
    base_horas: number
    horas: number
    foliculos: number
    implantadores: string | null
  }>
  qualidade: {
    blocos: number
    sem_inicio: number
    inicio_encadeado: number
    sem_fim: number
    duracao_suspeita: number
    sem_implantador: number
    ultimo_sync: string | null
  }
}

/** Meta de folículos/hora do painel da sala. No PHP ela é hardcoded e o deploy é por FTP. */
export const META_FOLICULOS_HORA_PADRAO = 550

export async function fetchCirurgiaDetalhe(surgeryId: number): Promise<CirurgiaDetalhe | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_cirurgia_horas', { p_surgery_id: surgeryId })
  if (error) throw new Error(error.message)
  return (data as CirurgiaDetalhe) ?? null
}

export async function fetchEquipeSala(
  de: string,
  ate: string,
  meta = META_FOLICULOS_HORA_PADRAO,
): Promise<EquipeSala | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('crm_cirurgia_equipe', { p_de: de, p_ate: ate, p_meta: meta })
  if (error) throw new Error(error.message)
  return (data as EquipeSala) ?? null
}

/** 95 → "1 h 35"; 40 → "40 min". Decimal de hora ninguém lê na parede. */
export function duracao(min: number | null | undefined): string {
  if (min == null) return '—'
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  return resto > 0 ? `${h} h ${String(resto).padStart(2, '0')}` : `${h} h`
}

/** Só a hora do relógio: dentro da cirurgia o dia já está no cabeçalho. */
export function relogio(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export const LADO_LABEL: Record<string, string> = {
  DIREITA: 'Direita',
  ESQUERDA: 'Esquerda',
  CENTRO: 'Centro',
}
