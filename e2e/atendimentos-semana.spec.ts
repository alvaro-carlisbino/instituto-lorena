import { expect, test, type Page } from '@playwright/test'

/**
 * A safra do MÊS, semana a semana e com os nomes.
 *
 * Dois pedidos da Aline em 08/set, na mesma manhã: "eu precisava que tivesse o nome deles
 * também, para a gente conseguir visualizar e não só números" e, depois, "tem como deixar
 * só do mês de setembro?".
 *
 * `v_clinic_atendimentos` só é legível logado, então a resposta é interceptada. E o stub
 * respeita a faixa de datas que a tela pede: sem isso o teste passaria mesmo se a tela
 * pedisse o ano inteiro, que é justamente o que ela mandou consertar.
 */

// Datas relativas ao mês corrente: a tela mostra o mês de hoje, e fixture com data fixa
// quebraria sozinha na virada do mês.
const hoje = new Date()
const mes = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
/** Segunda-feira da primeira semana cheia do mês. Os três atendimentos caem nela. */
const primeiraSegunda = new Date(mes)
primeiraSegunda.setDate(1 + ((8 - mes.getDay()) % 7))

const dia = (n: number) => {
  const d = new Date(primeiraSegunda)
  d.setDate(d.getDate() + n)
  return {
    iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    br: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
  }
}

const SEG = dia(0)
const TER = dia(1)
const QUA = dia(2)

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
    atendido_em: SEG.iso,
    medico: 'Dra Lorena',
    observacao: null,
    venda_em: QUA.iso,
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
    atendido_em: TER.iso,
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
    atendido_em: QUA.iso,
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

/** O que o PostgREST devolveria: só o que está dentro da faixa pedida na URL. */
const dentroDaFaixa = (url: string, linhas: typeof ATENDIMENTOS) => {
  const filtros = new URL(url).searchParams.getAll('atendido_em')
  const de = filtros.find((f) => f.startsWith('gte.'))?.slice(4)
  const ate = filtros.find((f) => f.startsWith('lte.'))?.slice(4)
  return linhas.filter((l) => (!de || l.atendido_em >= de) && (!ate || l.atendido_em <= ate))
}

async function comSafraFalsa(page: Page, linhas = ATENDIMENTOS) {
  await page.route('**/rest/v1/v_clinic_atendimentos*', (route) =>
    route.fulfill(json(dentroDaFaixa(route.request().url(), linhas))),
  )
  await page.route('**/rest/v1/v_followup_kanban*', (route) => route.fulfill(json([])))
  await page.route('**/rest/v1/lead_followups*', (route) => route.fulfill(json([])))
}

test.describe('fechamento do mês', () => {
  test('mostra a porcentagem e, embaixo, quem fechou e quem não', async ({ page }) => {
    await comSafraFalsa(page)
    await page.goto('/central-vendas/follow-up')

    // 1 de 3 fechou, no mês e na semana.
    await expect(page.getByText(/33% no mês · 1 de 3 atendimentos/)).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`${SEG.br} a `) })).toContainText('33%')

    await expect(page.getByText('Fecharam (1)')).toBeVisible()
    await expect(page.getByRole('link', { name: 'JOSE CARLOS SOUZA BARROS' })).toBeVisible()
    // O valor da venda no lugar do "Fechou" genérico: é o que ela soma no fim da semana.
    // `exact` porque o resumo do mês soma o mesmo valor e também traz "R$ 15.000".
    await expect(page.getByText('R$ 15.000', { exact: true })).toBeVisible()

    await expect(page.getByText('Ainda não fecharam (2)')).toBeVisible()
    await expect(page.getByRole('link', { name: 'CEZAR GUIRRO LUZIA' })).toBeVisible()
    // Onde ele está parado hoje, senão a lista de quem não fechou vira lápide.
    // `exact` porque a coluna do quadro atrás também se chama "2º contato".
    await expect(page.getByText('2º contato', { exact: true })).toBeVisible()

    // Paciente sem card ainda aparece, e diz que ninguém marcou contato.
    await expect(page.getByText('WAGNER CUSTODIO')).toBeVisible()
    await expect(page.getByText('sem contato marcado')).toBeVisible()

    // A linha traz o que ela lê na planilha: tipo, data, médico, cidade e origem.
    await expect(
      page.getByText(`Consulta ${SEG.br} · Dra Lorena · Maringá · Indicação`),
    ).toBeVisible()
    await expect(
      page.getByText(`Retorno ${TER.br} · Dra Lorena · Maringá · Instagram`),
    ).toBeVisible()
  })

  test('o mês anterior fica a um clique, e o seguinte não existe', async ({ page }) => {
    await comSafraFalsa(page)
    await page.goto('/central-vendas/follow-up')
    await expect(page.getByRole('link', { name: 'CEZAR GUIRRO LUZIA' })).toBeVisible()

    // `exact` porque a coluna "Encerrado · cirurgia do mês seguinte" também casa.
    const proximoMes = page.getByRole('button', { name: 'Mês seguinte', exact: true })
    // Mês que ainda não começou não tem atendimento: o botão só levaria a tela vazia.
    await expect(proximoMes).toBeDisabled()

    await page.getByRole('button', { name: 'Mês anterior' }).click()

    // O stub respeita a faixa pedida: ninguém do mês corrente vaza para o anterior.
    await expect(page.getByText(/Nenhum atendimento registrado em/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'CEZAR GUIRRO LUZIA' })).toBeHidden()
    await expect(proximoMes).toBeEnabled()
  })

  test('marca a safra em que só o que fechou ficou gravado', async ({ page }) => {
    // `fonte: 'venda'` é a linha que só existe porque virou venda: quem não fechou naquela
    // época nunca foi registrado, então 100% ali não quer dizer nada.
    await comSafraFalsa(page, [{ ...ATENDIMENTOS[0], id: 'at-9', fonte: 'venda' }])
    await page.goto('/central-vendas/follow-up')

    await expect(page.getByText(/100% no mês · 1 de 1 atendimento/)).toBeVisible()
    await expect(page.getByText('safra incompleta')).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`${SEG.br} a `) })).toContainText(
      'só quem fechou',
    )
  })
})
