import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'

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
    role: 'admin',
  }

  const { error } = await client.from('app_profiles').upsert(payload, { onConflict: 'auth_user_id' })
  if (error) throw error
}
