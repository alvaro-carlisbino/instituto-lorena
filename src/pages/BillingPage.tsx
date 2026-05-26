import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Sparkles } from 'lucide-react'

import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTenant } from '@/context/TenantContext'
import { AppLayout } from '@/layouts/AppLayout'
import { cn } from '@/lib/utils'

type Plan = {
  code: 'starter' | 'pro' | 'scale'
  name: string
  price_brl: string
  highlight?: boolean
  features: string[]
}

const PLANS: Plan[] = [
  {
    code: 'starter',
    name: 'Starter',
    price_brl: 'R$ 297',
    features: [
      'Até 3 usuários',
      'WhatsApp via ManyChat',
      'IA Sofia ilimitada',
      'Analytics básico',
      'Suporte por e-mail',
    ],
  },
  {
    code: 'pro',
    name: 'Pro',
    price_brl: 'R$ 597',
    highlight: true,
    features: [
      'Até 10 usuários',
      'WhatsApp + Instagram',
      'IA com prompt customizado',
      'Analytics avançado + por SDR',
      'Auto-agendamento opcional',
      'Prontuário médico (LGPD-ready)',
      'Suporte prioritário',
    ],
  },
  {
    code: 'scale',
    name: 'Scale',
    price_brl: 'R$ 1.297',
    features: [
      'Usuários ilimitados',
      'Múltiplas instâncias WhatsApp',
      'Múltiplos médicos',
      'API + webhooks customizados',
      'Onboarding assistido',
      'Suporte dedicado',
    ],
  },
]

function PlanCard({ plan, currentPlan, onSubscribe, loading }: {
  plan: Plan
  currentPlan: string
  onSubscribe: (code: Plan['code']) => void
  loading: boolean
}) {
  const isCurrent = currentPlan === plan.code
  return (
    <Card
      className={cn(
        'flex flex-col border-border/60',
        plan.highlight && 'border-primary/60 shadow-md ring-1 ring-primary/20',
      )}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{plan.name}</CardTitle>
          {plan.highlight ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <Sparkles className="size-3" /> Mais escolhido
            </span>
          ) : null}
        </div>
        <CardDescription>
          <span className="text-3xl font-black text-foreground">{plan.price_brl}</span>
          <span className="text-xs text-muted-foreground"> /mês</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <ul className="grid gap-2 text-sm">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto">
          {isCurrent ? (
            <Button variant="outline" disabled className="w-full">
              Plano atual
            </Button>
          ) : (
            <Button
              variant={plan.highlight ? 'default' : 'outline'}
              className="w-full"
              disabled={loading}
              onClick={() => onSubscribe(plan.code)}
            >
              {loading ? 'Abrindo checkout…' : `Assinar ${plan.name}`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function BillingPage() {
  const { tenant } = useTenant()
  const [loading, setLoading] = useState<string>('')

  const billing = tenant.billing
  const currentPlan = String(billing?.plan ?? 'trial')

  const handleSubscribe = async (code: Plan['code']) => {
    if (!supabase) {
      toast.error('Sistema não configurado.')
      return
    }
    setLoading(code)
    try {
      const { data, error } = await supabase.functions.invoke('crm-stripe-checkout', {
        body: { plan: code },
      })
      if (error) throw new Error(error.message)
      const result = (data ?? {}) as { ok?: boolean; url?: string; error?: string; message?: string }
      if (!result.ok || !result.url) {
        throw new Error(result.message || result.error || 'Falha ao iniciar checkout.')
      }
      window.location.href = result.url
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar checkout.')
    } finally {
      setLoading('')
    }
  }

  const trialDaysLeft = billing?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(billing.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null

  return (
    <AppLayout title="Planos e assinatura">
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 rounded-xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Plano atual
            </p>
            <p className="mt-1 text-lg font-bold">{currentPlan}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
            <p className="mt-1 text-lg font-bold">{billing?.status ?? 'trial'}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {currentPlan === 'trial' ? 'Trial acaba em' : 'Próxima cobrança'}
            </p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {trialDaysLeft != null
                ? `${trialDaysLeft} dia${trialDaysLeft === 1 ? '' : 's'}`
                : billing?.current_period_ends_at
                  ? new Date(billing.current_period_ends_at).toLocaleDateString('pt-BR')
                  : '—'}
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {PLANS.map((p) => (
            <PlanCard
              key={p.code}
              plan={p}
              currentPlan={currentPlan}
              onSubscribe={handleSubscribe}
              loading={loading === p.code}
            />
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Pagamento processado pela Stripe. Você pode cancelar a qualquer momento — o acesso
          continua até o fim do período pago. Trial de 14 dias automático no primeiro signup.
        </p>
      </div>
    </AppLayout>
  )
}
