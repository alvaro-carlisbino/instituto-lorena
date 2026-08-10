import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Scissors, Sparkles, UserCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type PostConsultationLead,
  listPostConsultation,
  routeAfterConsultation,
} from '@/services/leadFollowups'

/**
 * Fila de triagem: quem já passou em consulta e ainda não tem dono.
 *
 * Existe porque o funil da Dandara termina em "Consulta Realizada" e ninguém
 * pega dali. Eram 81 pacientes parados na etapa quando esta tela foi escrita, o
 * mais antigo havia meses. Um clique manda para a Aline ou para a Ingrid e já
 * agenda o primeiro contato.
 */
export function PosConsultaTab() {
  const [rows, setRows] = useState<PostConsultationLead[]>([])
  const [loading, setLoading] = useState(false)
  const [enviando, setEnviando] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setRows(await listPostConsultation())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a fila')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const rotear = async (lead: PostConsultationLead, destino: 'cirurgia' | 'protocolo') => {
    setEnviando(lead.id)
    try {
      await routeAfterConsultation(lead.id, destino)
      setRows((prev) => prev.filter((r) => r.id !== lead.id))
      toast.success(
        destino === 'cirurgia'
          ? `${lead.patientName} foi para o funil cirúrgico, com contato agendado para amanhã.`
          : `${lead.patientName} foi para o funil de protocolos, com contato agendado para amanhã.`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao encaminhar')
    } finally {
      setEnviando(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Saiu da consulta, falta destino</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada paciente vai para o funil cirúrgico ou para o de protocolos, e já nasce com o primeiro
            contato marcado para amanhã.
          </p>
        </div>
        <CardAction>
          <Badge variant={rows.length > 0 ? 'default' : 'secondary'}>{rows.length}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={UserCheck}
            title={loading ? 'Carregando…' : 'Ninguém esperando'}
            description={loading ? undefined : 'Todo paciente que passou em consulta já tem dono.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Parado há</TableHead>
                  <TableHead className="text-right">Encaminhar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium">{lead.patientName}</TableCell>
                    <TableCell className="text-muted-foreground">{lead.phone ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{lead.source ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={lead.diasParado > 14 ? 'destructive' : 'secondary'}>
                        {lead.diasParado} {lead.diasParado === 1 ? 'dia' : 'dias'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={enviando === lead.id}
                          onClick={() => void rotear(lead, 'cirurgia')}
                        >
                          <Scissors className="size-3.5" /> Cirúrgico
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={enviando === lead.id}
                          onClick={() => void rotear(lead, 'protocolo')}
                        >
                          <Sparkles className="size-3.5" /> Protocolo
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
