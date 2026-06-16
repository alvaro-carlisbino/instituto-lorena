// CEP → cidade/UF (ViaCEP) + regra de praça local. Compartilhado entre o bot
// (crm-ai-assistant) e a cotação de frete (melhorEnvio / crm-frete-quote).

export type CepInfo = { cep: string; localidade: string; uf: string; bairro: string }

/** Acha o CEP mais recente (8 dígitos) num conjunto de textos do cliente. */
export function extractLatestCep(texts: string[]): string {
  for (let i = texts.length - 1; i >= 0; i--) {
    const m = String(texts[i] ?? '').match(/\b(\d{5})-?\s?(\d{3})\b/)
    if (m) return `${m[1]}${m[2]}`
  }
  return ''
}

/**
 * Resolve CEP -> cidade/UF no servidor (ViaCEP). A IA NUNCA deve adivinhar a cidade
 * pelo número do CEP (errava — ex.: tratou 87030-090/Maringá como Cascavel).
 */
export async function resolveCepBrasil(rawCep: string): Promise<CepInfo | null> {
  const digits = String(rawCep ?? '').replace(/\D/g, '')
  if (digits.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`)
    if (!res.ok) return null
    const data = (await res.json()) as { localidade?: string; uf?: string; bairro?: string; erro?: boolean }
    if (data.erro || !data.localidade) return null
    return {
      cep: `${digits.slice(0, 5)}-${digits.slice(5)}`,
      localidade: String(data.localidade),
      uf: String(data.uf ?? ''),
      bairro: String(data.bairro ?? ''),
    }
  } catch {
    return null
  }
}

/**
 * Maringá-PR = praça local: a entrega é INTERNA (própria/motoboy), não vai pelos
 * Correios. Detecta pela cidade (ViaCEP), não pelo número do CEP. Aceita a forma
 * com e sem acento (ViaCEP devolve "Maringá").
 */
export function isMaringa(info: { localidade?: string; uf?: string } | null | undefined): boolean {
  if (!info) return false
  const city = String(info.localidade ?? '').trim().toLowerCase()
  return (city === 'maringá' || city === 'maringa') && String(info.uf ?? '').toUpperCase() === 'PR'
}
