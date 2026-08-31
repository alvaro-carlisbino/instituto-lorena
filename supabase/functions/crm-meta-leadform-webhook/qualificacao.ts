/**
 * A régua de qualificação do formulário mora em `_shared/qualificacaoLead.ts`
 * desde 31/08/2026, porque a CONVERSA passou a usar a mesma.
 *
 * Este arquivo continua existindo só para não quebrar quem já importava daqui
 * (o `index.ts` do webhook e a suíte `qualificacao.test.ts`). Régua nova ou peso
 * novo se mexe no compartilhado, nunca aqui: dois arquivos com tabelas próprias
 * é como o score do formulário e o da conversa deixariam de ser comparáveis.
 */

export {
  AVALIACOES,
  CIDADES,
  PESO_PRAZO,
  PRAZOS,
  SEM_QUALIFICACAO,
  qualificar,
  resumoQualificacao,
} from '../_shared/qualificacaoLead.ts'
export type { Qualificacao } from '../_shared/qualificacaoLead.ts'
