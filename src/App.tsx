import { Navigate, Route, Routes } from 'react-router-dom'
import { CrmProvider } from './context/CrmContext'
import { useCrmState } from './hooks/useCrmState'
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
import './App.css'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/dashboard-config" element={<DashboardConfigPage />} />
      <Route path="/boards" element={<BoardsPage />} />
      <Route path="/kanban" element={<KanbanPage />} />
      <Route path="/historico" element={<HistoryPage />} />
      <Route path="/canais" element={<ChannelsPage />} />
      <Route path="/metricas" element={<MetricsPage />} />
      <Route path="/usuarios" element={<UsersPage />} />
      <Route path="/auditoria" element={<AuditPage />} />
      <Route path="/configuracoes" element={<SettingsPage />} />
      <Route path="/tv-config" element={<TvConfigPage />} />
      <Route path="/tv" element={<TvDashboardPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

function App() {
  const crmState = useCrmState()

  return (
    <CrmProvider value={crmState}>
      <AppRoutes />
    </CrmProvider>
  )
}

export default App
