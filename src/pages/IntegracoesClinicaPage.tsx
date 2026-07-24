import { ExternalLink, Hospital, MessagesSquare, Stethoscope } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const ENFERMAGEM_URL = 'https://app.institutolorenavisentainer.com.br/dashboard/'
const ENFERMAGEM_PIN = '123654'

/** Pontes para Meta4, dashboard enfermagem e CRM da Aline (sistemas externos / canais). */
export function IntegracoesClinicaPage() {
  const navigate = useNavigate()
  return (
    <AppLayout
      title="Integrações clínicas"
      subtitle="Atalhos para Meta4, enfermagem e CRM da Aline."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Hospital className="size-4 text-primary" /> Meta4
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Sistema Meta4 (prontuário / gestão). Abra o ambiente oficial da clínica.</p>
            <Badge variant="secondary">Externo</Badge>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => window.open('https://www.meta4.com.br/', '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="size-3.5" /> Abrir Meta4
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Stethoscope className="size-4 text-primary" /> Enfermagem
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Dashboard de enfermagem da clínica.</p>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-foreground">
              Senha de acesso: <strong className="font-mono tracking-wider">{ENFERMAGEM_PIN}</strong>
            </div>
            <Button
              className="w-full"
              onClick={() => window.open(ENFERMAGEM_URL, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="size-3.5" /> Abrir dashboard enfermagem
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessagesSquare className="size-4 text-primary" /> CRM da Aline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Funil e conversas comerciais da Aline neste CRM (polo clínica).</p>
            <Button className="w-full" onClick={() => navigate('/kanban')}>
              Abrir funil / Kanban
            </Button>
            <Button className="w-full" variant="outline" onClick={() => navigate('/chat')}>
              Chat comercial
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  )
}
