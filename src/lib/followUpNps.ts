import type { SurveyTemplate } from '@/mocks/crmMock'

export const NPS_TEMPLATE_ID_BY_PIPELINE: Record<string, string> = {
  'pipeline-clinica': 'nps-clinica',
  'pipeline-tratamento-capilar': 'nps-capilar',
  'pipeline-processo-cirurgico': 'nps-cirurgico',
}

/**
 * Etapas "fim de jornada" onde disparamos NPS in-app (código de pesquisa + registo na ficha Tarefas).
 */
export function shouldDispatchNpsForStage(stageId: string): boolean {
  if (stageId === 'fechado' || stageId === 'tc-concluido' || stageId === 'cx-alta') {
    return true
  }
  if (stageId.includes('fechado') || stageId.includes('encerrado')) {
    return true
  }
  return false
}

/**
 * Não contar carga de trabalho SDR em etapas encerradas/concluídas.
 */
export function isWorkloadExcludedStageId(stageId: string): boolean {
  if (stageId === 'fechado' || stageId === 'tc-concluido' || stageId === 'cx-alta') {
    return true
  }
  if (stageId.includes('fechado') || stageId.includes('encerrado')) {
    return true
  }
  return false
}

export function pickNpsTemplateForPipeline(
  pipelineId: string,
  templates: readonly SurveyTemplate[],
): SurveyTemplate | undefined {
  const preferred = NPS_TEMPLATE_ID_BY_PIPELINE[pipelineId] ?? 'nps-default'
  return templates.find((t) => t.id === preferred && t.enabled) ?? templates.find((t) => t.enabled)
}
