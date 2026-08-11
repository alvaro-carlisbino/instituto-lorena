import { expect, test } from '@playwright/test'

/**
 * Corrigido em 11/ago/2026. Os seis testes estavam VERMELHOS, e não por regressão: a
 * reforma de densidade renomeou tudo que eles procuravam e ninguém atualizou aqui.
 *
 *   "Dashboard comercial"        → "Painel de Performance"
 *   "Configuração da tela TV"    → "Tela TV"        (o texto antigo sobrou no menu lateral,
 *   "Canais configuráveis"       → "Canais"          e por isso o snapshot enganava)
 *   "Todos os leads"             → "Leads"
 *   "Posição na grelha"          → "Posição na tela"
 *   "Guardar mapeamento"         → "Salvar mapeamento"
 *
 * Suíte que falha sempre é suíte que todo mundo aprende a ignorar. Foi exatamente o que
 * aconteceu: a Central de Vendas inteira subiu sem rota e nenhum teste reclamou.
 */
test.describe('smoke (modo mock)', () => {
  test('dashboard carrega após redirect da raiz', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Painel de Performance' })).toBeVisible()
  })

  test('campos de workflow sem textarea JSON', async ({ page }) => {
    await page.goto('/configuracoes')
    await expect(page.getByRole('heading', { name: 'Configurações gerais' })).toBeVisible()
    await expect(page.getByText('Campos personalizados', { exact: true })).toBeVisible()

    // A intenção original era "campo de workflow não se edita colando JSON". O assert
    // antigo contava textarea da página inteira e passou a falhar quando a seção de IA
    // ganhou o prompt global e as regras de negócio, que são textarea legítimo.
    // Escopado nas linhas de campo, mede o que o teste sempre quis medir.
    await expect(page.locator('[data-testid^="workflow-field-"] textarea')).toHaveCount(0)
  })

  test('configuração TV e grelha', async ({ page }) => {
    await page.goto('/tv-config')
    await expect(page.getByRole('heading', { name: 'Tela TV' })).toBeVisible()
    await expect(page.getByText('Posição na tela').first()).toBeVisible()
    await expect(page.locator('textarea')).toHaveCount(0)
  })

  test('canais com mapeamento por linhas', async ({ page }) => {
    await page.goto('/canais')
    await expect(page.getByRole('heading', { name: 'Canais' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Salvar mapeamento' }).first()).toBeVisible()
    await expect(page.locator('textarea')).toHaveCount(0)
  })

  test('lista de opções do workflow (tipo select)', async ({ page }) => {
    await page.goto('/configuracoes')
    const tempBlock = page.getByTestId('workflow-field-temperature')
    await expect(tempBlock).toBeVisible()
    await expect(tempBlock.getByText('Opções da lista')).toBeVisible()
    await expect(tempBlock.getByRole('button', { name: /Adicionar opção/ })).toBeVisible()
  })

  test('página de todos os leads', async ({ page }) => {
    await page.goto('/leads')
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible()
  })
})
