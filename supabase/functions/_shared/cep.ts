// CEP → cidade/UF (ViaCEP) + regra de praça local. Compartilhado entre o bot
// (crm-ai-assistant) e a cotação de frete (melhorEnvio / crm-frete-quote).

export type CepInfo = { cep: string; localidade: string; uf: string; bairro: string; logradouro: string }

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
    const data = (await res.json()) as { localidade?: string; uf?: string; bairro?: string; logradouro?: string; erro?: boolean }
    if (data.erro || !data.localidade) return null
    return {
      cep: `${digits.slice(0, 5)}-${digits.slice(5)}`,
      localidade: String(data.localidade),
      uf: String(data.uf ?? ''),
      bairro: String(data.bairro ?? ''),
      logradouro: String(data.logradouro ?? ''),
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

/**
 * Cidades atendidas pela ENTREGA INTERNA da equipe (mesma praça de Maringá): Maringá e
 * as vizinhas Sarandi, Paiçandu e Marialva (PR). Entrega própria (Maringá R$ 15 /
 * região R$ 20 — ver localDeliveryCents), não Correios.
 * Fora dessas → envio externo (Melhor Envio). Compara sem acento.
 */
const LOCAL_DELIVERY_CITIES = new Set(['maringa', 'sarandi', 'paicandu', 'marialva'])
const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
export function isLocalDeliveryCity(info: { localidade?: string; uf?: string } | null | undefined): boolean {
  if (!info) return false
  const city = stripAccents(String(info.localidade ?? '').trim().toLowerCase())
  return LOCAL_DELIVERY_CITIES.has(city) && String(info.uf ?? '').toUpperCase() === 'PR'
}

/**
 * Cidades da REGI\u00c3O (vizinhas atendidas pela equipe, mas FORA de Maring\u00e1): Sarandi,
 * Pai\u00e7andu e Marialva. A entrega \u00e9 interna (pr\u00f3pria), mas a TAXA \u00e9 maior que a de
 * Maring\u00e1 (R$ 20 vs R$ 15). Maring\u00e1 em si N\u00c3O entra aqui.
 */
export function isMaringaRegion(info: { localidade?: string; uf?: string } | null | undefined): boolean {
  return isLocalDeliveryCity(info) && !isMaringa(info)
}
