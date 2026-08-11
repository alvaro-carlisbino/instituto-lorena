import { diaLocal } from '@/lib/diaLocal'
import { supabase } from '@/lib/supabaseClient'
import { listSurgicalStaff } from '@/services/clinicSales'

/**
 * A agenda do centro cirúrgico, com as duas metades juntas.
 *
 * O sistema tem duas listas de cirurgia que nunca se olharam numa tela de calendário:
 *
 *   • clinic_sales — o que a Aline VENDEU e marcou. Sabe paciente, procedimento, valor,
 *     médico que opera e a data combinada. É a única fonte do que ainda vai acontecer:
 *     hoje são 55 cirurgias futuras aqui contra 3 no espelho do centro cirúrgico.
 *
 *   • srg_surgeries — o que o centro cirúrgico REGISTROU (espelho do sistema PHP). Sabe
 *     sala, hora real de início, meta de folículos e o que foi implantado. É a verdade do
 *     que aconteceu, e enxerga cirurgia que nunca virou venda no CRM.
 *
 * A Conferência (na Central de Vendas) compara as duas linha a linha para achar divergência.
 * Aqui a pergunta é outra e mais simples: em que dia tem cirurgia, de quem, com quem, e o
 * dia está cheio. Por isso a fusão, e por isso o que existe só de um lado aparece marcado
 * em vez de sumir.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type OrigemCirurgia = 'venda' | 'sala' | 'ambos'

export type CirurgiaDoDia = {
  /** Chave estável para render: id da venda quando existe, senão o do espelho. */
  key: string
  /** Dia de calendário no fuso da clínica (YYYY-MM-DD). */
  dia: string
  paciente: string
  procedimento: string | null
  medico: string | null
  anestesista: string | null
  sala: string | null
  valorCents: number | null
  leadId: string | null
  saleId: string | null
  srgId: number | null
  /** Status da venda: vendida, agendada, realizada. */
  statusVenda: string | null
  /** Status no centro cirúrgico: AGUARDANDO, EM_PROCESSO, FINALIZADA. */
  statusSala: string | null
  /** Meta de folículos combinada na sala. */
  meta: number | null
  implantados: number | null
  /** Hora real de início, quando o centro cirúrgico registrou. */
  horaInicio: string | null
  origem: OrigemCirurgia
  cidade: string | null
  precisaHotel: boolean
}

type LinhaVenda = {
  id: string
  lead_id: string | null
  patient_name: string | null
  procedure_label: string | null
  performing_doctor: string | null
  seller_doctor: string | null
  attending_doctor: string | null
  anesthetist: string | null
  value_cents: number | null
  scheduled_at: string | null
  status: string | null
  room: string | null
  city: string | null
  hotel_needed: boolean | null
  srg_surgery_id: number | null
}

type LinhaEspelho = {
  id: number
  paciente_nome: string | null
  dia: string | null
  hora_inicio: string | null
  status: string | null
  sala: string | null
  meta: number | null
  total_implantados: number | null
  medico_id: number | null
  anestesista_id: number | null
  lead_id: string | null
}

/**
 * A fusão, separada do fetch para poder ser testada sem banco.
 *
 * Regra de precedência quando as duas fontes falam da mesma cirurgia: a VENDA manda no
 * que é combinado com o paciente (procedimento, valor, médico que vai operar) e o ESPELHO
 * manda no que é fato consumado (sala, hora que começou, folículos). Nenhuma das duas
 * apaga a outra.
 */
export function mesclarAgenda(
  vendas: LinhaVenda[],
  espelho: LinhaEspelho[],
  nomePorStaffId: Map<number, string>,
): CirurgiaDoDia[] {
  const porSrgId = new Map<number, LinhaEspelho>()
  for (const e of espelho) porSrgId.set(e.id, e)

  const usados = new Set<number>()
  const saida: CirurgiaDoDia[] = []
  const nomeStaff = (id: number | null | undefined): string | null =>
    id != null ? (nomePorStaffId.get(id) ?? null) : null

  for (const v of vendas) {
    if (!v.scheduled_at) continue
    const par = v.srg_surgery_id != null ? porSrgId.get(v.srg_surgery_id) : undefined
    if (par) usados.add(par.id)
    saida.push({
      key: `venda:${v.id}`,
      // O dia sai do espelho quando ele existe: quem confirma a data é a sala.
      dia: par?.dia ?? diaLocal(v.scheduled_at),
      paciente: v.patient_name ?? '—',
      procedimento: v.procedure_label,
      medico:
        v.performing_doctor ?? nomeStaff(par?.medico_id) ?? v.attending_doctor ?? v.seller_doctor,
      anestesista: v.anesthetist ?? nomeStaff(par?.anestesista_id),
      sala: par?.sala ?? v.room,
      valorCents: v.value_cents,
      leadId: v.lead_id ?? par?.lead_id ?? null,
      saleId: v.id,
      srgId: par?.id ?? null,
      statusVenda: v.status,
      statusSala: par?.status ?? null,
      meta: par?.meta ?? null,
      implantados: par?.total_implantados ?? null,
      horaInicio: par?.hora_inicio ?? null,
      origem: par ? 'ambos' : 'venda',
      cidade: v.city,
      precisaHotel: v.hotel_needed === true,
    })
  }

  // Cirurgia que o centro cirúrgico registrou e que não tem venda no CRM. Aparece
  // porque o bloco de sala está ocupado de qualquer jeito — some da agenda e a
  // equipe marca outra em cima.
  for (const e of espelho) {
    if (usados.has(e.id) || !e.dia) continue
    saida.push({
      key: `sala:${e.id}`,
      dia: e.dia,
      paciente: e.paciente_nome ?? '—',
      procedimento: null,
      medico: nomeStaff(e.medico_id),
      anestesista: nomeStaff(e.anestesista_id),
      sala: e.sala,
      valorCents: null,
      leadId: e.lead_id,
      saleId: null,
      srgId: e.id,
      statusVenda: null,
      statusSala: e.status,
      meta: e.meta,
      implantados: e.total_implantados,
      horaInicio: e.hora_inicio,
      origem: 'sala',
      cidade: null,
      precisaHotel: false,
    })
  }

  return saida.sort(
    (a, b) => a.dia.localeCompare(b.dia) || a.paciente.localeCompare(b.paciente, 'pt-BR'),
  )
}

/** Agrupa por dia (YYYY-MM-DD), para o calendário desenhar cada célula. */
export function agruparPorDia(itens: CirurgiaDoDia[]): Map<string, CirurgiaDoDia[]> {
  const mapa = new Map<string, CirurgiaDoDia[]>()
  for (const item of itens) {
    const lista = mapa.get(item.dia) ?? []
    lista.push(item)
    mapa.set(item.dia, lista)
  }
  return mapa
}

/**
 * Busca o intervalo [deDia, ateDia] inclusive, ambos YYYY-MM-DD.
 *
 * A janela do banco é folgada em um dia de cada lado de propósito: scheduled_at é
 * timestamptz e o corte exato dependeria de acertar o offset na query. Sobra recorte
 * no cliente, com diaLocal, que é o mesmo dia que a tela mostra.
 */
export async function listarAgendaCirurgica(deDia: string, ateDia: string): Promise<CirurgiaDoDia[]> {
  const client = assertClient()
  const folga = (dia: string, dias: number) =>
    new Date(`${dia}T12:00:00Z`).getTime() + dias * 86_400_000
  const inicio = new Date(folga(deDia, -1)).toISOString()
  const fim = new Date(folga(ateDia, 1)).toISOString()

  const [vendasRes, espelhoRes, staff] = await Promise.all([
    client
      .from('clinic_sales')
      .select(
        'id, lead_id, patient_name, procedure_label, performing_doctor, seller_doctor, attending_doctor, ' +
          'anesthetist, value_cents, scheduled_at, status, room, city, hotel_needed, srg_surgery_id',
      )
      .eq('kind', 'cirurgia')
      .neq('status', 'cancelada')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', inicio)
      .lte('scheduled_at', fim)
      .limit(500),
    client
      .from('srg_surgeries')
      .select(
        'id, paciente_nome, dia, hora_inicio, status, sala, meta, total_implantados, medico_id, anestesista_id, lead_id',
      )
      .is('deleted_at', null)
      .gte('dia', deDia)
      .lte('dia', ateDia)
      .limit(500),
    listSurgicalStaff().catch(() => []),
  ])

  if (vendasRes.error) throw new Error(vendasRes.error.message)
  if (espelhoRes.error) throw new Error(espelhoRes.error.message)

  const nomePorStaffId = new Map(staff.map((s) => [s.id, s.nome] as const))
  const mesclado = mesclarAgenda(
    (vendasRes.data ?? []) as unknown as LinhaVenda[],
    (espelhoRes.data ?? []) as unknown as LinhaEspelho[],
    nomePorStaffId,
  )
  return mesclado.filter((c) => c.dia >= deDia && c.dia <= ateDia)
}
