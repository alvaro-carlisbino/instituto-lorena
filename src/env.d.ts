/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_APP_NAME?: string
  readonly VITE_APP_BADGE?: string
  readonly VITE_APP_LOGO_MONOGRAM?: string
  /** Segredo do webhook de ingestao (apenas homologacao / Admin Lab; nao commitar em producao publica) */
  readonly VITE_CRM_WEBHOOK_SECRET?: string
  /** Segredo do webhook Evolution (apenas homologacao / Admin Lab; nao commitar em producao publica) */
  readonly VITE_EVOLUTION_WEBHOOK_SECRET?: string
  /** Segredo do webhook ManyChat → CRM (Admin Lab; nao commitar em producao publica) */
  readonly VITE_MANYCHAT_CRM_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
