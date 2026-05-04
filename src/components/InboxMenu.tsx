import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'

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
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import { fetchInboxForCurrentUser, markInboxItemRead } from '@/services/appInbox'
import type { AppInboxItem } from '@/mocks/crmMock'

export function InboxMenu() {
  const dataMode = getDataProviderMode()
  const online = dataMode === 'supabase' && isSupabaseConfigured
  const [items, setItems] = useState<AppInboxItem[]>([])
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    if (!online) return
    void fetchInboxForCurrentUser(25)
      .then(setItems)
      .catch(() => {
        // tabela pode não existir antes da migração
      })
  }, [online])

  useEffect(() => {
    if (open) {
      load()
    }
  }, [open, load])

  useEffect(() => {
    if (!online) return
    void load()
  }, [online, load])

  useEffect(() => {
    if (!online) return
    const id = window.setInterval(() => {
      void fetchInboxForCurrentUser(25)
        .then(setItems)
        .catch(() => {
          /* ignore */
        })
    }, 30_000)
    return () => window.clearInterval(id)
  }, [online])

  const unread = items.filter((i) => !i.readAt).length

  if (!online) return null

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="relative inline-flex size-9 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent"
        aria-label="Notificações"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[10px] font-bold text-primary-foreground">
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
          items.map((i) => (
            <DropdownMenuItem
              key={i.id}
              className="flex cursor-default flex-col items-stretch gap-0.5 whitespace-normal"
              onSelect={(e) => e.preventDefault()}
            >
              <span className="text-xs font-medium">{i.title}</span>
              <span className="text-xs text-muted-foreground">{i.body}</span>
              {!i.readAt ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => {
                    void markInboxItemRead(i.id).then(() => load())
                  }}
                >
                  Marcar lida
                </Button>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
