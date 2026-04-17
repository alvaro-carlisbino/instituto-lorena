import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Instituto Lorena · Área restrita</p>
          <CardTitle className="text-xl">Central comercial</CardTitle>
          <CardDescription>Acesse com seu usuário corporativo para entrar no CRM.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="auth-email">Email</Label>
            <Input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="voce@institutolorena.com"
              autoComplete="email"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="auth-password">Senha</Label>
            <Input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          {notice ? (
            <p className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-foreground">{notice}</p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row">
          <Button className="w-full sm:flex-1" onClick={onSignIn} disabled={isLoading}>
            {isLoading ? 'Entrando…' : 'Entrar'}
          </Button>
          <Button type="button" variant="outline" className="w-full sm:flex-1" onClick={onSignUp} disabled={isLoading}>
            Solicitar acesso
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
