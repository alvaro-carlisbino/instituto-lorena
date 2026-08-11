/**
 * Saúde do feed de extrato (Open Finance) traduzida para frase de tela.
 *
 * Toda tela que conclui "esse dinheiro NÃO caiu no banco" está, na verdade, concluindo "não
 * achei no extrato que eu tenho". As duas coisas só são a mesma enquanto o extrato estiver
 * chegando. Quando o sync para (banco pediu reautorização, provedor com incidente, credencial
 * vencida), o último dia com lançamento congela e a tela segue conciliando uma janela menor
 * sem avisar ninguém — verde, no ar, e morta.
 *
 * Vive aqui, e não dentro de uma página, porque a pergunta se repete em toda tela que compara
 * venda com extrato: a conciliação geral e a conciliação do Shosp chegavam a respostas
 * diferentes sobre a mesma conta só porque uma checava e a outra não.
 */

import { diaLocal, diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'

/** O cron roda 3x/dia; 30h sem sync é o mesmo que 3 rodadas perdidas, aí não é atraso, é pane. */
const HORAS_ATE_SUSPEITAR = 30

/** Só o que interessa da conta — assim a regra é testável sem montar um `FinAccount` inteiro. */
export type ContaSincronizavel = {
  ofLastError: string | null
  ofLastSyncAt: string | null
}

function formatDay(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR')
}

/** "hoje 13:47", "ontem 05:20", "em 03/08/2026" — a pergunta é sempre "entrou quando?". */
export function sinceLabel(iso: string | null): string {
  if (!iso) return 'aguardando o primeiro sync'
  const hora = new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const dia = diaLocal(iso)
  if (dia === hojeLocal()) return `hoje ${hora}`
  if (dia === diaLocalComOffset(-1)) return `ontem ${hora}`
  return `em ${formatDay(dia)}`
}

/**
 * Devolve o motivo quando a conta parou de receber extrato, ou `null` quando está em dia.
 *
 * Erro gravado pelo sync vem primeiro porque é a causa; o silêncio longo é só o sintoma, e
 * mostrar "sem extrato novo" quando existe um erro registrado esconde o que precisa ser
 * consertado.
 */
export function bankSyncTrouble(a: ContaSincronizavel): string | null {
  if (a.ofLastError) return `parou de sincronizar: ${a.ofLastError}`
  if (!a.ofLastSyncAt) return 'ainda não sincronizou nenhuma vez'
  const horas = (Date.now() - new Date(a.ofLastSyncAt).getTime()) / 3_600_000
  if (horas > HORAS_ATE_SUSPEITAR) {
    return `sem extrato novo desde ${sinceLabel(a.ofLastSyncAt)} — reautorize o banco`
  }
  return null
}
