import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldControl } from '@/components/ui/field'
import { BRAND_LOGO_HORIZONTAL_URL } from '@/config/brandAssets'
import { APP_ENV_BADGE, APP_NAME } from '@/config/branding'

type Props = {
  email: string
  password: string
  isLoading: boolean
  notice: string
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSignIn: () => void
  onSignUp: () => void
}

export function AuthPage({
  email,
  password,
  isLoading,
  notice,
  onEmailChange,
  onPasswordChange,
  onSignIn,
  onSignUp,
}: Props) {
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
              <CardTitle className="text-2xl font-semibold tracking-tight">Entrar</CardTitle>
            </div>
          </div>
          <CardDescription className="text-base leading-relaxed text-muted-foreground">
            Use o e-mail e a senha fornecidos pela equipe para acessar o painel.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 pt-2">
          <Field label="E-mail" inputSize="comfortable">
            <FieldControl
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="voce@empresa.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Senha" inputSize="comfortable">
            <FieldControl
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
          <NoticeBanner message={notice} variant={noticeVariantFromMessage(notice)} />
        </CardContent>
        <CardFooter className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 px-6 py-5 sm:flex-row sm:justify-stretch">
          <Button className="h-11 w-full font-medium sm:flex-1" onClick={onSignIn} disabled={isLoading}>
            {isLoading ? 'Entrando…' : 'Entrar'}
          </Button>
          <Button type="button" variant="outline" className="h-11 w-full sm:flex-1" onClick={onSignUp} disabled={isLoading}>
            Solicitar acesso
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
