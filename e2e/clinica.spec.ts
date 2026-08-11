import { expect, test } from '@playwright/test'

/**
 * Fluxo de cirurgia e protocolo.
 *
 * O bug que motivou este arquivo: CentralVendasPage.tsx existia com quatro abas prontas,
 * clinic_sales tinha 213 cirurgias e 205 protocolos importados, e a tela NÃO tinha rota
 * nem entrada de menu. Era inalcançável no app. Nenhum teste pegava isso porque nenhum
 * teste abria a página.
 *
 * Estes testes são deliberadamente rasos: garantem que a rota existe e que a tela monta.
 * É o que faltava.
 */

const telas = [
  { path: '/central-vendas', heading: 'Central de Vendas' },
  { path: '/central-vendas/follow-up', heading: 'Follow-up' },
  { path: '/central-vendas/pos-consulta', heading: 'Pós-consulta' },
  { path: '/central-vendas/cirurgias', heading: 'Cirurgias agendadas' },
  { path: '/central-vendas/conferencia', heading: 'Conferência com a sala' },
  { path: '/protocolos', heading: 'Protocolos de tratamento' },
  { path: '/cirurgias-vinculo', heading: 'Cirurgias sem paciente' },
]

test.describe('clínica: cirurgia e protocolo', () => {
  for (const { path, heading } of telas) {
    test(`${path} abre e monta`, async ({ page }) => {
      const erros: string[] = []
      page.on('pageerror', (e) => erros.push(e.message))

      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      // rota inexistente cairia no fallback e nunca mostraria o heading, mas um erro de
      // runtime no componente também não pode passar calado
      expect(erros, `erro de runtime em ${path}`).toEqual([])
    })
  }

  test('conferência tem as cinco faixas de gravidade', async ({ page }) => {
    await page.goto('/central-vendas/conferencia')
    for (const faixa of [
      'realizada_sem_confirmacao',
      'data_diverge',
      'sem_espelho',
      'agendada_sem_espelho',
      'confirmada',
    ]) {
      await expect(page.getByTestId(`conferencia-filtro-${faixa}`)).toBeVisible()
    }
  })

  test('a Central de Vendas é alcançável pela navegação, não só pela URL', async ({ page }) => {
    // o registro único de navegação (src/config/navigation.ts) alimenta menu e ⌘K;
    // tela fora dele existe mas ninguém acha
    await page.goto('/dashboard')
    await page.keyboard.press('Meta+k')
    await page.getByPlaceholder(/buscar/i).first().fill('Central de Vendas')
    await expect(page.getByText('Central de Vendas').first()).toBeVisible()
  })
})
