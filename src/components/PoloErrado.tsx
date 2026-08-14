import type { ReactNode } from 'react'
import { Building2, LogOut, Pill } from 'lucide-react'

import { useTenant } from '@/context/TenantContext'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'

/**
 * Porta fechada do CRM de polo único: o login existe, mas não é deste negócio.
 *
 * Sem esta tela a pessoa entraria e veria um CRM funcionando e completamente vazio, sem
 * lead, sem conversa e sem explicação — o tipo de silêncio que vira chamado no WhatsApp
 * do dono. Aqui ela lê o motivo e sai pela porta certa.
 */
export function PoloErrado({ polo, onSair }: { polo: string; onSair: () => void }) {
  const ehVendas = polo === 'tricopill'
  const Icon = ehVendas ? Pill : Building2
  const nome = ehVendas ? 'Tricopill' : 'Instituto Lorena'

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-xl bg-muted">
          <Icon className="size-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Este é o CRM do {nome}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sua conta não faz parte deste negócio. Entre pelo endereço do CRM em que você
          trabalha, ou peça acesso a quem administra este aqui.
        </p>
        <Button variant="outline" className="mt-6 w-full" onClick={onSair}>
          <LogOut className="size-4" aria-hidden />
          Sair desta conta
        </Button>
      </div>
    </div>
  )
}

/**
 * Guarda de polo. Não usa o `loading` do TenantContext de propósito: ele fica true a cada
 * revalidação (inclusive quando a aba volta do foco) e desmontaria a árvore inteira,
 * apagando o formulário de quem só foi olhar o Google. Só `poloBloqueado` decide.
 */
export function PoloGate({ children }: { children: ReactNode }) {
  const { poloBloqueado } = useTenant()
  if (!poloBloqueado) return <>{children}</>
  return (
    <PoloErrado
      polo={poloBloqueado}
      onSair={() => {
        void supabase?.auth.signOut().finally(() => window.location.assign('/'))
      }}
    />
  )
}
