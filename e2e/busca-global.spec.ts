import { expect, test } from '@playwright/test'

/**
 * ⌘K precisa achar GENTE, não só tela.
 *
 * O banco já devolvia a pessoa (conferido por SQL com as claims do usuário logado) e mesmo
 * assim a paleta só listava telas. Este teste finge a resposta da RPC e cobra o resultado
 * na tela, que é a metade que ninguém tinha testado.
 */
const PESSOA = [
  {
    tipo: 'lead',
    ref: 'lead-1',
    lead_id: 'lead-1',
    nome: 'Alvaro Matheus Madureira Carlisbino',
    telefone: '44997168329',
    prontuario: null,
    cpf: null,
    achado_por: 'conta da loja',
    consultas: 0,
    cirurgias: 0,
    exames: 0,
    vendas: 4,
    ultimo_contato: null,
    polo: 'tricopill',
  },
]

test('⌘K lista a pessoa que a busca devolveu', async ({ page }) => {
  let chamou = false
  await page.route('**/rest/v1/rpc/crm_buscar_pacientes', async (route) => {
    chamou = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PESSOA),
    })
  })

  await page.goto('/dashboard')
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder(/Nome, telefone, CPF/)
  await expect(input).toBeVisible()
  await input.fill('Alvaro Ma')

  await expect.poll(() => chamou, { timeout: 5000 }).toBe(true)
  await expect(page.getByText('Alvaro Matheus Madureira Carlisbino')).toBeVisible()
  // Quem é de outro polo precisa vir etiquetado: a regra da casa é que clínica e vendas
  // não se somam, e lista sem etiqueta convida ao erro.
  await expect(page.getByRole('option', { name: /Alvaro Matheus/ })).toContainText('4 compras')
})
