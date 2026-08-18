import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarClock,
  Eraser,
  RotateCcw,
  Scissors,
  Sparkles,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react'

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
import { SearchPicker } from '@/components/ui/search-picker'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import { type PacienteEncontrado, buscarPacientes } from '@/services/pacienteBusca'
import {
  DESTINO_LABEL,
  type Destino,
  type FilaItem,
  type ForaDaFilaRow,
  adicionarNaFila,
  devolverParaFila,
  dispensarItens,
  encaminharItem,
  listFilaPosConsulta,
  listForaDaFila,
} from '@/services/posConsulta'

const MOTIVO_PADRAO = 'Backlog anterior ao início da fila'

const dia = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—'

/** Atalhos de data: é assim que ela fala, "ele me dá um retorno em três dias". */
const ATALHOS = [
  { label: 'Hoje', dias: 0 },
  { label: 'Amanhã', dias: 1 },
  { label: '3 dias', dias: 3 },
  { label: '1 semana', dias: 7 },
]

/**
 * Fila de triagem: quem saiu da consulta e ainda não tem destino.
 *
 * A fila lê a AGENDA, não o arrasto de card. Consulta médica cuja hora já passou,
 * sem desmarcação nem falta registrada, é gente que esteve aqui — aparece aqui
 * sozinha, no dia. Antes dependia de alguém mover o card para "Consulta
 * Realizada" no funil da clínica: em 18/ago a Aline atendeu uma consulta de
 * transplante às 10h45, abriu esta aba às 12h57 e não achou o paciente, porque
 * ninguém tinha movido nada. Era o mesmo repasse que "quase nunca acontecia" no
 * tempo da planilha.
 *
 * Três destinos, e nenhum deles exige venda registrada:
 *   Cirúrgico / Protocolo  troca o funil e marca o primeiro contato
 *   Follow-up              não troca nada; só marca o retorno combinado, para o
 *                          caso mais comum — o paciente saiu dizendo que pensa e
 *                          dá resposta em alguns dias
 *
 * "Zerar a fila" existe porque encaminhar backlog é pior que não encaminhar: cada
 * clique agenda contato, e começar com 43 contatos de paciente que passou há três
 * meses enterra o que é de hoje. Zerar não apaga ninguém — o lead fica no funil,
 * só para de cobrar ação nesta tela.
 */
export function PosConsultaTab() {
  const crm = useCrm()
  const { tenant } = useTenant()

  const [rows, setRows] = useState<FilaItem[]>([])
  const [fora, setFora] = useState<ForaDaFilaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [zerando, setZerando] = useState(false)
  const [confirmandoZerar, setConfirmandoZerar] = useState(false)
  const [motivo, setMotivo] = useState(MOTIVO_PADRAO)
  const [vendoFora, setVendoFora] = useState(false)

  // Follow-up é o único destino que pergunta a data: a cirurgia e o protocolo
  // seguem em um clique, com contato para amanhã.
  const [retorno, setRetorno] = useState<FilaItem | null>(null)
  const [retornoEm, setRetornoEm] = useState(hojeLocal())
  const [retornoNota, setRetornoNota] = useState('')

  const [adicionando, setAdicionando] = useState(false)
  const [escolhido, setEscolhido] = useState<{
    id: string
    label: string
    hint?: string
    leadId: string | null
    prontuario: string | null
    telefone: string | null
  } | null>(null)
  const [achados, setAchados] = useState<PacienteEncontrado[]>([])
  const [consultaEm, setConsultaEm] = useState(hojeLocal())
  const [notaManual, setNotaManual] = useState('')

  /** Dono do card e autor da decisão: quem está com a tela aberta. */
  const usuarioId = useMemo(
    () => crm.myAppUserId ?? crm.sdrMembers[0]?.id ?? null,
    [crm.myAppUserId, crm.sdrMembers],
  )

  const load = async () => {
    setLoading(true)
    try {
      const [fila, dispensados] = await Promise.all([listFilaPosConsulta(), listForaDaFila()])
      setRows(fila)
      setFora(dispensados)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a fila')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const encaminhar = async (item: FilaItem, destino: Destino, opts?: { contatoEm?: string; nota?: string }) => {
    if (!usuarioId) {
      toast.error('Sem usuário no workspace para assumir o paciente.')
      return
    }
    setEnviando(item.itemId)
    try {
      const { cardCriado } = await encaminharItem(item, destino, {
        tenantId: tenant.id,
        ownerId: usuarioId,
        usuarioId,
        contatoEm: opts?.contatoEm,
        nota: opts?.nota,
      })
      setRows((prev) => prev.filter((r) => r.itemId !== item.itemId))
      const quando = dia(opts?.contatoEm ?? diaLocalComOffset(1))
      toast.success(
        `${item.paciente} foi para o ${DESTINO_LABEL[destino]}, com contato marcado para ${quando}.` +
          (cardCriado ? ' O card do paciente foi criado agora.' : ''),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao encaminhar')
    } finally {
      setEnviando(null)
    }
  }

  const confirmarRetorno = async () => {
    if (!retorno) return
    const item = retorno
    setRetorno(null)
    await encaminhar(item, 'followup', { contatoEm: retornoEm, nota: retornoNota })
    setRetornoNota('')
    setRetornoEm(hojeLocal())
  }

  const dispensarUm = async (item: FilaItem) => {
    setEnviando(item.itemId)
    try {
      await dispensarItens([item], 'Dispensado na triagem', { tenantId: tenant.id, usuarioId })
      setRows((prev) => prev.filter((r) => r.itemId !== item.itemId))
      toast.success(`${item.paciente} saiu da fila. O paciente continua no funil e no histórico.`)
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
      const n = await dispensarItens(rows, motivo, { tenantId: tenant.id, usuarioId })
      setConfirmandoZerar(false)
      toast.success(`${n} ${n === 1 ? 'paciente saiu' : 'pacientes saíram'} da fila. A fila começa de hoje.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao zerar a fila')
    } finally {
      setZerando(false)
    }
  }

  const devolver = async (itemId: string, nome: string) => {
    try {
      await devolverParaFila(itemId)
      toast.success(`${nome} voltou para a fila.`)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao devolver para a fila')
    }
  }

  const adicionar = async () => {
    if (!escolhido) return
    try {
      await adicionarNaFila({
        tenantId: tenant.id,
        paciente: escolhido.label,
        leadId: escolhido.leadId,
        prontuario: escolhido.prontuario,
        telefone: escolhido.telefone,
        consultaEm,
        nota: notaManual,
        usuarioId,
      })
      setAdicionando(false)
      setEscolhido(null)
      setNotaManual('')
      setConsultaEm(hojeLocal())
      toast.success('Paciente entrou na fila de pós-consulta.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao colocar na fila')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Saiu da consulta, falta destino</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Vem da agenda: consulta com médico cuja hora já passou, sem desmarcação nem falta. Cada
              paciente vai para o funil cirúrgico, para o de protocolos, ou só ganha data de retorno no
              follow-up — sem precisar registrar venda que ainda não aconteceu.
            </p>
          </div>
          <CardAction>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setAdicionando(true)}>
                <UserPlus className="size-3.5" /> Adicionar paciente
              </Button>
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
                  : 'Quem passar em consulta hoje aparece aqui depois do horário. Consulta encaixada que a agenda não pegou entra por "Adicionar paciente".'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Consulta</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead className="text-right">Encaminhar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((item) => (
                    <TableRow key={item.itemId}>
                      <TableCell>
                        <div className="font-medium">{item.paciente}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {item.servico ?? item.origemLead ?? 'Serviço não informado pela Shosp'}
                          {!item.leadId && (
                            <Badge variant="outline" title="O card é criado no clique do destino">
                              sem card
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div>
                          {dia(item.consultaEm)}
                          {item.horario ? ` · ${item.horario}` : ''}
                          {item.diasParado > 0 ? ` · há ${item.diasParado}d` : ''}
                        </div>
                        {item.prestador && <div className="text-xs">{item.prestador}</div>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.telefone ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={enviando === item.itemId}
                            onClick={() => void encaminhar(item, 'cirurgia')}
                          >
                            <Scissors className="size-3.5" /> Cirúrgico
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={enviando === item.itemId}
                            onClick={() => void encaminhar(item, 'protocolo')}
                          >
                            <Sparkles className="size-3.5" /> Protocolo
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            title="Ainda não decidiu: só marcar o retorno combinado"
                            disabled={enviando === item.itemId}
                            onClick={() => {
                              setRetorno(item)
                              setRetornoEm(hojeLocal())
                              setRetornoNota('')
                            }}
                          >
                            <CalendarClock className="size-3.5" /> Follow-up
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Tirar da fila sem encaminhar"
                            disabled={enviando === item.itemId}
                            onClick={() => void dispensarUm(item)}
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

      {fora.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Fora da fila</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Continuam no funil e no histórico. Só não cobram destino nesta tela.
              </p>
            </div>
            <CardAction>
              <Button size="sm" variant="ghost" onClick={() => setVendoFora((v) => !v)}>
                {vendoFora ? 'Esconder' : `Ver os ${fora.length}`}
              </Button>
            </CardAction>
          </CardHeader>
          {vendoFora && (
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
                    {fora.map((d) => (
                      <TableRow key={d.itemId}>
                        <TableCell className="font-medium">{d.paciente}</TableCell>
                        <TableCell className="text-muted-foreground">{d.reason ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{dia(d.resolvedAt)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void devolver(d.itemId, d.paciente)}
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

      <Dialog open={retorno != null} onOpenChange={(v) => (!v ? setRetorno(null) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Marcar o retorno de {retorno?.paciente}</DialogTitle>
            <DialogDescription>
              O paciente fica onde está, sem venda e sem trocar de funil. O que nasce aqui é o contato com
              data — ele aparece no Follow-up no dia marcado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Primeiro contato em</Label>
              <div className="flex flex-wrap gap-2">
                {ATALHOS.map((a) => (
                  <Button
                    key={a.label}
                    size="sm"
                    variant={retornoEm === diaLocalComOffset(a.dias) ? 'default' : 'outline'}
                    onClick={() => setRetornoEm(diaLocalComOffset(a.dias))}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <Input type="date" value={retornoEm} onChange={(e) => setRetornoEm(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>O que ficou combinado</Label>
              <Textarea
                rows={3}
                value={retornoNota}
                onChange={(e) => setRetornoNota(e.target.value)}
                placeholder="Ex.: vai conversar com a esposa e responde até sexta; ficou de mandar os exames."
              />
              <p className="text-xs text-muted-foreground">
                Vira a nota do follow-up. É o que você lê antes de chamar, para não recomeçar a conversa.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRetorno(null)}>
              Cancelar
            </Button>
            <Button disabled={!retornoEm} onClick={() => void confirmarRetorno()}>
              Marcar contato
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adicionando} onOpenChange={(v) => (!v ? setAdicionando(false) : null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Colocar paciente na fila</DialogTitle>
            <DialogDescription>
              Para o que a agenda não conta: consulta encaixada, paciente que voltou fora de horário, ou
              consulta que a Shosp não devolveu com serviço.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Paciente</Label>
              <SearchPicker
                title="Buscar paciente"
                placeholder="Escolher paciente"
                searchPlaceholder="Nome, telefone, CPF ou prontuário…"
                value={escolhido ? { id: escolhido.id, label: escolhido.label, hint: escolhido.hint } : null}
                onSearch={async (q) => {
                  const lista = await buscarPacientes(q, 20, tenant.id)
                  setAchados(lista)
                  return lista.map((p) => ({
                    id: `${p.tipo}:${p.ref}`,
                    label: p.nome,
                    hint: [p.telefone, p.prontuario ? `prontuário ${p.prontuario}` : null]
                      .filter(Boolean)
                      .join(' · '),
                    searchable: [p.cpf, p.prontuario].filter(Boolean).join(' '),
                    meta: p.consultas > 0 ? `${p.consultas} consulta${p.consultas > 1 ? 's' : ''}` : undefined,
                  }))
                }}
                onPick={(pick) => {
                  const p = achados.find((x) => `${x.tipo}:${x.ref}` === pick.id)
                  setEscolhido({
                    id: pick.id,
                    label: pick.label,
                    hint: pick.hint,
                    leadId: p?.leadId ?? null,
                    prontuario: p?.prontuario ?? null,
                    telefone: p?.telefone ?? null,
                  })
                }}
                onClear={() => setEscolhido(null)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Dia da consulta</Label>
              <Input type="date" value={consultaEm} onChange={(e) => setConsultaEm(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Nota (opcional)</Label>
              <Textarea
                rows={2}
                value={notaManual}
                onChange={(e) => setNotaManual(e.target.value)}
                placeholder="Ex.: encaixe da tarde, consulta de transplante."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdicionando(false)}>
              Cancelar
            </Button>
            <Button disabled={!escolhido} onClick={() => void adicionar()}>
              Colocar na fila
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
