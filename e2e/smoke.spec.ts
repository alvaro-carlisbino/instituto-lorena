import { expect, test } from '@playwright/test'

test.describe('smoke (modo mock)', () => {
  test('dashboard carrega após redirect da raiz', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Dashboard comercial' })).toBeVisible()
  })

  test('configurações e campos de workflow sem textarea JSON', async ({ page }) => {
    await page.goto('/configuracoes')
    await expect(page.getByRole('heading', { name: 'Configurações gerais' })).toBeVisible()
    await expect(page.getByText('Campos de workflow', { exact: true })).toBeVisible()
    await expect(page.locator('textarea')).toHaveCount(0)
  })

  test('configuração TV e grelha', async ({ page }) => {
    await page.goto('/tv-config')
    await expect(page.getByRole('heading', { name: 'Configuração da tela TV' })).toBeVisible()
    await expect(page.getByText('Posição na grelha').first()).toBeVisible()
    await expect(page.locator('textarea')).toHaveCount(0)
  })

  test('canais com mapeamento por linhas', async ({ page }) => {
    await page.goto('/canais')
    await expect(page.getByRole('heading', { name: 'Canais configuráveis' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Guardar mapeamento' }).first()).toBeVisible()
    await expect(page.locator('textarea')).toHaveCount(0)
  })

  test('lista de opções do workflow (tipo select)', async ({ page }) => {
    await page.goto('/configuracoes')
    const tempBlock = page.getByTestId('workflow-field-temperature')
    await expect(tempBlock.getByText('Opções da lista')).toBeVisible()
    await expect(tempBlock.getByRole('button', { name: 'Adicionar opção' })).toBeVisible()
  })
})
