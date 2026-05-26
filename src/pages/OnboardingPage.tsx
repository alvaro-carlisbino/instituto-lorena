import { useState } from 'react'

import { NoticeBanner } from '@/components/NoticeBanner'
import { noticeVariantFromMessage } from '@/lib/noticeVariant'
import { BRAND_LOGO_HORIZONTAL_URL } from '@/config/brandAssets'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  displayName: string
  clinicName: string
  primaryColor: string
  isLoading: boolean
  notice: string
  onDisplayNameChange: (value: string) => void
  onClinicNameChange: (value: string) => void
  onPrimaryColorChange: (value: string) => void
  onComplete: () => void
}

type Step = 1 | 2 | 3

function slugPreview(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || '(slug invalido)'
}

export function OnboardingPage({
  displayName,
  clinicName,
  primaryColor,
  isLoading,
  notice,
  onDisplayNameChange,
  onClinicNameChange,
  onPrimaryColorChange,
  onComplete,
}: Props) {
  const [step, setStep] = useState<Step>(1)

  const canNextStep1 = clinicName.trim().length >= 2
  const canNextStep2 = displayName.trim().length >= 2

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md border-border/80 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex h-11 max-w-[12rem] items-center justify-start rounded-lg bg-muted/50 px-2 py-1 ring-1 ring-border/50">
            <img src={BRAND_LOGO_HORIZONTAL_URL} alt="" className="max-h-9 w-full object-contain object-left" />
          </div>
          <p className="text-xs font-semibold tracking-wide text-primary uppercase">
            Etapa {step} de 3
          </p>
          {step === 1 && (
            <>
              <CardTitle className="text-xl">Sobre sua clínica</CardTitle>
              <CardDescription>
                Vamos configurar seu CRM. Comece pelo nome da sua clínica — é o que vai aparecer
                pra você e sua equipe.
              </CardDescription>
            </>
          )}
          {step === 2 && (
            <>
              <CardTitle className="text-xl">Quem é você?</CardTitle>
              <CardDescription>
                Esse nome aparece no registro de ações, agenda e atribuições de leads.
              </CardDescription>
            </>
          )}
          {step === 3 && (
            <>
              <CardTitle className="text-xl">Identidade visual</CardTitle>
              <CardDescription>
                Cor principal usada em destaques, botões e cabeçalhos. Pode trocar depois em
                Configurações.
              </CardDescription>
            </>
          )}
        </CardHeader>

        <CardContent className="grid gap-4">
          {step === 1 && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="onb-clinic-name">Nome da clínica</Label>
                <Input
                  id="onb-clinic-name"
                  type="text"
                  value={clinicName}
                  onChange={(event) => onClinicNameChange(event.target.value)}
                  placeholder="Ex.: Clínica São Lucas"
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground">
                  URL/identificador interno:{' '}
                  <code className="rounded bg-muted/60 px-1">{slugPreview(clinicName)}</code>
                </p>
              </div>
            </>
          )}

          {step === 2 && (
            <div className="grid gap-2">
              <Label htmlFor="onb-name">Seu nome completo</Label>
              <Input
                id="onb-name"
                type="text"
                value={displayName}
                onChange={(event) => onDisplayNameChange(event.target.value)}
                placeholder="Ex.: Mariana Almeida"
                autoComplete="name"
                autoFocus
              />
            </div>
          )}

          {step === 3 && (
            <div className="grid gap-2">
              <Label htmlFor="onb-color">Cor principal</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="onb-color"
                  type="color"
                  value={primaryColor}
                  onChange={(event) => onPrimaryColorChange(event.target.value)}
                  className="h-10 w-16 cursor-pointer p-1"
                />
                <Input
                  type="text"
                  value={primaryColor}
                  onChange={(event) => onPrimaryColorChange(event.target.value)}
                  placeholder="#0ea5e9"
                  className="font-mono text-sm"
                />
              </div>
              <div
                className="mt-2 rounded-md border border-border/40 p-3 text-sm"
                style={{ backgroundColor: primaryColor, color: '#fff' }}
              >
                Preview de cabeçalho — {clinicName.trim() || 'sua clínica'}
              </div>
            </div>
          )}

          <NoticeBanner message={notice} variant={noticeVariantFromMessage(notice)} />
        </CardContent>

        <CardFooter className="flex justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
            disabled={step === 1 || isLoading}
          >
            Voltar
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((s) => ((s + 1) as Step))}
              disabled={(step === 1 && !canNextStep1) || (step === 2 && !canNextStep2)}
            >
              Continuar
            </Button>
          ) : (
            <Button onClick={onComplete} disabled={isLoading || !canNextStep1 || !canNextStep2}>
              {isLoading ? 'Criando clínica…' : 'Concluir e entrar'}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
