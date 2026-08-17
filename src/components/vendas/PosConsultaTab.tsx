import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eraser, RotateCcw, Scissors, Sparkles, UserCheck, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  type DispensadoRow,
  type PostConsultationLead,
  dispensarDaFila,
  listDispensados,
  listPostConsultation,
  reabrirNaFila,
  routeAfterConsultation,
} from '@/services/leadFollowups'

const MOTIVO_PADRAO = 'Backlog anterior ao início da fila'

const dataHora = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')

/**
 * Fila de triagem: quem já passou em consulta e ainda não tem dono.
 *
 * Existe porque o funil da Dandara termina em "Consulta Realizada" e ninguém
 * pega dali. Eram 81 pacientes parados na etapa quando esta tela foi escrita, o
 * mais antigo havia meses. Um clique manda para a Aline ou para a Ingrid e já
 * agenda o primeiro contato.
 *
 * "Zerar a fila" existe porque encaminhar backlog é pior que não encaminhar: cada
 * clique agenda contato para amanhã, e começar com 43 contatos de paciente que
 * passou em consulta há três meses enterra o que é de hoje. Zerar não apaga
 * ninguém — o lead fica no funil, só para de cobrar ação nesta tela.
 */
export function PosConsultaTab() {
  const [rows, setRows] = useState<PostConsultationLead[]>([])
  const [dispensados, setDispensados] = useState<DispensadoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [zerando, setZerando] = useState(false)
  const [confirmandoZerar, setConfirmandoZerar] = useState(false)
  const [motivo, setMotivo] = useState(MOTIVO_PADRAO)
  const [vendoDispensados, setVendoDispensados] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [fila, fora] = await Promise.all([listPostConsultation(), listDispensados()])
      setRows(fila)
      setDispensados(fora)
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

  const dispensarUm = async (lead: PostConsultationLead) => {
    setEnviando(lead.id)
    try {
      await dispensarDaFila([lead.id], 'Dispensado na triagem')
      setRows((prev) => prev.filter((r) => r.id !== lead.id))
      toast.success(`${lead.patientName} saiu da fila. O paciente continua no funil.`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao dispensar')
    } finally {
      setEnviando(null)
    }
  }

  const zerar = async () => {
    setZerando(true)
    try {
      const n = await dispensarDaFila(
        rows.map((r) => r.id),
        motivo,
      )
      setConfirmandoZerar(false)
      toast.success(`${n} ${n === 1 ? 'paciente saiu' : 'pacientes saíram'} da fila. A fila começa de hoje.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao zerar a fila')
    } finally {
      setZerando(false)
    }
  }

  const reabrir = async (leadId: string, nome: string) => {
    try {
      await reabrirNaFila(leadId)
      toast.success(`${nome} voltou para a fila.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao devolver para a fila')
    }
  }

  return (
    <div className="space-y-4">
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
            <div className="flex items-center gap-2">
              {rows.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setConfirmandoZerar(true)}>
                  <Eraser className="size-3.5" /> Zerar a fila
                </Button>
              )}
              <Badge variant={rows.length > 0 ? 'default' : 'secondary'}>{rows.length}</Badge>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={UserCheck}
              title={loading ? 'Carregando…' : 'Ninguém esperando'}
              description={
                loading
                  ? undefined
                  : 'Quem passar em consulta de agora em diante aparece aqui para receber destino.'
              }
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
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Tirar da fila sem encaminhar"
                            disabled={enviando === lead.id}
                            onClick={() => void dispensarUm(lead)}
                          >
                            <X className="size-3.5" />
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

      {dispensados.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fora da fila</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Continuam no funil e no histórico. Só não cobram destino nesta tela.
              </p>
            </div>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={() => setVendoDispensados((v) => !v)}>
                {vendoDispensados ? 'Esconder' : `Ver os ${dispensados.length}`}
              </Button>
            </CardAction>
          </CardHeader>
          {vendoDispensados && (
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Saiu em</TableHead>
                      <TableHead className="text-right">Devolver</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispensados.map((d) => (
                      <TableRow key={d.leadId}>
                        <TableCell className="font-medium">{d.patientName}</TableCell>
                        <TableCell className="text-muted-foreground">{d.reason ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{dataHora(d.dismissedAt)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void reabrir(d.leadId, d.patientName)}
                            >
                              <RotateCcw className="size-3.5" /> Voltar para a fila
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Dialog open={confirmandoZerar} onOpenChange={(v) => (!v ? setConfirmandoZerar(false) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Zerar a fila de pós-consulta</DialogTitle>
            <DialogDescription>
              {rows.length} {rows.length === 1 ? 'paciente sai' : 'pacientes saem'} da fila e ela passa a
              contar de hoje. Ninguém é apagado: cada um continua no funil, na mesma etapa, com o histórico
              inteiro. Dá para devolver qualquer um depois.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Fica registrado com a data, para quem olhar depois entender por que a fila esvaziou de uma vez.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmandoZerar(false)}>
              Cancelar
            </Button>
            <Button disabled={zerando} onClick={() => void zerar()}>
              {zerando ? 'Zerando…' : `Zerar ${rows.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
