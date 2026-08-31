import type { Interaction } from '@/mocks/crmMock'
import type { ConversationOwnerMode } from '@/services/conversationControl'
import { isWithinTeamHours, parseTeamHours, type TeamHoursSchedule } from '@/lib/teamHours'

export type AiConversationGate = {
  ownerMode: ConversationOwnerMode
  aiEnabled: boolean
  /** `crm_ai_configs.ai_offhours_only`: a IA só responde fora do turno da equipe. */
  offHoursOnly?: boolean
  /** Turno da equipe já lido de `crm_ai_configs.ai_team_hours`. */
  teamHours?: TeamHoursSchedule
}

/**
 * Lê da config da IA o que a tela precisa para não prometer resposta que não vem.
 *
 * Substituiu `businessHoursFromAiConfig`, que lia `business_hours_*` — essa janela é a de
 * SUGERIR horário de consulta (na clínica está 08:00–23:59) e nunca foi o turno de ninguém.
 */
export function teamHoursGateFromAiConfig(cfg: {
  ai_offhours_only?: boolean | null
  ai_team_hours?: unknown
}): { offHoursOnly: boolean; teamHours: TeamHoursSchedule } {
  return {
    offHoursOnly: cfg.ai_offhours_only === true,
    teamHours: parseTeamHours(cfg.ai_team_hours),
  }
}

function isFromAiAssistant(author: string): boolean {
  return /assistente\s*ia/i.test(author.trim())
}

/**
 * Mensagem de GENTE, não de robô. Mesmo critério do servidor: e-mail da equipe ou "Operador".
 * Filtrar só por "não é Assistente IA" deixaria passar `Sofia (IA)`, `NPS (Sofia)` e o
 * follow-up automático, e a conversa pareceria atendida por humano sem nunca ter sido.
 */
function isFromHuman(author: string): boolean {
  const a = author.trim()
  return a.includes('@') || a === 'Operador'
}

/**
 * Indica se é provável que a IA automática esteja a gerar/enviar resposta ao paciente.
 * Evita que a equipa responda em duplicado nos segundos após uma entrada WhatsApp/Meta.
 */
export function isAiReplyLikelyPending(args: {
  history: Interaction[]
  gate: AiConversationGate
  now?: Date
  /** Máx. tempo após a última entrada do paciente para mostrar o indicador */
  windowMs?: number
}): boolean {
  const now = args.now ?? new Date()
  const windowMs = args.windowMs ?? 95_000

  if (!args.gate.aiEnabled) return false
  if (args.gate.ownerMode === 'human') return false

  // Turno da equipe: dentro dele a IA cala (é gente que atende), então o indicador não pode
  // aparecer — antes desta trava ele mentia ao contrário, sumindo à noite, que é justamente
  // quando a IA responde. Vale para 'ai' e 'auto', tal como o gate do servidor.
  //
  // A exceção do PRIMEIRO ATENDIMENTO (31/08/2026) precisa valer aqui também: enquanto
  // ninguém da equipe tiver falado, a Sofia responde mesmo dentro do turno. Sem esta linha
  // o indicador sumiria exatamente quando ela está digitando, e a atendente responderia por
  // cima — que é o duplo atendimento que este indicador existe para evitar.
  const humanoJaFalou = args.history.some((i) => i.direction === 'out' && isFromHuman(i.author))
  if (args.gate.offHoursOnly && humanoJaFalou && isWithinTeamHours(now, args.gate.teamHours)) {
    return false
  }

  const sorted = [...args.history].sort(
    (a, b) => new Date(a.happenedAt).getTime() - new Date(b.happenedAt).getTime(),
  )
  const last = sorted[sorted.length - 1]
  if (!last || last.direction !== 'in') return false
  if (last.channel !== 'whatsapp' && last.channel !== 'meta') return false

  const lastTs = new Date(last.happenedAt).getTime()
  if (now.getTime() - lastTs > windowMs) return false

  const afterOrAtInbound = sorted.filter((i) => new Date(i.happenedAt).getTime() >= lastTs - 500)

  const aiOutAfter = afterOrAtInbound.some((i) => i.direction === 'out' && isFromAiAssistant(i.author))
  if (aiOutAfter) return false

  const humanOutAfter = afterOrAtInbound.some(
    (i) => i.direction === 'out' && !isFromAiAssistant(i.author),
  )
  if (humanOutAfter) return false

  return true
}
