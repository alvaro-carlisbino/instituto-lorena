import { Navigate, Route, Routes } from 'react-router-dom'
import { CrmProvider } from './context/CrmContext'
import { TenantProvider } from './context/TenantContext'
import { useCrmState } from './hooks/useCrmState'
import { getDataProviderMode } from './services/dataMode'
import { DashboardPage } from './pages/DashboardPage'
import { BoardsPage } from './pages/BoardsPage'
import { KanbanPage } from './pages/KanbanPage'
import { HistoryPage } from './pages/HistoryPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { MetricsPage } from './pages/MetricsPage'
import { AnalyticsPage } from './pages/AnalyticsPage'
import { FeedbackDashboardPage } from './pages/FeedbackDashboardPage'
import { ClinicalNotesPage } from './pages/ClinicalNotesPage'
import { ClientProfilePage } from './pages/ClientProfilePage'
import { MedicalRecordsPage } from './pages/MedicalRecordsPage'
import { BillingPage } from './pages/BillingPage'
import { PwaInstallBanner } from './components/PwaInstallBanner'
import { BillingGate } from './components/BillingGate'
import { DashboardConfigPage } from './pages/DashboardConfigPage'
import { SettingsPage } from './pages/SettingsPage'
import { TvDashboardPage } from './pages/TvDashboardPage'
import { UsersPage } from './pages/UsersPage'
import { TvConfigPage } from './pages/TvConfigPage'
import { AuditPage } from './pages/AuditPage'
import { AuthPage } from './pages/AuthPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { AdminLabPage } from './pages/AdminLabPage'
import { DataViewsPage } from './pages/DataViewsPage'
import { AssistantPage } from './pages/AssistantPage'
import { LeadsPage } from './pages/LeadsPage'
import { LeadDetailPage } from './pages/LeadDetailPage'
import { LeadShipPage } from './pages/LeadShipPage'
import { LeadSalePage } from './pages/LeadSalePage'
import { FrenteLojaPage } from './pages/FrenteLojaPage'
import { TasksPage } from './pages/TasksPage'
import { ChatWorkspacePage } from './pages/ChatWorkspacePage'
import { TricopilPage } from './pages/TricopilPage'
import { TricopilDashboardPage } from './pages/TricopilDashboardPage'
import { LojaTricopillPage } from './pages/LojaTricopillPage'
import { TricopillReengagePage } from './pages/TricopillReengagePage'
import { TricopilOrdersPage } from './pages/TricopilOrdersPage'
import { TricopilFinancePage } from './pages/TricopilFinancePage'
import { TricopilSubscriptionsPage } from './pages/TricopilSubscriptionsPage'
import { PaymentLinksPage } from './pages/PaymentLinksPage'
import { SalesReportPage } from './pages/SalesReportPage'
import { TricopilReportsPage } from './pages/TricopilReportsPage'
import { CouponsPage } from './pages/CouponsPage'
import { IntegrationsPage } from './pages/IntegrationsPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { AdminOperationsPage } from './pages/AdminOperationsPage'
import { TenantsAdminPage } from './pages/TenantsAdminPage'
import { WhatsappConnectionPage } from './pages/WhatsappConnectionPage'
import { AgendaPage } from './pages/AgendaPage'
import { EstoquePage } from './pages/EstoquePage'
import { ComprasPage } from './pages/ComprasPage'
import { ContasPagarPage } from './pages/ContasPagarPage'
import { KitsPage } from './pages/KitsPage'
import { InventarioPage } from './pages/InventarioPage'
import { EstoqueRelatoriosPage } from './pages/EstoqueRelatoriosPage'
import { ProtocolosPage } from './pages/ProtocolosPage'
import { PontoPage } from './pages/PontoPage'
import { PontoGestaoPage } from './pages/PontoGestaoPage'
import { FormulariosRhPage } from './pages/FormulariosRhPage'
import { CommandPalette } from './components/CommandPalette'
import { RouteTransition } from './components/RouteTransition'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar } from '@/layouts/AppSidebar'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard-config" element={<DashboardConfigPage />} />
      <Route path="/boards" element={<BoardsPage />} />
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
      <Route path="/compras" element={<ComprasPage />} />
      <Route path="/contas-a-pagar" element={<ContasPagarPage />} />
      <Route path="/kits" element={<KitsPage />} />
      <Route path="/inventario" element={<InventarioPage />} />
      <Route path="/estoque-relatorios" element={<EstoqueRelatoriosPage />} />
      <Route path="/protocolos" element={<ProtocolosPage />} />
      <Route path="/ponto" element={<PontoPage />} />
      <Route path="/ponto-gestao" element={<PontoGestaoPage />} />
      <Route path="/rh-formularios" element={<FormulariosRhPage />} />
      <Route path="/chat" element={<ChatWorkspacePage />} />
      <Route path="/tricopill" element={<TricopilPage />} />
      <Route path="/tricopill-bi" element={<TricopilDashboardPage />} />
      <Route path="/tricopill-loja" element={<LojaTricopillPage />} />
      <Route path="/tricopill-reengajamento" element={<TricopillReengagePage />} />
      <Route path="/tricopill-pedidos" element={<TricopilOrdersPage />} />
      <Route path="/tricopill-financeiro" element={<TricopilFinancePage />} />
      <Route path="/tricopill-assinaturas" element={<TricopilSubscriptionsPage />} />
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
  )
}

function App() {
  const crmState = useCrmState()
  const dataMode = getDataProviderMode()

  // Checkout de cartão (e.Rede) é PÚBLICO — fora do gate de login/onboarding.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/pagar/')) {
    return (
      <Routes>
        <Route path="/pagar/:id" element={<CheckoutPage />} />
      </Routes>
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
