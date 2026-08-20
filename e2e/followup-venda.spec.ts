import { expect, test, type Page } from '@playwright/test'

/**
 * Fechar a venda de dentro do registro do follow-up.
 *
 * O pedido que motivou: "coloca um botão aqui no registro do follow-up para eu
 * cadastrar a venda quando eu fechar por aqui, sem precisar ir em vendas e fazer
 * o registro todo". O caminho tem três partes que só quebram juntas — o botão
 * abre o formulário, o paciente já vem escolhido, e salvar encerra o contato com
 * desfecho "Fechou" — então o teste percorre as três.
 *
 * O quadro vem de `v_followup_kanban`, que o navegador só enxerga logado. Aqui a
 * resposta é interceptada: o que está sob teste é a tela, não a view.
 */

const CARD = {
  followup_id: 'fu-1',
  lead_id: 'lead-1',
  patient_name: 'ELIUD JOSE DE PAIVA JUNIOR',
  phone: '44999990000',
  attempt_no: 1,
  scheduled_for: '2026-08-19',
  done_at: null,
  outcome: null,
  note: 'Vai retornar até amanhã para fecharmos',
  coluna: 'contato_1',
  dias_atraso: 1,
  venda_id: null,
  cirurgia_em: null,
  pipeline_id: 'pipeline-processo-cirurgico',
}

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

async function comQuadroFalso(page: Page, patches: string[]) {
  await page.route('**/rest/v1/v_followup_kanban*', (route) => route.fulfill(json([CARD])))
  await page.route('**/rest/v1/lead_followups*', (route) => {
    const req = route.request()
    if (req.method() === 'PATCH') patches.push(req.postData() ?? '')
    return route.fulfill(json([]))
  })
  await page.route('**/rest/v1/srg_staff*', (route) => route.fulfill(json([])))
  await page.route('**/rest/v1/anesthesia_providers*', (route) => route.fulfill(json([])))
  await page.route('**/rest/v1/clinic_sales*', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(json({ id: 'venda-1' }))
      : route.fulfill(json([])),
  )
}

test.describe('follow-up: fechou a venda aqui mesmo', () => {
  test('o botão abre a venda com o paciente já escolhido e volta ao contato se cancelar', async ({
    page,
  }) => {
    await comQuadroFalso(page, [])
    await page.goto('/central-vendas/follow-up')

    await page.getByRole('button', { name: 'Registrar' }).first().click()
    await expect(page.getByText(`Contato com ${CARD.patient_name}`)).toBeVisible()

    await page.getByRole('button', { name: /Fechou: cadastrar a venda/ }).click()

    // O formulário abre já sabendo quem é: o funil do card é o cirúrgico.
    await expect(page.getByText('Nova venda cirúrgica')).toBeVisible()
    await expect(page.getByLabel('Buscar paciente', { exact: true })).toHaveValue(
      CARD.patient_name,
    )

    // Desistir do cadastro não pode perder o registro do contato.
    await page.getByRole('button', { name: 'Cancelar' }).click()
    await expect(page.getByText(`Contato com ${CARD.patient_name}`)).toBeVisible()
  })

  test('salvar a venda encerra o contato com desfecho Fechou', async ({ page }) => {
    const patches: string[] = []
    await comQuadroFalso(page, patches)
    await page.goto('/central-vendas/follow-up')

    await page.getByRole('button', { name: 'Registrar' }).first().click()
    await page.getByRole('button', { name: /Fechou: cadastrar a venda/ }).click()

    await page.getByPlaceholder('Tc Frontal/ Coroa').fill('Tc Frontal/ Coroa')
    await page.getByPlaceholder('30.000,00').fill('30.000,00')
    await page.getByRole('checkbox', { name: 'A definir' }).click()
    await page.getByRole('button', { name: 'Registrar venda' }).click()

    // O aviso do formulário ("Venda registrada.") sai antes; o que prova o
    // encerramento é o da tela do quadro.
    await expect(page.getByText(/foi para "Encerrado"/)).toBeVisible()
    expect(patches.join(' ')).toContain('"outcome":"Fechou"')
    // Sem próxima data: o paciente não pode continuar na fila depois de comprar.
    expect(patches.join(' ')).not.toContain('scheduled_for')
  })
})
