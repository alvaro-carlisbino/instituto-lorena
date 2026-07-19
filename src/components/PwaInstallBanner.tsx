import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

const DISMISSED_KEY = 'pwa-install-dismissed-at'
const DISMISS_DAYS = 14

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function wasRecentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return false
    const ts = Number(raw)
    if (!Number.isFinite(ts)) return false
    return Date.now() - ts < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

/**
 * Banner discreto que pede pra instalar o CRM como PWA. Só aparece em browsers
 * que disparam `beforeinstallprompt` (Chrome/Edge desktop+Android). iOS Safari
 * não dispara — usuário precisa fazer manual via "Adicionar à tela inicial".
 */
export function PwaInstallBanner() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState<boolean>(false)

  useEffect(() => {
    if (wasRecentlyDismissed()) return
    const handler = (e: Event) => {
      e.preventDefault()
      setEvt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!visible || !evt) return null

  const handleInstall = async () => {
    try {
      await evt.prompt()
      const { outcome } = await evt.userChoice
      if (outcome === 'accepted') {
        setVisible(false)
        setEvt(null)
      }
    } catch {
      /* ignore */
    }
  }

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()))
    } catch {
      /* ignore */
    }
    setVisible(false)
  }

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur-md sm:bottom-4 sm:inset-x-auto sm:right-4">
      <Download className="size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Instalar o CRM no celular</p>
        <p className="text-[11px] text-muted-foreground">
          Acesso rápido, abre sem navegador. Cabe na tela inicial como um app.
        </p>
      </div>
      <Button size="sm" onClick={handleInstall}>
        Instalar
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Dispensar"
        className="shrink-0 text-muted-foreground"
        onClick={handleDismiss}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  )
}
