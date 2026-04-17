export type DataMode = 'mock' | 'supabase'

export const getDataProviderMode = (): DataMode => {
  const mode = import.meta.env.VITE_DATA_MODE
  if (mode === 'supabase') return 'supabase'
  return 'mock'
}
