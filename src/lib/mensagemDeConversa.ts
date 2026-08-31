import type { Interaction } from '@/mocks/crmMock'

/**
 * Nota de sistema NÃO é mensagem de conversa.
 *
 * `interactions` guarda duas coisas diferentes na mesma tabela: o que o paciente e a
 * clínica falaram, e o registro interno do CRM ("card movido para X", "lead duplicado",
 * "link de cartão gerado"). A tabela já sabe separar — o gatilho
 * `_advance_lead_last_interaction_at` ignora `channel='system'` de propósito, senão todo
 * card arrastado no quadro pareceria ter acabado de falar com o paciente.
 *
 * A LEITURA do chat nunca recebeu essa regra, e em 31/08/2026 a conta chegou: a
 * reorganização do Kanban da clínica moveu 175 cards e gravou uma nota em cada um. As
 * notas saíram com `direction='in'` (o webhook do formulário da Meta grava assim também),
 * então para a tela pareceram 149 pacientes escrevendo ao mesmo tempo às 14:51:
 *
 * - o badge "não lidas" pulou para 99+ de uma vez;
 * - a lista "Mais recentes" encheu de card que ninguém tinha falado, empurrando para
 *   baixo quem tinha mesmo acabado de mandar mensagem — parecia que mensagem nova
 *   tinha parado de chegar, e não tinha.
 *
 * Por isso o filtro é por `channel`, não por `direction`: é o `channel` que diz se
 * aquilo é conversa, e é o mesmo critério que o banco já usa.
 */
export function ehMensagemDeConversa(i: Pick<Interaction, 'channel'>): boolean {
  return i.channel !== 'system'
}

/** Mensagem que o paciente mandou de verdade — a que torna a conversa "não lida". */
export function ehRecebidaDoPaciente(i: Pick<Interaction, 'channel' | 'direction'>): boolean {
  return i.direction === 'in' && ehMensagemDeConversa(i)
}
