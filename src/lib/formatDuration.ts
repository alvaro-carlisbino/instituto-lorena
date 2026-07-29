/**
 * Duração em português de gente, a partir de minutos.
 *
 * O quadro de leads mostrava "ATENÇÃO: 149003M ATRASADO" — 149 mil minutos são 103 dias,
 * mas ninguém faz essa conta olhando um card. Um número grande demais para significar
 * algo vira ruído: o alerta some de vista justamente nos leads mais parados.
 */
export function formatDurationFromMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))

  if (minutes < 1) return 'menos de 1 min'
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const restMinutes = minutes % 60
    // Acima de 3h o resto em minutos não muda decisão nenhuma.
    if (hours >= 3 || restMinutes === 0) return `${hours}h`
    return `${hours}h${String(restMinutes).padStart(2, '0')}`
  }

  const days = Math.floor(hours / 24)
  if (days < 7) {
    const restHours = hours % 24
    if (restHours === 0) return days === 1 ? '1 dia' : `${days} dias`
    return `${days}d ${restHours}h`
  }

  if (days < 60) return `${days} dias`

  const months = Math.floor(days / 30)
  return `${months} meses`
}
