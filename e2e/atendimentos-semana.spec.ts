import { expect, test, type Page } from '@playwright/test'

/**
 * A semana com NOME, não só com porcentagem.
 *
 * O pedido, em 08/set: "eu precisava que tivesse o nome deles também, para a gente
 * conseguir visualizar e não só números". A porcentagem sozinha não diz com quem falar
 * hoje, e era exatamente por isso que a planilha nunca virou gráfico.
 *
 * `v_clinic_atendimentos` só é legível logado, então a resposta é interceptada: o que está
 * sob teste é a tela, não a view.
 */

const ATENDIMENTOS = [
  {
    id: 'at-1',
    lead_id: 'lead-1',
    paciente: 'JOSE CARLOS SOUZA BARROS',
    telefone: '5544999999999',
    cidade: 'Maringá',
    email: null,
    origem: 'Indicação',
    tipo: 'consulta',
    indicacao: 'cirurgia',
    atendido_em: '2026-09-01',
    medico: 'Dra Lorena',
    observacao: null,
    venda_em: '2026-09-05',
    valor_cents: 1_500_000,
    fechou: true,
    coluna: 'encerrado',
    fonte: 'pos_consulta',
  },
  {
    id: 'at-2',
    lead_id: 'lead-2',
    paciente: 'CEZAR GUIRRO LUZIA',
    telefone: null,
    cidade: 'Maringá',
    email: null,
    origem: 'Instagram',
    tipo: 'retorno',
    indicacao: 'cirurgia',
    atendido_em: '2026-09-02',
    medico: 'Dra Lorena',
    observacao: null,
    venda_em: null,
    valor_cents: null,
    fechou: false,
    coluna: 'contato_2',
    fonte: 'pos_consulta',
  },
  {
    id: 'at-3',
    lead_id: null,
    paciente: 'WAGNER CUSTODIO',
    telefone: null,
    cidade: null,
    email: null,
    origem: null,
    tipo: 'consulta',
    indicacao: 'cirurgia',
    atendido_em: '2026-09-03',
    medico: null,
    observacao: null,
    venda_em: null,
    valor_cents: null,
    fechou: false,
    coluna: null,
    fonte: 'manual',
  },
]

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

async function comSafraFalsa(page: Page) {
  await page.route('**/rest/v1/v_clinic_atendimentos*', (route) => route.fulfill(json(ATENDIMENTOS)))
  await page.route('**/rest/v1/v_followup_kanban*', (route) => route.fulfill(json([])))
  await page.route('**/rest/v1/lead_followups*', (route) => route.fulfill(json([])))
}

test.describe('fechamento por semana', () => {
  test('mostra a porcentagem e, embaixo, quem fechou e quem não', async ({ page }) => {
    await comSafraFalsa(page)
    await page.goto('/central-vendas/follow-up')

    // 1 de 3 fechou.
    await expect(page.getByRole('button', { name: /31\/08 a 06\/09/ })).toContainText('33%')

    await expect(page.getByText('Fecharam (1)')).toBeVisible()
    await expect(page.getByRole('link', { name: 'JOSE CARLOS SOUZA BARROS' })).toBeVisible()
    // O valor da venda no lugar do "Fechou" genérico: é o que ela soma no fim da semana.
    await expect(page.getByText('R$ 15.000')).toBeVisible()

    await expect(page.getByText('Ainda não fecharam (2)')).toBeVisible()
    await expect(page.getByRole('link', { name: 'CEZAR GUIRRO LUZIA' })).toBeVisible()
    // Onde ele está parado hoje, senão a lista de quem não fechou vira lápide.
    // `exact` porque a coluna do quadro atrás também se chama "2º contato".
    await expect(page.getByText('2º contato', { exact: true })).toBeVisible()

    // Paciente sem card ainda aparece, e diz que ninguém marcou contato.
    await expect(page.getByText('WAGNER CUSTODIO')).toBeVisible()
    await expect(page.getByText('sem contato marcado')).toBeVisible()

    // A linha traz o que ela lê na planilha: tipo, data, médico, cidade e origem.
    await expect(page.getByText('Consulta 01/09 · Dra Lorena · Maringá · Indicação')).toBeVisible()
    await expect(page.getByText('Retorno 02/09 · Dra Lorena · Maringá · Instagram')).toBeVisible()
  })

  test('a semana anterior ao registro de atendimentos sai marcada como incompleta', async ({
    page,
  }) => {
    await page.route('**/rest/v1/v_clinic_atendimentos*', (route) =>
      route.fulfill(
        json([{ ...ATENDIMENTOS[0], id: 'at-9', atendido_em: '2026-07-07', fonte: 'venda' }]),
      ),
    )
    await page.route('**/rest/v1/v_followup_kanban*', (route) => route.fulfill(json([])))
    await page.route('**/rest/v1/lead_followups*', (route) => route.fulfill(json([])))
    await page.goto('/central-vendas/follow-up')

    // 100% ali não quer dizer nada: antes de 24/ago só o que fechou ficou gravado.
    const semana = page.getByRole('button', { name: /06\/07 a 12\/07/ })
    await expect(semana).toContainText('100%')
    await expect(semana).toContainText('só quem fechou')
  })
})
