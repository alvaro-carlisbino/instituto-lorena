// Consulta de CEP no ViaCEP (público, CORS liberado) para autopreencher endereço no
// frontend. Espelha a mesma fonte usada no backend (_shared/cep.ts) — mantém rua/bairro/
// cidade/UF consistentes entre a captura na tela e a criação do contato no Bling.
export type ViaCepResult = { logradouro: string; bairro: string; cidade: string; uf: string }

export async function lookupCep(rawCep: string): Promise<ViaCepResult | null> {
  const cep = String(rawCep ?? '').replace(/\D/g, '')
  if (cep.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`)
    if (!res.ok) return null
    const d = (await res.json()) as {
      logradouro?: string
      bairro?: string
      localidade?: string
      uf?: string
      erro?: boolean
    }
    if (d.erro) return null
    return {
      logradouro: d.logradouro ?? '',
      bairro: d.bairro ?? '',
      cidade: d.localidade ?? '',
      uf: (d.uf ?? '').toUpperCase(),
    }
  } catch {
    return null
  }
}
