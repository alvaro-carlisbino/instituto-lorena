import type { Lead } from '@/mocks/crmMock'

export const temperatureLabel: Record<Lead['temperature'], string> = {
  cold: 'Frio',
  warm: 'Morno',
  hot: 'Quente',
}

export function formatTemperature(value: unknown, fallback: Lead['temperature']): string {
  const v = value === 'cold' || value === 'warm' || value === 'hot' ? value : fallback
  return temperatureLabel[v]
}
