// Registro ÚNICO da navegação do financeiro, em dois níveis.
//
// A clínica via 14 abas numa régua só, que quebrava linha e não dizia nada sobre o que era
// parecido com o quê. Pior: três delas ("Extrato", "Conciliação", "Contas & saldos") leem o
// mesmo `fin_transactions` com verbos diferentes, e ninguém adivinhava isso pelo nome.
//
// O primeiro nível é a PERGUNTA que a pessoa tem ("quanto entra", "quanto sai", "o que o banco
// diz", "está tudo certo?"); o segundo é a ferramenta. Nada sumiu — tudo virou sub-aba do grupo
// a que pertence, então quem já sabia o caminho continua chegando lá.
//
// Tela nova de financeiro = UMA entrada aqui. Ver [[crm_registro_navegacao_unico]]: antes esta
// lista morava dentro de EstoquePage, e uma tela de ESTOQUE ser dona do menu do FINANCEIRO era
// metade do motivo de ninguém achar nada.

export type FinanceTab = {
  to: string
  label: string
  polo?: 'clinica' | 'vendas'
  /**
   * Aba que quem NÃO é do financeiro também abre.
   *
   * É a cobrança da própria venda: quem vendeu a cirurgia precisa saber se ela
   * foi paga. Lê por RPC, mostra semáforo e não abre valor de conta a pagar,
   * extrato nem DRE — esses continuam só para o financeiro e a gerência.
   */
  semFinanceiro?: true
}
export type FinanceGroup = { id: string; label: string; tabs: FinanceTab[] }

/**
 * Os cinco grupos. A ordem é a do fluxo do dinheiro: entra → sai → o banco confirma →
 * confere → fecha o mês.
 */
export const FINANCE_GROUPS: FinanceGroup[] = [
  {
    id: 'receber',
    label: 'Receber',
    tabs: [
      { to: '/contas-a-receber', label: 'Contas a receber' },
      { to: '/importar-vendas', label: 'Importar vendas', polo: 'clinica' },
      { to: '/recebimentos', label: 'Recebimentos', polo: 'vendas' },
      // Já era de todo mundo no menu (rota sem cerca de financeiro); sem a marca,
      // quem abrisse a tela via a régua sem a aba da própria tela.
      { to: '/links-pagamento', label: 'Links de pagamento', semFinanceiro: true },
      { to: '/cupons', label: 'Cupons', polo: 'vendas' },
    ],
  },
  {
    id: 'pagar',
    label: 'Pagar',
    tabs: [
      { to: '/gastos', label: 'Tudo que saiu' },
      { to: '/contas-a-pagar', label: 'Contas a pagar' },
      { to: '/recorrentes', label: 'Recorrentes' },
      { to: '/importar-shop', label: 'Importar Shopee', polo: 'vendas' },
    ],
  },
  {
    id: 'banco',
    label: 'Banco',
    tabs: [
      { to: '/extrato', label: 'Extrato' },
      { to: '/conciliacao', label: 'Conciliação' },
      { to: '/conciliacao-shosp', label: 'Conciliação Shosp', polo: 'clinica' },
      { to: '/contas-caixa', label: 'Contas & saldos' },
    ],
  },
  {
    id: 'conferir',
    label: 'Conferir',
    tabs: [
      { to: '/cirurgia-paga', label: 'Cirurgia foi paga?', polo: 'clinica', semFinanceiro: true },
      { to: '/caixa-dinheiro', label: 'Caixa em dinheiro', polo: 'clinica' },
      { to: '/alertas-pagamento', label: 'Alertas de pagamento' },
    ],
  },
  {
    id: 'fechamento',
    label: 'Fechamento',
    tabs: [
      { to: '/dre', label: 'DRE' },
      { to: '/fluxo-caixa', label: 'Fluxo de caixa' },
      { to: '/financeiro-config', label: 'Configuração' },
      { to: '/nfe', label: 'Emissão de NF-e', polo: 'vendas' },
      { to: '/tricopill-relatorios', label: 'Relatórios', polo: 'vendas' },
    ],
  },
]

/** Em que grupo mora esta rota. Rota desconhecida cai no primeiro, que é melhor que sumir. */
export function grupoDaRota(pathname: string): FinanceGroup {
  const achado = FINANCE_GROUPS.find((g) => g.tabs.some((t) => t.to === pathname))
  return achado ?? FINANCE_GROUPS[0]
}


/**
 * Abas que esta pessoa enxerga neste polo. Aba sem `polo` aparece nos dois.
 *
 * `podeFinanceiro = false` deixa só as abas de cobrança da operação: sem isso, a
 * régua do financeiro mostrava dez atalhos para telas que a pessoa não abre.
 */
export const abasVisiveis = (tabs: FinanceTab[], isSalesPolo: boolean, podeFinanceiro = true) =>
  tabs.filter(
    (t) => (!t.polo || (t.polo === 'vendas') === isSalesPolo) && (podeFinanceiro || t.semFinanceiro),
  )
