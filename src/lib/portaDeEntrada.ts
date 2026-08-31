/**
 * Por que PORTA o lead entrou, derivada do próprio lead.
 *
 * Espelha, no navegador, a mesma regra do RPC `crm_leads_por_porta`
 * (`supabase/migrations/20260827200000_crm_leads_por_porta.sql`) — se um dos dois
 * mudar, o outro tem de mudar junto, senão o filtro da lista e o relatório de
 * `/resultados` passam a contar coisas diferentes com o mesmo nome.
 *
 * O `source` sozinho NÃO diz a porta, e é por isso que esta função existe:
 *
 *  - 810 dos 881 leads `meta_instagram` da clínica são formulário do Meta Lead Ads;
 *  - o lead da landing `/consulta` nasce `source: 'manual'` e vira `whatsapp` assim
 *    que a pessoa responde a mensagem da Sofia (o webhook de entrada regrava o
 *    `source`). Em 31/ago/2026, 6 dos 7 leads da landing já estavam como `whatsapp`.
 *
 * O que sobrevive à regravação é o `custom_fields`, porque o `upsertLeadByPhone` faz
 * MERGE — daí a ordem abaixo ir da evidência mais forte (carimbo próprio) para a mais
 * fraca (canal da conversa). A mesma pessoa pode ter entrado por mais de um caminho.
 */
export type PortaDeEntradaId = 'landing' | 'formulario' | 'whatsapp' | 'importacao' | 'presencial' | 'outro'

/** Rótulo de cada porta na tela. Mesmos textos de `/resultados`. */
export const PORTA_LABEL: Record<PortaDeEntradaId, string> = {
  landing: 'Landing /consulta',
  formulario: 'Formulário do anúncio',
  whatsapp: 'Direto no WhatsApp',
  presencial: 'Cadastro na recepção',
  importacao: 'Importação de planilha',
  outro: 'Outro',
}

/** Ordem de exibição: aquisição primeiro, listas carregadas depois no fim. */
export const PORTA_ORDEM: PortaDeEntradaId[] = [
  'landing',
  'formulario',
  'whatsapp',
  'outro',
  'presencial',
  'importacao',
]

const CANAIS_DE_CONVERSA = new Set(['meta_whatsapp', 'whatsapp', 'meta_instagram', 'meta_messenger'])

export function portaDoLead(lead: {
  source?: string | null
  customFields?: Record<string, unknown> | null
}): PortaDeEntradaId {
  const cf = lead.customFields ?? {}
  // `!= null` e não truthy: o RPC testa `is not null`, e string vazia continua sendo
  // carimbo da landing.
  if (cf.origem_landing != null) return 'landing'
  if (Object.prototype.hasOwnProperty.call(cf, 'lead_form')) return 'formulario'
  const source = lead.source ?? ''
  if (source.startsWith('planilha')) return 'importacao'
  if (source === 'consulta_presencial') return 'presencial'
  if (CANAIS_DE_CONVERSA.has(source)) return 'whatsapp'
  return 'outro'
}
