import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { BRAND_FAVICON_URL } from './config/brandAssets'
import { APP_DOCUMENT_TITLE } from './config/branding'
import './index.css'
import App from './App.tsx'

document.title = APP_DOCUMENT_TITLE

const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']")
if (favicon) {
  favicon.href = BRAND_FAVICON_URL
  favicon.type = 'image/png'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
