import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Primeiro de todos, e de propósito: lê o #access_token do link de convite antes
// que o cliente do Supabase consuma e limpe o hash da URL.
import './lib/authLinkFlow'
import { APP_DOCUMENT_TITLE } from './config/branding'
import { instalarRecuperacaoDeChunk } from './lib/chunkReload'
import './index.css'
import { RootApp } from './RootApp'
import { ehLandingDaClinica } from './lib/rotaPublica'

// A landing pública troca o título por conta própria; o do CRM diria "INTERNO".
if (!ehLandingDaClinica()) document.title = APP_DOCUMENT_TITLE

// Antes de montar: deploy no meio da sessão deixa o index.html apontando para chunks
// que não existem mais, e a tela abre em branco. Isto recarrega uma vez e resolve.
instalarRecuperacaoDeChunk()

/**
 * Caminho em que o app está montado. `import.meta.env.BASE_URL` é o `base` do Vite:
 * "/" na raiz, "/interno/" quando o CRM roda dentro da loja do Tricopill.
 * Sem barra final, que é o formato que o react-router espera no `basename`.
 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '')

// PWA service worker — só em produção e em browser real.
// Registrado a partir do BASE: em subcaminho, o escopo do SW não pode passar da pasta em
// que ele mora, e um SW de escopo errado serve chunk velho e abre a tela em branco.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).catch((err) => {
      console.warn('Service worker register failed:', err)
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE || undefined}>
      <RootApp />
    </BrowserRouter>
  </StrictMode>,
)
