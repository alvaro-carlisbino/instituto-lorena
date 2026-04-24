import type { Interaction } from '@/mocks/crmMock'

export type InteractionsImportFile = {
  interactions: Array<{
    leadId: string
    patientName: string
    channel: Interaction['channel']
    direction: Interaction['direction']
    author: string
    content: string
    happenedAt: string
  }>
}

export function parseInteractionsImportJson(raw: string): InteractionsImportFile {
  const data = JSON.parse(raw) as unknown
  if (!data || typeof data !== 'object' || !Array.isArray((data as InteractionsImportFile).interactions)) {
    throw new Error('JSON inválido: esperado { "interactions": [ ... ] }')
  }
  return data as InteractionsImportFile
}
