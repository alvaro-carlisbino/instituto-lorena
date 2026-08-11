import {
  type LucideIcon,
  AlarmClock,
  ArrowLeftRight,
  Settings2,
  Banknote,
  HeartPulse,
  Bell,
  Bot,
  Boxes,
  Calendar,
  CalendarClock,
  CalendarRange,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  ClipboardPen,
  CreditCard,
  FileBarChart2,
  FileSpreadsheet,
  Fingerprint,
  FlaskConical,
  Gauge,
  HandCoins,
  History,
  Landmark,
  LayoutGrid,
  LineChart,
  List,
  ListChecks,
  MessagesSquare,
  Microscope,
  Monitor,
  PackageCheck,
  PackageOpen,
  Radio,
  Repeat,
  ScanBarcode,
  Send,
  Settings,
  Shield,
  ShoppingCart,
  SlidersHorizontal,
  SquareCheck,
  Star,
  Store,
  Target,
  Ticket,
  Scissors,
  TrendingUp,
  Tv,
  Unplug,
  UserSearch,
  Upload,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'

/**
 * FONTE ÚNICA DA NAVEGAÇÃO.
 *
 * Antes desta lista, a sidebar tinha 48 <NavItem> escritos à mão e a paleta ⌘K tinha
 * outros ~20, também à mão. As duas listas divergiram: a paleta ainda oferecia /visoes
 * (tela escondida na reorganização de julho) e chamava /tarefas de "Tarefas e NPS"
 * depois do NPS ter migrado para /feedback. Agora sidebar, ⌘K, favoritos, recentes e
 * a navegação do celular leem TODOS daqui — incluir uma tela nova é uma linha só.
 */

/** Permissões consultadas pela navegação (subconjunto de PermissionProfile). */
export type NavPermissions = {
  canEditBoards: boolean
  canRouteLeads: boolean
  canManageUsers: boolean
  canViewTvPanel: boolean
  /** Financeiro (extrato, contas, conciliação, fluxo de caixa) — só financeiro@/gerencia@. */
  canViewFinance: boolean
}

export type NavContext = {
  permissions: NavPermissions
  /** Polo de vendas (Tricopill) vs polo clínica — mostram operações diferentes. */
  isSalesPolo: boolean
}

export type NavGroupId =
  | 'inicio'
  | 'leads'
  | 'clinica'
  | 'vendas'
  | 'financeiro'
  | 'estoque'
  | 'relatorios'
  | 'equipe'
  | 'configuracao'
  | 'tv'
  | 'admin'

export type NavDestination = {
  id: string
  path: string
  label: string
  icon: LucideIcon
  group: NavGroupId
  /** Termos extras para a busca — como a equipe chama a tela no dia a dia. */
  keywords?: string[]
  /** Quem enxerga a tela. Ausente = todo mundo. */
  visible?: (ctx: NavContext) => boolean
  /**
   * Candidata à barra inferior do celular (as 4 primeiras visíveis entram, menor primeiro).
   * Aceita função porque uma tela comum aos dois polos pode ser central num e secundária
   * no outro — o funil é o dia a dia da clínica, mas em vendas quem manda é Pedidos.
   */
  mobilePriority?: number | ((ctx: NavContext) => number)
}

/** Prioridade de celular já resolvida para o polo atual (undefined = fora da barra). */
export function mobilePriorityFor(destination: NavDestination, ctx: NavContext): number | undefined {
  const { mobilePriority } = destination
  if (mobilePriority == null) return undefined
  return typeof mobilePriority === 'function' ? mobilePriority(ctx) : mobilePriority
}

export const NAV_GROUPS: { id: NavGroupId; label: string }[] = [
  { id: 'inicio', label: 'Início' },
  { id: 'leads', label: 'Leads' },
  { id: 'clinica', label: 'Clínica' },
  { id: 'vendas', label: 'Vendas' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'estoque', label: 'Estoque e compras' },
  { id: 'relatorios', label: 'Relatórios' },
  { id: 'equipe', label: 'Equipe (RH)' },
  { id: 'configuracao', label: 'Configuração' },
  { id: 'tv', label: 'TV' },
  { id: 'admin', label: 'Administração' },
]

const isClinic = (ctx: NavContext) => !ctx.isSalesPolo
const isSales = (ctx: NavContext) => ctx.isSalesPolo
const canRoute = (ctx: NavContext) => ctx.permissions.canRouteLeads
const canBoards = (ctx: NavContext) => ctx.permissions.canEditBoards
const canAdmin = (ctx: NavContext) => ctx.permissions.canManageUsers
// Financeiro é dado restrito: a RLS de fin_*/payable_installments já barra no banco, aqui
// é só pra não oferecer tela que voltaria vazia.
const canFinance = (ctx: NavContext) => ctx.permissions.canViewFinance

export const NAV_DESTINATIONS: NavDestination[] = [
  // ── Início
  {
    id: 'painel',
    path: '/dashboard',
    label: 'Painel',
    icon: TrendingUp,
    group: 'inicio',
    keywords: ['home', 'início', 'indicadores', 'kpi', 'dashboard'],
    mobilePriority: 1,
  },
  {
    id: 'assistente',
    path: '/assistente',
    label: 'Assistente IA',
    icon: Bot,
    group: 'inicio',
    keywords: ['ia', 'ai', 'perguntar', 'copilot', 'chatgpt'],
  },

  // ── Leads
  {
    id: 'kanban',
    path: '/kanban',
    label: 'Funil de leads',
    icon: LayoutGrid,
    group: 'leads',
    keywords: ['quadro', 'kanban', 'pipeline', 'etapas'],
    mobilePriority: (ctx) => (ctx.isSalesPolo ? 6 : 2),
  },
  {
    id: 'leads',
    path: '/leads',
    label: 'Todos os leads',
    icon: List,
    group: 'leads',
    keywords: ['lista', 'tabela', 'pacientes', 'clientes', 'importar', 'csv'],
    visible: canRoute,
  },
  {
    id: 'chat',
    path: '/chat',
    label: 'Chat comercial',
    icon: MessagesSquare,
    group: 'leads',
    keywords: ['conversas', 'whatsapp', 'mensagens', 'atendimento', 'instagram'],
    visible: (ctx) => canRoute(ctx) && isClinic(ctx),
    mobilePriority: 3,
  },
  {
    id: 'historico',
    path: '/historico',
    label: 'Histórico',
    icon: History,
    group: 'leads',
    keywords: ['linha do tempo', 'atividades', 'log'],
  },
  {
    id: 'tarefas',
    path: '/tarefas',
    label: 'Tarefas',
    icon: SquareCheck,
    group: 'leads',
    keywords: ['pendências', 'follow-up', 'to-do', 'afazeres'],
    visible: canRoute,
  },

  // ── Clínica
  {
    id: 'central-vendas',
    path: '/central-vendas',
    label: 'Central de Vendas',
    icon: ClipboardList,
    group: 'clinica',
    keywords: [
      'venda', 'aline', 'ingrid', 'follow-up', 'pós-consulta', 'cirurgia',
      'transplante', 'protocolo', 'spa', 'conferência', 'fechamento',
    ],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
    mobilePriority: 3,
  },
  {
    id: 'cirurgias-vinculo',
    path: '/cirurgias-vinculo',
    label: 'Cirurgias sem paciente',
    icon: Scissors,
    group: 'clinica',
    keywords: ['cirurgia', 'centro cirúrgico', 'vínculo', 'prontuário', 'folículos'],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
  },
  {
    id: 'tricoscopia',
    path: '/tricoscopia',
    label: 'Tricoscopia',
    icon: Microscope,
    group: 'clinica',
    keywords: ['hairmetrix', 'canfield', 'mirror', 'densidade', 'folículos', 'exame', 'couro cabeludo', 'miniaturização'],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
  },
  {
    id: 'agenda',
    path: '/agenda',
    label: 'Agenda',
    icon: Calendar,
    group: 'clinica',
    keywords: ['consultas', 'marcação', 'shosp', 'horários', 'sala'],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
    mobilePriority: 4,
  },
  {
    id: 'agenda-cirurgica',
    path: '/agenda/cirurgica',
    label: 'Agenda cirúrgica',
    icon: CalendarRange,
    group: 'clinica',
    keywords: ['cirurgia', 'centro cirúrgico', 'sala', 'bloco', 'transplante', 'calendário', 'mês'],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
  },
  {
    id: 'perfil',
    path: '/perfil',
    label: 'Ficha do paciente',
    icon: UserSearch,
    group: 'clinica',
    keywords: ['prontuário', 'notas clínicas', 'cadastro', 'paciente'],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
  },
  {
    id: 'protocolos',
    path: '/protocolos',
    label: 'Protocolos',
    icon: ListChecks,
    group: 'clinica',
    keywords: ['tratamento', 'sessões', 'capilar'],
    visible: (ctx) => isClinic(ctx) && canRoute(ctx),
  },

  // ── Vendas
  {
    id: 'bi-vendas',
    path: '/bi-vendas',
    label: 'Visão de vendas',
    icon: ChartColumn,
    group: 'vendas',
    keywords: ['bi', 'tricopill', 'faturamento', 'funil de vendas'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
    mobilePriority: 2,
  },
  {
    id: 'chat-vendas',
    path: '/tricopill',
    label: 'Chat de vendas',
    icon: MessagesSquare,
    group: 'vendas',
    keywords: ['conversas', 'whatsapp', 'bot', 'atendimento'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
    mobilePriority: 3,
  },
  {
    id: 'pedidos',
    path: '/pedidos',
    label: 'Pedidos',
    icon: PackageOpen,
    group: 'vendas',
    keywords: ['vendas', 'bling', 'envio', 'rastreio'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
    mobilePriority: 4,
  },
  {
    id: 'carrinhos',
    path: '/carrinhos-abandonados',
    label: 'Carrinhos abandonados',
    icon: ShoppingCart,
    group: 'vendas',
    keywords: ['recuperação', 'checkout', 'desistência'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
  },
  {
    id: 'assinaturas',
    path: '/assinaturas',
    label: 'Assinaturas',
    icon: Repeat,
    group: 'vendas',
    keywords: ['clube', 'recorrência', 'asaas'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
  },
  {
    id: 'frente-loja',
    path: '/frente-loja',
    label: 'Frente de loja',
    icon: Store,
    group: 'vendas',
    keywords: ['pdv', 'balcão', 'venda presencial', 'caixa'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
  },
  {
    id: 'reengajamento',
    path: '/reengajamento',
    label: 'Reengajamento',
    icon: Send,
    group: 'vendas',
    keywords: ['reativação', 'recompra', 'disparo'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
  },
  {
    id: 'loja-analytics',
    path: '/loja-analytics',
    label: 'Analytics do site',
    icon: LineChart,
    group: 'vendas',
    keywords: ['site', 'tráfego', 'conversão', 'storefront'],
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
  },

  // ── Financeiro
  {
    id: 'recebimentos',
    path: '/recebimentos',
    label: 'Recebimentos',
    icon: Wallet,
    group: 'financeiro',
    keywords: ['pagamentos', 'pix', 'cartão', 'entradas'],
    visible: (ctx) => canFinance(ctx) && isSales(ctx) && canRoute(ctx),
  },
  {
    id: 'contas-receber',
    path: '/contas-a-receber',
    label: 'Contas a receber',
    icon: HandCoins,
    group: 'financeiro',
    keywords: ['cobrança', 'inadimplência', 'a receber'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'contas-pagar',
    path: '/contas-a-pagar',
    label: 'Contas a pagar',
    icon: CalendarClock,
    group: 'financeiro',
    keywords: ['fornecedor', 'boleto', 'despesas', 'vencimento'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'gastos',
    path: '/gastos',
    label: 'Gastos e controle',
    icon: FileSpreadsheet,
    group: 'financeiro',
    keywords: ['despesas', 'custos', 'categorias'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'contas-caixa',
    path: '/contas-caixa',
    label: 'Contas & caixa',
    icon: Landmark,
    group: 'financeiro',
    keywords: ['banco', 'saldo', 'conta corrente'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'recorrentes',
    path: '/recorrentes',
    label: 'Recorrentes',
    icon: Repeat,
    group: 'financeiro',
    keywords: ['assinatura', 'mensalidade', 'fixo'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'conciliacao',
    path: '/conciliacao',
    label: 'Conciliação',
    icon: ArrowLeftRight,
    group: 'financeiro',
    keywords: ['extrato', 'bater', 'ofx', 'banco'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'dre',
    path: '/dre',
    label: 'DRE',
    icon: TrendingUp,
    group: 'financeiro',
    keywords: ['dre', 'resultado', 'lucro', 'margem', 'receita', 'despesa'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'financeiro-config',
    path: '/financeiro-config',
    label: 'Config. do financeiro',
    icon: Settings2,
    group: 'financeiro',
    keywords: ['centro de custo', 'categoria', 'regra', 'classificacao', 'configurar'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'extrato',
    path: '/extrato',
    label: 'Extrato',
    icon: Landmark,
    group: 'financeiro',
    keywords: ['extrato', 'banco', 'classificar', 'categoria', 'entrou', 'saiu', 'grafico'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'caixa-dinheiro',
    path: '/caixa-dinheiro',
    label: 'Caixa em dinheiro',
    icon: Banknote,
    group: 'financeiro',
    keywords: ['dinheiro', 'especie', 'sangria', 'deposito', 'gaveta', 'fechamento'],
    visible: (ctx) => canFinance(ctx) && isClinic(ctx) && canBoards(ctx),
  },
  {
    id: 'cirurgia-paga',
    path: '/cirurgia-paga',
    label: 'Cirurgia foi paga?',
    icon: HeartPulse,
    group: 'financeiro',
    keywords: ['cirurgia', 'transplante', 'pagou', 'pagamento', 'auditoria', 'sala'],
    visible: (ctx) => canFinance(ctx) && isClinic(ctx) && canBoards(ctx),
  },
  {
    id: 'conciliacao-shosp',
    path: '/conciliacao-shosp',
    label: 'Conciliação Shosp',
    icon: ArrowLeftRight,
    group: 'financeiro',
    keywords: ['shosp', 'vendas', 'extrato', 'banco', 'bater', 'divergencia'],
    visible: (ctx) => canFinance(ctx) && isClinic(ctx) && canBoards(ctx),
  },
  {
    id: 'importar-vendas',
    path: '/importar-vendas',
    label: 'Importar vendas',
    icon: Upload,
    group: 'financeiro',
    keywords: ['importar', 'shosp', 'planilha', 'recepcao', 'lion', 'entradas', 'receber', 'faturamento'],
    visible: (ctx) => canFinance(ctx) && isClinic(ctx) && canBoards(ctx),
  },
  {
    id: 'alertas-pagamento',
    path: '/alertas-pagamento',
    label: 'Alertas de pagamento',
    icon: Bell,
    group: 'financeiro',
    keywords: ['aviso', 'vencido', 'atraso'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'fluxo-caixa',
    path: '/fluxo-caixa',
    label: 'Fluxo de caixa',
    icon: TrendingUp,
    group: 'financeiro',
    keywords: ['projeção', 'saldo futuro', 'dre'],
    visible: (ctx) => canFinance(ctx) && canBoards(ctx),
  },
  {
    id: 'importar-shop',
    path: '/importar-shop',
    label: 'Importar Shopee',
    icon: FileSpreadsheet,
    group: 'financeiro',
    keywords: ['shopee', 'marketplace', 'planilha', 'importação', 'tricopill'],
    // Planilha de repasse da SHOPEE: é marketplace do Tricopill e vira conta a pagar de lá.
    // Sem `isSales` aparecia no menu da clínica, onde não existe Shopee nenhuma — e o rótulo
    // "Importar shop" não dizia nem de que loja era.
    visible: (ctx) => canFinance(ctx) && canBoards(ctx) && isSales(ctx),
  },
  {
    id: 'links-pagamento',
    path: '/links-pagamento',
    label: 'Links de pagamento',
    icon: CreditCard,
    group: 'financeiro',
    keywords: ['cobrar', 'link', 'checkout', 'pix'],
  },
  {
    id: 'cupons',
    path: '/cupons',
    label: 'Cupons',
    icon: Ticket,
    group: 'financeiro',
    keywords: ['desconto', 'promoção', 'voucher'],
    visible: (ctx) => isSales(ctx),
  },
  {
    id: 'relatorios-vendas-mes',
    path: '/tricopill-relatorios',
    label: 'Relatórios de vendas',
    icon: FileSpreadsheet,
    group: 'financeiro',
    keywords: ['mensal', 'faturamento', 'fechamento'],
    visible: (ctx) => isSales(ctx),
  },

  // ── Estoque e compras
  {
    id: 'estoque',
    path: '/estoque',
    label: 'Estoque',
    icon: Warehouse,
    group: 'estoque',
    keywords: ['produtos', 'saldo', 'almoxarifado'],
    visible: canBoards,
  },
  {
    id: 'bipagem',
    path: '/bipagem',
    label: 'Bipagem',
    icon: ScanBarcode,
    group: 'estoque',
    keywords: ['código de barras', 'leitor', 'baixa', 'scanner'],
    visible: canBoards,
  },
  {
    id: 'compras',
    path: '/compras',
    label: 'Ordens de compra',
    icon: ClipboardList,
    group: 'estoque',
    keywords: ['fornecedor', 'pedido de compra', 'reposição'],
    visible: canBoards,
  },
  {
    id: 'transferencias',
    path: '/transferencias-estoque',
    label: 'Transferências',
    icon: ArrowLeftRight,
    group: 'estoque',
    keywords: ['movimentação', 'entre depósitos'],
    visible: canBoards,
  },
  {
    id: 'inventario',
    path: '/inventario',
    label: 'Inventário',
    icon: ClipboardCheck,
    group: 'estoque',
    keywords: ['contagem', 'balanço', 'ajuste'],
    visible: canBoards,
  },
  {
    id: 'kits',
    path: '/kits',
    label: 'Kits cirúrgicos',
    icon: PackageCheck,
    group: 'estoque',
    keywords: ['cirurgia', 'montagem', 'material'],
    visible: (ctx) => isClinic(ctx) && canBoards(ctx),
  },
  {
    id: 'conta-cirurgica',
    path: '/conta-cirurgica',
    label: 'Conta cirúrgica',
    icon: FileBarChart2,
    group: 'estoque',
    keywords: ['custo', 'cirurgia', 'fechamento'],
    visible: (ctx) => isClinic(ctx) && canBoards(ctx),
  },
  {
    id: 'estoque-relatorios',
    path: '/estoque-relatorios',
    label: 'Relatórios de estoque',
    icon: FileBarChart2,
    group: 'estoque',
    keywords: ['giro', 'consumo', 'curva abc'],
    visible: canBoards,
  },
  {
    id: 'integracoes-clinica',
    path: '/integracoes-clinica',
    label: 'Meta4 / Enfermagem',
    icon: Unplug,
    group: 'estoque',
    keywords: ['integração', 'meta4', 'enfermagem'],
    visible: (ctx) => isClinic(ctx) && canBoards(ctx),
  },

  // ── Relatórios
  {
    id: 'resultados',
    path: '/resultados',
    label: 'Resultados',
    icon: ChartColumn,
    group: 'relatorios',
    keywords: ['comercial', 'funil', 'conversão', 'vendas'],
    visible: isClinic,
  },
  {
    id: 'analytics',
    path: '/analytics',
    label: 'Análise do funil',
    icon: Gauge,
    group: 'relatorios',
    keywords: ['etapas', 'gargalo', 'origem', 'atribuição'],
    visible: isClinic,
  },
  {
    id: 'feedback',
    path: '/feedback',
    label: 'Feedback e NPS',
    icon: Star,
    group: 'relatorios',
    keywords: ['pesquisa', 'satisfação', 'nota', 'avaliação'],
    visible: canRoute,
  },
  {
    id: 'metricas',
    path: '/metricas',
    label: 'Metas',
    icon: Target,
    group: 'relatorios',
    keywords: ['objetivo', 'meta mensal', 'acompanhamento'],
  },
  {
    id: 'relatorio-vendas-dia',
    path: '/relatorio-vendas',
    label: 'Relatório do dia',
    icon: FileSpreadsheet,
    group: 'relatorios',
    keywords: ['diário', 'fechamento do dia', 'vendas'],
    // SÓ vendas. Esta tela lê os gateways do Tricopill (Rede, PagBank, Asaas); a clínica
    // roda em Shosp e tem o CRM como dono do financeiro, então o número aqui não é dela.
    // Ficava visível nos dois polos por engano meu na reorganização da navegação.
    visible: (ctx) => isSales(ctx) && canRoute(ctx),
  },

  // ── Equipe (RH)
  {
    id: 'ponto',
    path: '/ponto',
    label: 'Meu ponto',
    icon: Fingerprint,
    group: 'equipe',
    keywords: ['bater ponto', 'entrada', 'saída', 'selfie'],
    visible: isClinic,
  },
  {
    id: 'rh-formularios',
    path: '/rh-formularios',
    label: 'Formulários RH',
    icon: ClipboardPen,
    group: 'equipe',
    keywords: ['férias', 'atestado', 'solicitação'],
    visible: isClinic,
  },
  {
    id: 'ponto-gestao',
    path: '/ponto-gestao',
    label: 'Gestão de ponto',
    icon: AlarmClock,
    group: 'equipe',
    keywords: ['folha', 'horas', 'banco de horas', 'equipe'],
    visible: (ctx) => isClinic(ctx) && canAdmin(ctx),
  },

  // ── Configuração
  {
    id: 'configuracoes',
    path: '/configuracoes',
    label: 'Configurações',
    icon: Settings,
    group: 'configuracao',
    keywords: ['ajustes', 'preferências', 'ia', 'automação'],
  },
  {
    id: 'config-funis',
    path: '/config-funis',
    label: 'Configurar funis',
    icon: Boxes,
    group: 'configuracao',
    keywords: ['etapas', 'pipeline', 'quadro', 'boards'],
    visible: canBoards,
  },
  {
    id: 'canais',
    path: '/canais',
    label: 'Canais',
    icon: Radio,
    group: 'configuracao',
    keywords: ['origem', 'whatsapp', 'instagram', 'meta'],
    visible: canRoute,
  },
  {
    id: 'admin-whatsapp',
    path: '/admin-whatsapp',
    label: 'Roteamento WhatsApp',
    icon: ArrowLeftRight,
    group: 'configuracao',
    keywords: ['evolution', 'qr code', 'instância', 'conexão'],
    visible: canAdmin,
  },
  {
    id: 'integracoes',
    path: '/integracoes',
    label: 'Integrações',
    icon: Unplug,
    group: 'configuracao',
    keywords: ['bling', 'asaas', 'shosp', 'melhor envio', 'api'],
    visible: canAdmin,
  },

  // ── TV
  {
    id: 'tv',
    path: '/tv',
    label: 'Tela TV',
    icon: Monitor,
    group: 'tv',
    keywords: ['painel da parede', 'mural'],
    visible: (ctx) => ctx.permissions.canViewTvPanel,
  },
  {
    id: 'tv-config',
    path: '/tv-config',
    label: 'Config. TV',
    icon: Tv,
    group: 'tv',
    keywords: ['ajustar tv', 'painel'],
    visible: (ctx) => ctx.permissions.canViewTvPanel,
  },

  // ── Administração
  {
    id: 'usuarios',
    path: '/usuarios',
    label: 'Usuários',
    icon: Users,
    group: 'admin',
    keywords: ['equipe', 'acesso', 'permissão', 'perfil'],
    visible: canAdmin,
  },
  {
    id: 'auditoria',
    path: '/auditoria',
    label: 'Auditoria',
    icon: Shield,
    group: 'admin',
    keywords: ['log', 'quem mexeu', 'histórico de alteração'],
    visible: canAdmin,
  },
  {
    id: 'admin-operacao',
    path: '/admin-operacao',
    label: 'Operação Admin',
    icon: SlidersHorizontal,
    group: 'admin',
    keywords: ['crons', 'filas', 'jobs', 'manutenção'],
    visible: canAdmin,
  },
  {
    id: 'admin-lab',
    path: '/admin-lab',
    label: 'Ferramentas de dev',
    icon: FlaskConical,
    group: 'admin',
    keywords: ['debug', 'teste', 'laboratório'],
    visible: canAdmin,
  },
]

/** Destinos que o usuário atual pode ver, na ordem dos grupos. */
export function visibleDestinations(ctx: NavContext): NavDestination[] {
  return NAV_DESTINATIONS.filter((d) => !d.visible || d.visible(ctx))
}

/** Agrupa os destinos visíveis preservando a ordem de NAV_GROUPS. */
export function groupedDestinations(ctx: NavContext) {
  const visible = visibleDestinations(ctx)
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: visible.filter((d) => d.group === group.id),
  })).filter((group) => group.items.length > 0)
}

/** Destino correspondente à rota atual (o path mais específico que casa). */
export function destinationForPath(pathname: string): NavDestination | undefined {
  return NAV_DESTINATIONS.filter(
    (d) => pathname === d.path || pathname.startsWith(`${d.path}/`),
  ).sort((a, b) => b.path.length - a.path.length)[0]
}

/**
 * UM item de menu aceso por vez, no menu lateral e no celular.
 *
 * Os dois lugares mediam "está ativo" com `pathname.startsWith(path + '/')`, cada um por
 * conta própria. Isso bastava enquanto nenhuma tela do menu morava dentro de outra — até
 * a Agenda cirúrgica nascer em /agenda/cirurgica e acender junto com Agenda, deixando o
 * menu dizendo que você está em dois lugares. Aqui a regra é a mesma de
 * destinationForPath: ganha o caminho mais específico.
 */
export function isDestinationActive(destination: NavDestination, pathname: string): boolean {
  return destinationForPath(pathname)?.id === destination.id
}

/**
 * Casa o texto digitado contra rótulo e apelidos, ignorando acento e caixa —
 * "pagamento" acha "Links de pagamento", "quadro" acha "Funil de leads".
 */
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

export function searchDestinations(query: string, ctx: NavContext): NavDestination[] {
  const term = normalize(query.trim())
  if (!term) return []
  const visible = visibleDestinations(ctx)
  const scored = visible
    .map((d) => {
      const label = normalize(d.label)
      const keywords = (d.keywords ?? []).map(normalize)
      if (label.startsWith(term)) return { d, score: 0 }
      if (label.includes(term)) return { d, score: 1 }
      if (keywords.some((k) => k.startsWith(term))) return { d, score: 2 }
      if (keywords.some((k) => k.includes(term))) return { d, score: 3 }
      return null
    })
    .filter((entry): entry is { d: NavDestination; score: number } => entry !== null)
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.d)
}
