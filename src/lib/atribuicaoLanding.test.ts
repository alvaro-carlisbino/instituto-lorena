import { describe, expect, it } from 'vitest'

import { atribuicaoDaUrl, resolverAtribuicao, resolverSessao, type ArmazenamentoSimples } from './atribuicaoLanding'

function memoria(inicial: Record<string, string> = {}): ArmazenamentoSimples & { dados: Record<string, string> } {
  const dados = { ...inicial }
  return {
    dados,
    getItem: (k) => dados[k] ?? null,
    setItem: (k, v) => {
      dados[k] = v
    },
  }
}

describe('atribuição da URL', () => {
  it('lê gclid e utm do clique do anúncio', () => {
    const a = atribuicaoDaUrl('https://crm.exemplo.com/consulta?gclid=ABC123&utm_campaign=busca-transplante')
    expect(a.gclid).toBe('ABC123')
    expect(a.utm_campaign).toBe('busca-transplante')
    expect(a.landing_path).toBe('/consulta')
  })

  it('ignora referrer do próprio site', () => {
    const a = atribuicaoDaUrl('https://crm.exemplo.com/consulta', 'https://crm.exemplo.com/dashboard')
    expect(a.referrer).toBeUndefined()
  })

  it('guarda referrer de fora', () => {
    const a = atribuicaoDaUrl('https://crm.exemplo.com/consulta', 'https://www.google.com/')
    expect(a.referrer).toBe('https://www.google.com/')
  })
})

describe('first-touch', () => {
  it('mantém o gclid depois de a pessoa voltar sem parâmetro', () => {
    const store = memoria()
    resolverAtribuicao(atribuicaoDaUrl('https://x.com/consulta?gclid=CLIQUE1'), store)
    const depois = resolverAtribuicao(atribuicaoDaUrl('https://x.com/consulta'), store)
    expect(depois.gclid).toBe('CLIQUE1')
  })

  it('aceita a campanha nova quando ela existe', () => {
    const store = memoria()
    resolverAtribuicao(atribuicaoDaUrl('https://x.com/consulta?gclid=CLIQUE1'), store)
    const depois = resolverAtribuicao(atribuicaoDaUrl('https://x.com/consulta?fbclid=META9'), store)
    expect(depois.fbclid).toBe('META9')
  })

  it('funciona sem armazenamento (navegação privada)', () => {
    const a = resolverAtribuicao({ gclid: 'X' }, null)
    expect(a.gclid).toBe('X')
  })
})

describe('sessão', () => {
  it('reaproveita a sessão já aberta', () => {
    const store = memoria({ 'lorena-landing-sessao': 's-abcdefgh' })
    expect(resolverSessao(store, () => 's-nova1234')).toBe('s-abcdefgh')
  })

  it('cria uma sessão quando não existe', () => {
    const store = memoria()
    expect(resolverSessao(store, () => 's-nova1234')).toBe('s-nova1234')
    expect(store.dados['lorena-landing-sessao']).toBe('s-nova1234')
  })
})
