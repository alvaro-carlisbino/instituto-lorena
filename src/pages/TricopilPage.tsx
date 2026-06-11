import { ChatWorkspacePage } from './ChatWorkspacePage'

/**
 * Aba Tricopill — inbox de vendas do suplemento capilar. Reaproveita o workspace
 * de conversas, travado nas linhas de WhatsApp do tipo 'sales' (bot_kind='sales').
 * A IA dessas linhas usa a persona de vendas (não a Sofia/clínica) — ver
 * supabase/functions/crm-ai-assistant/index.ts (SALES_MODE_BLOCK).
 */
export function TricopilPage() {
  return <ChatWorkspacePage title="Tricopill — Vendas" restrictToBotKind="sales" />
}
