import { Navigate, Route, Routes } from 'react-router-dom'
import { CrmProvider } from './context/CrmContext'
import { useCrmState } from './hooks/useCrmState'
import { getDataProviderMode } from './services/dataMode'
import { DashboardPage } from './pages/DashboardPage'
import { BoardsPage } from './pages/BoardsPage'
import { KanbanPage } from './pages/KanbanPage'
import { HistoryPage } from './pages/HistoryPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { MetricsPage } from './pages/MetricsPage'
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
import { CommandPalette } from './components/CommandPalette'
import { RouteTransition } from './components/RouteTransition'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard-config" element={<DashboardConfigPage />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/visoes" element={<DataViewsPage />} />
      <Route path="/kanban" element={<KanbanPage />} />
      <Route path="/historico" element={<HistoryPage />} />
      <Route path="/canais" element={<ChannelsPage />} />
      <Route path="/metricas" element={<MetricsPage />} />
      <Route path="/usuarios" element={<UsersPage />} />
      <Route path="/auditoria" element={<AuditPage />} />
      <Route path="/admin-lab" element={<AdminLabPage />} />
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
        isLoading={crmState.isLoading}
        notice={crmState.authNotice}
        onDisplayNameChange={crmState.setDisplayNameDraft}
        onComplete={() => void crmState.completeOnboarding()}
      />
    )
  }

  return (
    <CrmProvider value={crmState}>
      <CommandPalette />
      <RouteTransition>
        <AppRoutes />
      </RouteTransition>
    </CrmProvider>
  )
}

export default App
