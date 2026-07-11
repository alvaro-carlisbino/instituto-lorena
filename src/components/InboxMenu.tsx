import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getDataProviderMode } from '@/services/dataMode'
import { isSupabaseConfigured, supabase } from '@/lib/supabaseClient'
import { fetchInboxForCurrentUser, markInboxItemRead } from '@/services/appInbox'
import type { AppInboxItem } from '@/mocks/crmMock'
import { cn } from '@/lib/utils'

const URGENT_KINDS = new Set(['urgent', 'handoff'])
const BROWSER_NOTIF_PROMPT_KEY = 'inbox.browserNotifPrompted.v1'

function ensureBrowserNotificationPermission() {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'default') return
  // Pede só uma vez por instalação. Se o utilizador disser não, respeitamos para sempre.
  try {
    if (window.localStorage.getItem(BROWSER_NOTIF_PROMPT_KEY) === '1') return
    window.localStorage.setItem(BROWSER_NOTIF_PROMPT_KEY, '1')
  } catch {
    // localStorage indisponível em modo privado — segue mesmo assim
  }
  void Notification.requestPermission().catch(() => {})
}

function showBrowserNotification(title: string, body: string, leadId: string | null) {
  if (typeof window === 'undefined') return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  // Só mostra quando a aba está em background — caso contrário o toast + chime são suficientes.
  if (document.visibilityState === 'visible') return
  try {
    const n = new Notification(title, {
      body,
      tag: leadId ? `lead-${leadId}` : 'inbox',
    })
    n.onclick = () => {
      try {
        window.focus()
        if (leadId) {
          window.location.assign(`/chat?leadId=${encodeURIComponent(leadId)}`)
        }
      } catch {
        /* ignore */
      }
      n.close()
    }
  } catch {
    /* permissões/ambiente sem suporte — ignora */
  }
}

function playInboxChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const tones = [880, 1175]
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.18
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.3)
    })
    setTimeout(() => { void ctx.close() }, 900)
  } catch {
    // áudio bloqueado pelo browser antes de qualquer interação — ignora
  }
}

export function InboxMenu() {
  const navigate = useNavigate()
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured
  const [items, setItems] = useState<AppInboxItem[]>([])
  const [open, setOpen] = useState(false)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const initialLoadedRef = useRef(false)

  const refreshItems = useCallback(async (): Promise<AppInboxItem[]> => {
    if (!online) return []
    try {
      const list = await fetchInboxForCurrentUser(25)
      setItems(list)
      return list
    } catch {
      return []
    }
  }, [online])

  const load = useCallback(() => {
    void refreshItems()
  }, [refreshItems])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  useEffect(() => {
    if (!online) return
    ensureBrowserNotificationPermission()
    void refreshItems().then((list) => {
      seenIdsRef.current = new Set(list.map((i) => i.id))
      initialLoadedRef.current = true
    })
  }, [online, refreshItems])

  useEffect(() => {
    if (!online) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshItems()
    }, 60_000)
    return () => window.clearInterval(id)
  }, [online, refreshItems])

  useEffect(() => {
    if (!online || !supabase) return
    const channel = supabase
      .channel('app-inbox-notifications-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'app_inbox_notifications' },
        () => {
          void refreshItems().then((list) => {
            if (!initialLoadedRef.current) {
              seenIdsRef.current = new Set(list.map((i) => i.id))
              initialLoadedRef.current = true
              return
            }
            const fresh = list.filter((i) => !seenIdsRef.current.has(i.id))
            if (fresh.length === 0) return
            fresh.forEach((i) => seenIdsRef.current.add(i.id))
            const urgent = fresh.find((i) => URGENT_KINDS.has(i.kind))
            if (urgent) {
              playInboxChime()
              const leadId = typeof urgent.metadata?.leadId === 'string' ? urgent.metadata.leadId : null
              showBrowserNotification(urgent.title, urgent.body, leadId)
              toast(urgent.title, {
                description: urgent.body,
                duration: 12_000,
                action: leadId
                  ? {
                      label: 'Abrir lead',
                      onClick: () => {
                        navigate(`/chat?leadId=${encodeURIComponent(leadId)}`)
                        void markInboxItemRead(urgent.id).then(load)
                      },
                    }
                  : undefined,
              })
            }
          })
        },
      )
      .subscribe()
    return () => {
      void supabase!.removeChannel(channel)
    }
  }, [online, refreshItems, load, navigate])

  const unread = items.filter((i) => !i.readAt).length
  const urgentUnread = items.some((i) => !i.readAt && URGENT_KINDS.has(i.kind))

  if (!online) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'relative inline-flex size-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent',
          urgentUnread && 'animate-pulse',
        )}
        aria-label="Notificações"
      >
        <Bell className={cn('h-4 w-4', urgentUnread && 'text-red-500')} />
        {unread > 0 ? (
          <span
            className={cn(
              'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-0.5 text-[10px] font-bold',
              urgentUnread
                ? 'bg-red-500 text-white ring-2 ring-red-500/40'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-[min(24rem,70vh)] overflow-y-auto">
        <DropdownMenuLabel>Caixa de entrada</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">Sem notificações.</div>
        ) : (
          items.map((i) => {
            const isUrgent = URGENT_KINDS.has(i.kind)
            const leadId = typeof i.metadata?.leadId === 'string' ? i.metadata.leadId : null
            // Notificações sem lead (ex.: alertas de estoque) podem levar a uma rota interna.
            const route = !leadId && typeof i.metadata?.route === 'string' ? i.metadata.route : null
            return (
              <DropdownMenuItem
                key={i.id}
                className={cn(
                  'flex cursor-default flex-col items-stretch gap-0.5 whitespace-normal',
                  isUrgent && !i.readAt && 'bg-red-500/5',
                )}
                onSelect={(e) => e.preventDefault()}
              >
                <span className={cn('text-xs font-medium', isUrgent && !i.readAt && 'text-red-600')}>
                  {i.title}
                </span>
                <span className="text-xs text-muted-foreground">{i.body}</span>
                <div className="flex items-center gap-2">
                  {leadId ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setOpen(false)
                        navigate(`/chat?leadId=${encodeURIComponent(leadId)}`)
                        if (!i.readAt) void markInboxItemRead(i.id).then(load)
                      }}
                    >
                      Atender
                    </Button>
                  ) : null}
                  {route ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        setOpen(false)
                        navigate(route)
                        if (!i.readAt) void markInboxItemRead(i.id).then(load)
                      }}
                    >
                      Ver
                    </Button>
                  ) : null}
                  {!i.readAt ? (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-xs"
                      onClick={() => {
                        void markInboxItemRead(i.id).then(load)
                      }}
                    >
                      Marcar lida
                    </Button>
                  ) : null}
                </div>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
