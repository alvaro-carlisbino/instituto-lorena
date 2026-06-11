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
import { TasksPage } from './pages/TasksPage'
import { ChatWorkspacePage } from './pages/ChatWorkspacePage'
import { TricopilPage } from './pages/TricopilPage'
import { PaymentLinksPage } from './pages/PaymentLinksPage'
import { IntegrationsPage } from './pages/IntegrationsPage'
import { AdminOperationsPage } from './pages/AdminOperationsPage'
import { TenantsAdminPage } from './pages/TenantsAdminPage'
import { WhatsappConnectionPage } from './pages/WhatsappConnectionPage'
import { AgendaPage } from './pages/AgendaPage'
import { CommandPalette } from './components/CommandPalette'
import { RouteTransition } from './components/RouteTransition'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppSidebar } from '@/layouts/AppSidebar'
import { TopNav } from '@/layouts/TopNav'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard-config" element={<DashboardConfigPage />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/visoes" element={<DataViewsPage />} />
      <Route path="/kanban" element={<KanbanPage />} />
      <Route path="/leads" element={<LeadsPage />} />
      <Route path="/tarefas" element={<TasksPage />} />
      <Route path="/agenda" element={<AgendaPage />} />
      <Route path="/chat" element={<ChatWorkspacePage />} />
      <Route path="/tricopill" element={<TricopilPage />} />
      <Route path="/links-pagamento" element={<PaymentLinksPage />} />
      <Route path="/integracoes" element={<IntegrationsPage />} />
      <Route path="/assistente" element={<AssistantPage />} />
      <Route path="/historico" element={<HistoryPage />} />
      <Route path="/canais" element={<ChannelsPage />} />
      <Route path="/metricas" element={<MetricsPage />} />
      <Route path="/analytics" element={<AnalyticsPage />} />
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
                <div className="shrink-0 md:hidden">
                  <TopNav />
                </div>
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
