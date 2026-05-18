import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

type NotifyKind = 'urgent' | 'handoff' | 'appointment' | 'info'

type NotifyInput = {
  leadId: string
  title: string
  body: string
  kind?: NotifyKind
  /** Quando definido, restringe os destinatários a estes papéis. Default: admin, gestor, sdr. */
  roles?: string[]
  /** Quando true, inclui o owner do lead mesmo que o papel não esteja na lista de roles. */
  includeOwner?: boolean
  metadata?: Record<string, unknown>
  /**
   * Quando definido, evita inserir uma notificação igual (mesmo leadId + mesma key) criada nos
   * últimos `dedupeWindowMinutes` minutos. Usado para evitar spam (ex.: várias mensagens seguidas).
   */
  dedupeKey?: string
  dedupeWindowMinutes?: number
  /**
   * tenant_id explícito. Quando omitido, restringimos os destinatários ao mesmo tenant do lead
   * (via lookup do `leads.tenant_id`). Edge functions multi-tenant aware passam isto direto.
   */
  tenantId?: string
}

const DEFAULT_ROLES = ['admin', 'gestor', 'sdr']

async function resolveOwnerAuthId(admin: SupabaseClient, leadId: string): Promise<string | null> {
  const { data: lead } = await admin
    .from('leads')
    .select('owner_id')
    .eq('id', leadId)
    .maybeSingle()
  const ownerId = (lead as { owner_id?: string | null } | null)?.owner_id
  if (!ownerId) return null
  const { data: owner } = await admin
    .from('app_users')
    .select('auth_user_id')
    .eq('id', ownerId)
    .maybeSingle()
  const authId = (owner as { auth_user_id?: string | null } | null)?.auth_user_id
  return typeof authId === 'string' && authId.length > 0 ? authId : null
}

async function resolveRoleAuthIds(
  admin: SupabaseClient,
  roles: string[],
  tenantId: string | null,
): Promise<string[]> {
  if (roles.length === 0) return []
  let query = admin.from('app_users').select('auth_user_id').in('role', roles)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data } = await query
  const list = (data ?? []) as Array<{ auth_user_id?: string | null }>
  return list
    .map((u) => u.auth_user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

async function resolveTenantFromLeadRow(admin: SupabaseClient, leadId: string): Promise<string | null> {
  const { data } = await admin.from('leads').select('tenant_id').eq('id', leadId).maybeSingle()
  const tid = (data as { tenant_id?: string | null } | null)?.tenant_id
  return typeof tid === 'string' && tid.length > 0 ? tid : null
}

async function alreadyNotifiedRecently(
  admin: SupabaseClient,
  authUserId: string,
  leadId: string,
  dedupeKey: string,
  windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const { data } = await admin
    .from('app_inbox_notifications')
    .select('id')
    .eq('auth_user_id', authUserId)
    .gte('created_at', since)
    .contains('metadata', { leadId, dedupeKey })
    .limit(1)
  return (data ?? []).length > 0
}

/**
 * Insere notificações in-app (app_inbox_notifications) para os agentes alvo (SDRs/Gestores/Admins
 * e opcionalmente o owner do lead). Disponível em qualquer Edge Function.
 *
 * Retorna a quantidade de notificações criadas. Erros não são lançados — eles são logados via
 * console.warn para não interromper o fluxo principal do webhook.
 */
export async function notifyAgents(admin: SupabaseClient, input: NotifyInput): Promise<number> {
  try {
    const roles = input.roles && input.roles.length > 0 ? input.roles : DEFAULT_ROLES
    // Sem tenant explícito, descobre via lead — só notifica usuários do mesmo tenant.
    const tenantId = input.tenantId ?? (await resolveTenantFromLeadRow(admin, input.leadId))
    const targets = new Set<string>(await resolveRoleAuthIds(admin, roles, tenantId))

    if (input.includeOwner) {
      const ownerAuthId = await resolveOwnerAuthId(admin, input.leadId)
      if (ownerAuthId) targets.add(ownerAuthId)
    }

    if (targets.size === 0) return 0

    const metadata: Record<string, unknown> = {
      ...(input.metadata ?? {}),
      leadId: input.leadId,
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    }

    let recipients = [...targets]

    if (input.dedupeKey && input.dedupeWindowMinutes && input.dedupeWindowMinutes > 0) {
      const filtered: string[] = []
      for (const authUserId of recipients) {
        const skip = await alreadyNotifiedRecently(
          admin,
          authUserId,
          input.leadId,
          input.dedupeKey,
          input.dedupeWindowMinutes,
        )
        if (!skip) filtered.push(authUserId)
      }
      recipients = filtered
    }

    if (recipients.length === 0) return 0

    const rows = recipients.map((auth_user_id) => ({
      auth_user_id,
      title: input.title,
      body: input.body,
      kind: input.kind ?? 'urgent',
      metadata,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    }))

    const { error } = await admin.from('app_inbox_notifications').insert(rows)
    if (error) {
      console.warn('[notifyAgents] insert error:', error.message)
      return 0
    }
    return rows.length
  } catch (e) {
    console.warn('[notifyAgents] unexpected error:', e instanceof Error ? e.message : String(e))
    return 0
  }
}
