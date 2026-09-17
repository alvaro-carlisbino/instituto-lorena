import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O carimbo do polo da tela é estado de MÓDULO (vale uma aba inteira), e o valor inicial é
 * lido na importação. Cada caso recarrega o módulo com o endereço que quer testar.
 */
async function carregar(poloFixo: string | null) {
  vi.resetModules()
  vi.doMock('./poloFixo', () => ({
    poloFixoDoDeploy: () => poloFixo,
    appTravadoEmUmPolo: () => poloFixo !== null,
  }))
  return await import('./poloDaTela')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.doUnmock('./poloFixo')
  vi.resetModules()
})

describe('poloDaTela no endereço travado', () => {
  it('começa no polo do endereço, sem esperar o banco', async () => {
    const { poloDaTela } = await carregar('instituto-lorena')
    expect(poloDaTela()).toBe('instituto-lorena')
  })

  it('IGNORA o polo ativo velho do banco (o bug do 409 linha_indisponivel)', async () => {
    // Quem acabou de usar o CRM do Tricopill tem `active_tenant_id='tricopill'` gravado na
    // PESSOA. O boot do CRM lê esse valor antes de o TenantProvider realinhar; se ele
    // vencesse, a tela mostraria a clínica e o envio declararia Tricopill.
    const { poloDaTela, lembrarPoloDaTela } = await carregar('instituto-lorena')
    lembrarPoloDaTela('tricopill')
    expect(poloDaTela()).toBe('instituto-lorena')
  })

  it('aceita a confirmação quando o banco concorda com o endereço', async () => {
    const { poloDaTela, lembrarPoloDaTela } = await carregar('tricopill')
    lembrarPoloDaTela('tricopill')
    expect(poloDaTela()).toBe('tricopill')
  })
})

describe('poloDaTela no app sem trava (dev, localhost)', () => {
  it('não sabe nada até o boot contar', async () => {
    const { poloDaTela } = await carregar(null)
    expect(poloDaTela()).toBeNull()
  })

  it('aprende o polo ativo do login e depois acompanha a troca', async () => {
    const { poloDaTela, lembrarPoloDaTela } = await carregar(null)
    lembrarPoloDaTela('tricopill')
    expect(poloDaTela()).toBe('tricopill')
    lembrarPoloDaTela('instituto-lorena')
    expect(poloDaTela()).toBe('instituto-lorena')
  })

  it('vazio é ignorância, não notícia: mantém o que já sabia', async () => {
    const { poloDaTela, lembrarPoloDaTela } = await carregar(null)
    lembrarPoloDaTela('instituto-lorena')
    lembrarPoloDaTela('')
    lembrarPoloDaTela(null)
    lembrarPoloDaTela(undefined)
    expect(poloDaTela()).toBe('instituto-lorena')
  })
})
