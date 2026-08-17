import { useState } from 'react'
import { toast } from 'sonner'

import { NoticeBanner } from '@/components/NoticeBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldControl } from '@/components/ui/field'
import { BRAND_LOGO_HORIZONTAL_URL } from '@/config/brandAssets'
import { APP_ENV_BADGE, APP_NAME } from '@/config/branding'
import { concluirDefinicaoDeSenha, origemDoAcesso } from '@/lib/authLinkFlow'
import { supabase } from '@/lib/supabaseClient'

const MINIMO = 8

/**
 * Primeiro acesso: ela escolhe a própria senha e entra.
 *
 * Existe para que ninguém precise digitar senha por outra pessoa. Quem cria o
 * usuário manda o link do convite; a senha nasce aqui, com ela, e não passa por
 * WhatsApp nem pela cabeça de quem cadastrou.
 */
export function DefinirSenhaPage({ email, onPronto }: { email?: string | null; onPronto: () => void }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [aviso, setAviso] = useState('')
  const recuperacao = origemDoAcesso() === 'recuperacao'

  const salvar = async () => {
    if (senha.length < MINIMO) {
      setAviso(`A senha precisa de pelo menos ${MINIMO} caracteres.`)
      return
    }
    if (senha !== confirmacao) {
      setAviso('As duas senhas não são iguais.')
      return
    }
    if (!supabase) {
      setAviso('Sistema não configurado.')
      return
    }
    setSalvando(true)
    setAviso('')
    try {
      const { error } = await supabase.auth.updateUser({ password: senha })
      if (error) throw new Error(error.message)
      concluirDefinicaoDeSenha()
      toast.success('Senha criada. Bem-vinda!')
      onPronto()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Não foi possível salvar a senha.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-gradient-to-b from-muted/50 via-background to-muted/30 p-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 55%)`,
        }}
      />
      <Card className="relative w-full max-w-md border-border/80 shadow-lg shadow-black/5">
        <CardHeader className="space-y-4 pb-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 max-w-[min(100%,12rem)] shrink-0 items-center justify-center rounded-xl bg-muted/40 px-2 py-1.5 shadow-inner ring-1 ring-border/60">
              <img src={BRAND_LOGO_HORIZONTAL_URL} alt="" className="max-h-10 w-full object-contain object-left" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">{APP_NAME}</p>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold uppercase">
                  {APP_ENV_BADGE}
                </Badge>
              </div>
              <CardTitle className="text-2xl font-semibold tracking-tight">
                {recuperacao ? 'Nova senha' : 'Crie sua senha'}
              </CardTitle>
            </div>
          </div>
          <CardDescription className="space-y-2 text-base leading-relaxed text-muted-foreground">
            <span className="block">
              {recuperacao
                ? 'Escolha uma senha nova para voltar a entrar.'
                : 'Este é o seu primeiro acesso. Escolha uma senha só sua: é com ela que você entra daqui pra frente.'}
            </span>
            {/* De quem é a conta, em destaque. Sem isto, quem só quis conferir se o
                link funciona acaba criando a senha da OUTRA pessoa sem perceber —
                foi o que aconteceu no primeiro convite, em 17/08/2026. */}
            {email && (
              <span className="block rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-sm text-foreground">
                Você está criando a senha da conta <strong className="font-semibold">{email}</strong>. Se esta
                conta não é sua, feche esta página: quem vai usar esse acesso é quem precisa escolher a senha.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void salvar()
          }}
        >
          <CardContent className="grid gap-5 pt-2">
            <Field label="Nova senha" inputSize="comfortable">
              <FieldControl
                type="password"
                value={senha}
                onChange={(event) => setSenha(event.target.value)}
                placeholder="Mínimo de 8 caracteres"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Repita a senha" inputSize="comfortable">
              <FieldControl
                type="password"
                value={confirmacao}
                onChange={(event) => setConfirmacao(event.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </Field>
            <NoticeBanner message={aviso} variant="warning" />
          </CardContent>
          <CardFooter className="border-t border-border/60 bg-muted/20 px-6 py-5">
            <Button type="submit" className="h-11 w-full font-medium" disabled={salvando} aria-busy={salvando || undefined}>
              {salvando ? 'Salvando…' : 'Salvar e entrar'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
