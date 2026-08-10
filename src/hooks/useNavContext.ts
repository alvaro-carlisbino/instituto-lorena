import { useMemo } from 'react'

import type { NavContext } from '@/config/navigation'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'

/** Contexto de navegação (permissões + polo) montado uma vez e reusado pela sidebar, ⌘K e nav mobile. */
export function useNavContext(): NavContext {
  const crm = useCrm()
  const { tenant, canViewFinance } = useTenant()
  const { canEditBoards, canRouteLeads, canManageUsers, canViewTvPanel } = crm.currentPermission

  return useMemo(
    () => ({
      // canViewFinance vem do banco (app_users.can_view_finance), não do papel: financeiro@
      // e gerencia@ têm; o resto da equipe não vê extrato, contas nem conciliação.
      permissions: { canEditBoards, canRouteLeads, canManageUsers, canViewTvPanel, canViewFinance },
      isSalesPolo: tenant.poloType === 'sales',
    }),
    [canEditBoards, canRouteLeads, canManageUsers, canViewTvPanel, canViewFinance, tenant.poloType],
  )
}
