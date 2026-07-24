import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { CrmProvider } from './context/CrmContext'
import { TenantProvider } from './context/TenantContext'
import { useCrmState } from './hooks/useCrmState'
import { getDataProviderMode } from './services/dataMode'
import { AuthPage } from './pages/AuthPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { PwaInstallBanner } from './components/PwaInstallBanner'
import { BillingGate } from './components/BillingGate'
import { CommandPalette } from './components/CommandPalette'
import { RouteTransition } from './components/RouteTransition'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar } from '@/layouts/AppSidebar'

// ── Code-splitting: cada página vira um chunk próprio, baixado só quando a rota abre.
// (Antes: 57 páginas num bundle único de 2,2MB — o painel inteiro carregava no login,
// e até o cliente do /pagar baixava o CRM todo pra pagar.)
// As páginas usam named export; o lazy() exige default → adaptamos no .then().
function lazyPage<K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => loader().then((m) => ({ default: m[name] })))
}

const DashboardPage = lazyPage(() => import('./pages/DashboardPage'), 'DashboardPage')
const BoardsPage = lazyPage(() => import('./pages/BoardsPage'), 'BoardsPage')
const KanbanPage = lazyPage(() => import('./pages/KanbanPage'), 'KanbanPage')
const HistoryPage = lazyPage(() => import('./pages/HistoryPage'), 'HistoryPage')
const ChannelsPage = lazyPage(() => import('./pages/ChannelsPage'), 'ChannelsPage')
const MetricsPage = lazyPage(() => import('./pages/MetricsPage'), 'MetricsPage')
const AnalyticsPage = lazyPage(() => import('./pages/AnalyticsPage'), 'AnalyticsPage')
const FeedbackDashboardPage = lazyPage(() => import('./pages/FeedbackDashboardPage'), 'FeedbackDashboardPage')
const ClinicalNotesPage = lazyPage(() => import('./pages/ClinicalNotesPage'), 'ClinicalNotesPage')
const ClientProfilePage = lazyPage(() => import('./pages/ClientProfilePage'), 'ClientProfilePage')
const MedicalRecordsPage = lazyPage(() => import('./pages/MedicalRecordsPage'), 'MedicalRecordsPage')
const BillingPage = lazyPage(() => import('./pages/BillingPage'), 'BillingPage')
const DashboardConfigPage = lazyPage(() => import('./pages/DashboardConfigPage'), 'DashboardConfigPage')
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage')
const TvDashboardPage = lazyPage(() => import('./pages/TvDashboardPage'), 'TvDashboardPage')
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage')
const TvConfigPage = lazyPage(() => import('./pages/TvConfigPage'), 'TvConfigPage')
const AuditPage = lazyPage(() => import('./pages/AuditPage'), 'AuditPage')
const AdminLabPage = lazyPage(() => import('./pages/AdminLabPage'), 'AdminLabPage')
const DataViewsPage = lazyPage(() => import('./pages/DataViewsPage'), 'DataViewsPage')
const AssistantPage = lazyPage(() => import('./pages/AssistantPage'), 'AssistantPage')
const LeadsPage = lazyPage(() => import('./pages/LeadsPage'), 'LeadsPage')
const LeadDetailPage = lazyPage(() => import('./pages/LeadDetailPage'), 'LeadDetailPage')
const LeadShipPage = lazyPage(() => import('./pages/LeadShipPage'), 'LeadShipPage')
const LeadSalePage = lazyPage(() => import('./pages/LeadSalePage'), 'LeadSalePage')
const FrenteLojaPage = lazyPage(() => import('./pages/FrenteLojaPage'), 'FrenteLojaPage')
const TasksPage = lazyPage(() => import('./pages/TasksPage'), 'TasksPage')
const ChatWorkspacePage = lazyPage(() => import('./pages/ChatWorkspacePage'), 'ChatWorkspacePage')
const TricopilPage = lazyPage(() => import('./pages/TricopilPage'), 'TricopilPage')
const TricopilDashboardPage = lazyPage(() => import('./pages/TricopilDashboardPage'), 'TricopilDashboardPage')
const LojaTricopillPage = lazyPage(() => import('./pages/LojaTricopillPage'), 'LojaTricopillPage')
const TricopillReengagePage = lazyPage(() => import('./pages/TricopillReengagePage'), 'TricopillReengagePage')
const TricopilOrdersPage = lazyPage(() => import('./pages/TricopilOrdersPage'), 'TricopilOrdersPage')
const CarrinhosAbandonadosPage = lazyPage(() => import('./pages/CarrinhosAbandonadosPage'), 'CarrinhosAbandonadosPage')
const TricopilFinancePage = lazyPage(() => import('./pages/TricopilFinancePage'), 'TricopilFinancePage')
const TricopilSubscriptionsPage = lazyPage(() => import('./pages/TricopilSubscriptionsPage'), 'TricopilSubscriptionsPage')
const PaymentLinksPage = lazyPage(() => import('./pages/PaymentLinksPage'), 'PaymentLinksPage')
const SalesReportPage = lazyPage(() => import('./pages/SalesReportPage'), 'SalesReportPage')
const TricopilReportsPage = lazyPage(() => import('./pages/TricopilReportsPage'), 'TricopilReportsPage')
const CouponsPage = lazyPage(() => import('./pages/CouponsPage'), 'CouponsPage')
const IntegrationsPage = lazyPage(() => import('./pages/IntegrationsPage'), 'IntegrationsPage')
const CheckoutPage = lazyPage(() => import('./pages/CheckoutPage'), 'CheckoutPage')
const AdminOperationsPage = lazyPage(() => import('./pages/AdminOperationsPage'), 'AdminOperationsPage')
const TenantsAdminPage = lazyPage(() => import('./pages/TenantsAdminPage'), 'TenantsAdminPage')
const WhatsappConnectionPage = lazyPage(() => import('./pages/WhatsappConnectionPage'), 'WhatsappConnectionPage')
const AgendaPage = lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage')
const EstoquePage = lazyPage(() => import('./pages/EstoquePage'), 'EstoquePage')
const BipagemPage = lazyPage(() => import('./pages/BipagemPage'), 'BipagemPage')
const ComprasPage = lazyPage(() => import('./pages/ComprasPage'), 'ComprasPage')
const ContasPagarPage = lazyPage(() => import('./pages/ContasPagarPage'), 'ContasPagarPage')
const GastosControlePage = lazyPage(() => import('./pages/GastosControlePage'), 'GastosControlePage')
const ContasReceberPage = lazyPage(() => import('./pages/ContasReceberPage'), 'ContasReceberPage')
const FinAccountsPage = lazyPage(() => import('./pages/FinAccountsPage'), 'FinAccountsPage')
const ConciliacaoPage = lazyPage(() => import('./pages/ConciliacaoPage'), 'ConciliacaoPage')
const FluxoCaixaPage = lazyPage(() => import('./pages/FluxoCaixaPage'), 'FluxoCaixaPage')
const RecorrentesPage = lazyPage(() => import('./pages/RecorrentesPage'), 'RecorrentesPage')
const NfePage = lazyPage(() => import('./pages/NfePage'), 'NfePage')
const KitsPage = lazyPage(() => import('./pages/KitsPage'), 'KitsPage')
const InventarioPage = lazyPage(() => import('./pages/InventarioPage'), 'InventarioPage')
const EstoqueRelatoriosPage = lazyPage(() => import('./pages/EstoqueRelatoriosPage'), 'EstoqueRelatoriosPage')
const TransferenciasEstoquePage = lazyPage(() => import('./pages/TransferenciasEstoquePage'), 'TransferenciasEstoquePage')
const ContaCirurgicaPage = lazyPage(() => import('./pages/ContaCirurgicaPage'), 'ContaCirurgicaPage')
const AlertasPagamentoPage = lazyPage(() => import('./pages/AlertasPagamentoPage'), 'AlertasPagamentoPage')
const ImportShopPage = lazyPage(() => import('./pages/ImportShopPage'), 'ImportShopPage')
const IntegracoesClinicaPage = lazyPage(() => import('./pages/IntegracoesClinicaPage'), 'IntegracoesClinicaPage')
const ProtocolosPage = lazyPage(() => import('./pages/ProtocolosPage'), 'ProtocolosPage')
const PontoPage = lazyPage(() => import('./pages/PontoPage'), 'PontoPage')
const PontoGestaoPage = lazyPage(() => import('./pages/PontoGestaoPage'), 'PontoGestaoPage')
const FormulariosRhPage = lazyPage(() => import('./pages/FormulariosRhPage'), 'FormulariosRhPage')

/** Fallback leve enquanto o chunk da rota baixa (geralmente <300ms em banda normal). */
function RouteFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" aria-label="Carregando…" />
    </div>
  )
}

function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard-config" element={<DashboardConfigPage />} />
        <Route path="/config-funis" element={<BoardsPage />} />
        <Route path="/boards" element={<Navigate to="/config-funis" replace />} />
        <Route path="/visoes" element={<DataViewsPage />} />
        <Route path="/kanban" element={<KanbanPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/leads/:leadId" element={<LeadDetailPage />} />
        <Route path="/leads/:leadId/envio" element={<LeadShipPage />} />
        <Route path="/leads/:leadId/venda" element={<LeadSalePage />} />
        <Route path="/frente-loja" element={<FrenteLojaPage />} />
        <Route path="/tarefas" element={<TasksPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/estoque" element={<EstoquePage />} />
        <Route path="/bipagem" element={<BipagemPage />} />
        <Route path="/compras" element={<ComprasPage />} />
        <Route path="/contas-a-pagar" element={<ContasPagarPage />} />
        <Route path="/gastos" element={<GastosControlePage />} />
        <Route path="/contas-a-receber" element={<ContasReceberPage />} />
        <Route path="/contas-caixa" element={<FinAccountsPage />} />
        <Route path="/conciliacao" element={<ConciliacaoPage />} />
        <Route path="/fluxo-caixa" element={<FluxoCaixaPage />} />
        <Route path="/recorrentes" element={<RecorrentesPage />} />
        <Route path="/nfe" element={<NfePage />} />
        <Route path="/kits" element={<KitsPage />} />
        <Route path="/inventario" element={<InventarioPage />} />
        <Route path="/estoque-relatorios" element={<EstoqueRelatoriosPage />} />
        <Route path="/transferencias-estoque" element={<TransferenciasEstoquePage />} />
        <Route path="/conta-cirurgica" element={<ContaCirurgicaPage />} />
        <Route path="/alertas-pagamento" element={<AlertasPagamentoPage />} />
        <Route path="/importar-shop" element={<ImportShopPage />} />
        <Route path="/integracoes-clinica" element={<IntegracoesClinicaPage />} />
        <Route path="/protocolos" element={<ProtocolosPage />} />
        <Route path="/ponto" element={<PontoPage />} />
        <Route path="/ponto-gestao" element={<PontoGestaoPage />} />
        <Route path="/rh-formularios" element={<FormulariosRhPage />} />
        <Route path="/chat" element={<ChatWorkspacePage />} />
        <Route path="/tricopill" element={<TricopilPage />} />
        {/* Rotas novas (sem prefixo tricopill-); as antigas viram redirect pra não
            quebrar bookmarks, deep-links do chat e fluxos do ManyChat. */}
        <Route path="/bi-vendas" element={<TricopilDashboardPage />} />
        <Route path="/tricopill-bi" element={<Navigate to="/bi-vendas" replace />} />
        <Route path="/loja-analytics" element={<LojaTricopillPage />} />
        <Route path="/tricopill-loja" element={<Navigate to="/loja-analytics" replace />} />
        <Route path="/reengajamento" element={<TricopillReengagePage />} />
        <Route path="/tricopill-reengajamento" element={<Navigate to="/reengajamento" replace />} />
        <Route path="/pedidos" element={<TricopilOrdersPage />} />
        <Route path="/carrinhos-abandonados" element={<CarrinhosAbandonadosPage />} />
        <Route path="/tricopill-pedidos" element={<Navigate to="/pedidos" replace />} />
        <Route path="/recebimentos" element={<TricopilFinancePage />} />
        <Route path="/tricopill-financeiro" element={<Navigate to="/recebimentos" replace />} />
        <Route path="/assinaturas" element={<TricopilSubscriptionsPage />} />
        <Route path="/tricopill-assinaturas" element={<Navigate to="/assinaturas" replace />} />
        <Route path="/links-pagamento" element={<PaymentLinksPage />} />
        <Route path="/relatorio-vendas" element={<SalesReportPage />} />
        <Route path="/tricopill-relatorios" element={<TricopilReportsPage />} />
        <Route path="/cupons" element={<CouponsPage />} />
        <Route path="/integracoes" element={<IntegrationsPage />} />
        <Route path="/assistente" element={<AssistantPage />} />
        <Route path="/historico" element={<HistoryPage />} />
        <Route path="/canais" element={<ChannelsPage />} />
        <Route path="/metricas" element={<MetricsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/feedback" element={<FeedbackDashboardPage />} />
        <Route path="/notas-clinicas" element={<ClinicalNotesPage />} />
        <Route path="/perfil" element={<ClientProfilePage />} />
        <Route path="/prontuario" element={<MedicalRecordsPage />} />
        <Route path="/planos" element={<BillingPage />} />
        <Route path="/usuarios" element={<UsersPage />} />
        <Route path="/auditoria" element={<AuditPage />} />
        <Route path="/admin-lab" element={<AdminLabPage />} />
        <Route path="/admin-operacao" element={<AdminOperationsPage />} />
        <Route path="/admin-clinicas" element={<TenantsAdminPage />} />
        <Route path="/admin-whatsapp" element={<WhatsappConnectionPage />} />
        <Route path="/configuracoes" element={<SettingsPage />} />
        <Route path="/tv-config" element={<TvConfigPage />} />
        <Route path="/tv" element={<TvDashboardPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  const crmState = useCrmState()
  const dataMode = getDataProviderMode()

  // Checkout de cartão (e.Rede) é PÚBLICO — fora do gate de login/onboarding.
  // Com o code-splitting, o cliente baixa SÓ o chunk do checkout (não o CRM inteiro).
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/pagar/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/pagar/:id" element={<CheckoutPage />} />
        </Routes>
      </Suspense>
    )
  }

  if (dataMode === 'supabase' && !crmState.session) {
    return (
      <AuthPage
        email={crmState.authEmail}
        password={crmState.authPassword}
        isLoading={crmState.isLoading}
        notice={crmState.authNotice}
        onEmailChange={crmState.setAuthEmail}
        onPasswordChange={crmState.setAuthPassword}
        onSignIn={() => void crmState.runSignIn()}
        onSignUp={() => void crmState.runSignUp()}
      />
    )
  }

  if (dataMode === 'supabase' && crmState.session && !crmState.onboardingDone) {
    return (
      <OnboardingPage
        displayName={crmState.displayNameDraft}
        clinicName={crmState.onboardingClinicName}
        primaryColor={crmState.onboardingPrimaryColor}
        isLoading={crmState.isLoading}
        notice={crmState.authNotice}
        onDisplayNameChange={crmState.setDisplayNameDraft}
        onClinicNameChange={crmState.setOnboardingClinicName}
        onPrimaryColorChange={crmState.setOnboardingPrimaryColor}
        onComplete={() => void crmState.completeOnboarding()}
      />
    )
  }

  return (
    <TenantProvider>
      <CrmProvider value={crmState}>
        <a href="#main-content" className="skip-link">
          Pular para o conteúdo principal
        </a>
        <BillingGate>
          <TooltipProvider delay={200}>
            <SidebarProvider>
              <AppSidebar />
              <CommandPalette />
              <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <RouteTransition>
                  <AppRoutes />
                </RouteTransition>
              </div>
            </SidebarProvider>
          </TooltipProvider>
        </BillingGate>
        <Toaster richColors position="top-right" />
        <PwaInstallBanner />
      </CrmProvider>
    </TenantProvider>
  )
}

export default App
