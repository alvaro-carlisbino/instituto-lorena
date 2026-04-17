import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

export type AuthProfile = {
  authUserId: string
  email: string
  displayName: string
  role: 'admin' | 'gestor' | 'sdr'
}

const normalizeProfileRole = (raw: unknown): AuthProfile['role'] => {
  const r = String(raw ?? '').trim().toLowerCase()
  if (r === 'admin' || r === 'gestor' || r === 'sdr') return r
  return 'sdr'
}

const assertSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase nao configurado.')
  }
  return supabase
}

export const getCurrentSession = async (): Promise<Session | null> => {
  const client = assertSupabase()
  const { data, error } = await client.auth.getSession()
  if (error) throw error
  return data.session
}

export const signInWithEmail = async (email: string, password: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export const signUpWithEmail = async (email: string, password: string): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.auth.signUp({ email, password })
  if (error) throw error
}

export const signOutSession = async (): Promise<void> => {
  const client = assertSupabase()
  const { error } = await client.auth.signOut()
  if (error) throw error
}

export const onAuthStateChanged = (callback: (session: Session | null) => void) => {
  const client = assertSupabase()
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return data.subscription
}

/** Atualiza app_profiles.role para admin quando o e-mail está em VITE_FORCE_ADMIN_EMAILS (bootstrap). */
export const syncForcedAdminRole = async (session: Session, forcedEmails: string[]): Promise<void> => {
  if (!forcedEmails.length) return
  const email = session.user.email?.trim().toLowerCase()
  if (!email || !forcedEmails.includes(email)) return
  const client = assertSupabase()
  const { data, error: readErr } = await client
    .from('app_profiles')
    .select('role')
    .eq('auth_user_id', session.user.id)
    .maybeSingle()
  if (readErr) throw readErr
  if (!data || String(data.role).toLowerCase() === 'admin') return
  const { error } = await client.from('app_profiles').update({ role: 'admin' }).eq('auth_user_id', session.user.id)
  if (error) throw error
}

export const ensureAppProfile = async (session: Session): Promise<void> => {
  const client = assertSupabase()
  const userId = session.user.id

  const { data: existing, error: readError } = await client
    .from('app_profiles')
    .select('auth_user_id')
    .eq('auth_user_id', userId)
    .maybeSingle()
  if (readError) throw readError
  if (existing) return

  const payload = {
    auth_user_id: userId,
    email: session.user.email ?? '',
    display_name: session.user.user_metadata?.name ?? session.user.email?.split('@')[0] ?? 'usuario',
    role: 'sdr' as const,
  }

  const { error } = await client.from('app_profiles').insert(payload)
  if (error) throw error
}

export const getMyProfile = async (): Promise<AuthProfile | null> => {
  const client = assertSupabase()
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError) throw authError

  const userId = authData.user?.id
  if (!userId) return null

  const { data, error } = await client
    .from('app_profiles')
    .select('auth_user_id, email, display_name, role')
    .eq('auth_user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    authUserId: data.auth_user_id,
    email: data.email,
    displayName: data.display_name,
    role: normalizeProfileRole(data.role),
  }
}

export const updateMyProfile = async (payload: { displayName: string }): Promise<void> => {
  const client = assertSupabase()
  const { data: authData, error: authError } = await client.auth.getUser()
  if (authError) throw authError

  const userId = authData.user?.id
  const email = authData.user?.email
  if (!userId || !email) {
    throw new Error('Sessao invalida para atualizar perfil.')
  }

  const { error } = await client.from('app_profiles').update({ display_name: payload.displayName }).eq('auth_user_id', userId)
  if (error) throw error
}

export const inviteTeamMember = async (params: {
  email: string
  displayName: string
  role: 'admin' | 'gestor' | 'sdr'
}): Promise<void> => {
  const client = assertSupabase()
  const { error, data } = await client.functions.invoke('invite-user', { body: params })
  const bodyError =
    data && typeof data === 'object' && data !== null && 'error' in data
      ? String((data as { error: unknown }).error).trim()
      : ''
  if (error) {
    throw new Error(bodyError || error.message)
  }
  if (bodyError) {
    throw new Error(bodyError)
  }
}

export const provisionUserWithPassword = async (params: {
  email: string
  password: string
  displayName: string
  role: 'admin' | 'gestor' | 'sdr'
  appUserId?: string
}): Promise<void> => {
  const client = assertSupabase()
  const { error, data } = await client.functions.invoke('provision-user', { body: params })
  const bodyError =
    data && typeof data === 'object' && data !== null && 'error' in data
      ? String((data as { error: unknown }).error).trim()
      : ''
  if (error) {
    throw new Error(bodyError || error.message)
  }
  if (bodyError) {
    throw new Error(bodyError)
  }
}
