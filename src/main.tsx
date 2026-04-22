import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { APP_DOCUMENT_TITLE } from './config/branding'
import './index.css'
import App from './App.tsx'

document.title = APP_DOCUMENT_TITLE

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
