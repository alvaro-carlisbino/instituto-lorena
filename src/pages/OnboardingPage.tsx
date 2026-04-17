import { NoticeBanner, noticeVariantFromMessage } from '@/components/NoticeBanner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  displayName: string
  isLoading: boolean
  notice: string
  onDisplayNameChange: (value: string) => void
  onComplete: () => void
}

export function OnboardingPage({
  displayName,
  isLoading,
  notice,
  onDisplayNameChange,
  onComplete,
}: Props) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md border-border/80 shadow-sm">
        <CardHeader className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">Primeiro acesso</p>
          <CardTitle className="text-xl">Complete seu perfil</CardTitle>
          <CardDescription>
            Antes de entrar no CRM, confirme seu nome de exibição para auditoria e trilha operacional.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="onboarding-name">Nome completo</Label>
            <Input
              id="onboarding-name"
              type="text"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Ex.: Mariana Almeida"
              autoComplete="name"
            />
          </div>
          <NoticeBanner message={notice} variant={noticeVariantFromMessage(notice)} />
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={onComplete} disabled={isLoading}>
            {isLoading ? 'Salvando…' : 'Concluir acesso'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
