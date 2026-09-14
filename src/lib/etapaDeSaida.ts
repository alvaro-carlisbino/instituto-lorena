import type { Pipeline, Stage } from '@/mocks/crmMock'

// Etapa onde o atendimento acaba sem venda: "Encerrado", "Perdido", "Fornecedor / não se aplica".
// "Não fechou" e "Cancelou" ficam de fora de propósito: são desfecho de proposta nos funis
// pós-consulta, não a saída de quem ainda está na triagem.
const SAIDA_RE = /encerrad|perdid|n[aã]o se aplica/i

export function ehEtapaDeSaida(stage: Stage): boolean {
  return SAIDA_RE.test(stage.name)
}

export type SaidaDeOutroFunil = { pipeline: Pipeline; stage: Stage }

/**
 * Para onde a ficha oferece encerrar o lead quando o funil dele não tem saída.
 *
 * O funil TRANSPLANTE CAPILAR (`pipeline-tratamento-capilar`) é para onde a triagem da Sofia
 * manda quem escolhe transplante no menu, e não tem etapa de encerramento. Em 14/set/2026 eram
 * 302 leads lá sem nenhum jeito de finalizar pelo chat: a Aline tinha paciente dizendo
 * "Não obrigado" e o seletor de etapa só oferecia Triagem, Avaliação, Plano...
 *
 * Devolve as saídas dos outros funis do MESMO polo (hoje: "Encerrado" e "Fornecedor / não se
 * aplica" da Clínica), que já são respeitadas pelo follow-up, reengajamento e métricas.
 * Funil sem polo conhecido não recebe nada: saída de outro polo misturaria os negócios.
 */
export function saidasDeOutroFunil(catalogo: Pipeline[], atual: Pipeline): SaidaDeOutroFunil[] {
  if (atual.stages.some(ehEtapaDeSaida)) return []
  if (!atual.tenantId) return []
  return catalogo
    .filter((p) => p.id !== atual.id && p.tenantId === atual.tenantId)
    .flatMap((p) => p.stages.filter(ehEtapaDeSaida).map((stage) => ({ pipeline: p, stage })))
}
