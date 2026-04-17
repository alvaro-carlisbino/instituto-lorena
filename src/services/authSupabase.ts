import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

export type AuthProfile = {
  authUserId: string
  email: string
  displayName: string
  role: 'admin' | 'gestor' | 'sdr'
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

export const ensureAppProfile = async (session: Session): Promise<void> => {
  const client = assertSupabase()
  const payload = {
    auth_user_id: session.user.id,
    email: session.user.email ?? '',
    display_name: session.user.user_metadata?.name ?? session.user.email?.split('@')[0] ?? 'usuario',
    role: 'sdr',
  }

  const { error } = await client.from('app_profiles').upsert(payload, { onConflict: 'auth_user_id' })
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
    role: data.role,
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

  const { error } = await client.from('app_profiles').upsert(
    {
      auth_user_id: userId,
      email,
      display_name: payload.displayName,
      role: 'sdr',
    },
    { onConflict: 'auth_user_id' },
  )
  if (error) throw error
}
