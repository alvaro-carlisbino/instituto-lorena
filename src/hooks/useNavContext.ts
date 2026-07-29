import { useMemo } from 'react'

import type { NavContext } from '@/config/navigation'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'

/** Contexto de navegação (permissões + polo) montado uma vez e reusado pela sidebar, ⌘K e nav mobile. */
export function useNavContext(): NavContext {
  const crm = useCrm()
  const { tenant } = useTenant()
  const { canEditBoards, canRouteLeads, canManageUsers, canViewTvPanel } = crm.currentPermission

  return useMemo(
    () => ({
      permissions: { canEditBoards, canRouteLeads, canManageUsers, canViewTvPanel },
      isSalesPolo: tenant.poloType === 'sales',
    }),
    [canEditBoards, canRouteLeads, canManageUsers, canViewTvPanel, tenant.poloType],
  )
}
