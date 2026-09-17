import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeftRight, Lock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useCrm } from '@/context/CrmContext'
import { useLinhasDoPolo } from '@/hooks/useLinhasParticularesOcultas'
import { cn } from '@/lib/utils'
import type { Lead } from '@/mocks/crmMock'
import { transferirConversa } from '@/services/conversationControl'

type Props = {
  lead: Lead
  /** Número da conversa aberta na tela. `null` = onde o contato está amarrado. */
  linhaAtual: string | null
  /** Chamado com o número de destino quando a transferência trocou de número. */
  onTransferido?: (linhaId: string) => void
}

/**
 * Botão "Transferir" do cabeçalho do chat (17/set/2026): passa a conversa para outro número do
 * polo e/ou outra pessoa, SDR → Aline Muniz e de volta. O que acontece de verdade está em
 * `supabase/functions/_shared/transferenciaConversa.ts`; aqui a tela só mostra antes de
 * confirmar, com as mesmas regras (número particular leva a dona, IA da origem fica em Humano).
 */
export function TransferirConversa({ lead, linhaAtual, onTransferido }: Props) {
  const crm = useCrm()
  const linhasPolo = useLinhasDoPolo()
  const [aberto, setAberto] = useState(false)
  const [paraId, setParaId] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [recado, setRecado] = useState('')
  const [enviando, setEnviando] = useState(false)

  const { linhas } = linhasPolo
  const amarradoId =
    lead.whatsappInstanceId && linhasPolo.ids.has(lead.whatsappInstanceId)
      ? lead.whatsappInstanceId
      : linhasPolo.padraoId
  const deId = linhaAtual && linhasPolo.ids.has(linhaAtual) ? linhaAtual : amarradoId
  const de = linhas.find((l) => l.id === deId) ?? null
  const para = linhas.find((l) => l.id === paraId) ?? null
  const variosNumeros = linhas.length >= 2

  const pessoas = useMemo(
    () => crm.users.filter((u) => u.active || u.id === lead.ownerId),
    [crm.users, lead.ownerId],
  )
  /** `null` quando a pessoa não está na lista carregada (a tela diz "a dona do número"). */
  const nomeDaPessoa = (id: string | null | undefined): string | null =>
    (id && crm.users.find((u) => u.id === id)?.name) || null

  if (linhas.length === 0) return null

  const responsavel = para?.privateOwnerId ?? responsavelId
  const trocaNumero = Boolean(para && (para.id !== deId || para.id !== amarradoId))
  const trocaResponsavel = responsavel !== (lead.ownerId ?? '')
  const nadaMuda = !trocaNumero && !trocaResponsavel
  const souEu = responsavel === crm.myAppUserId

  const abrir = () => {
    const destino = variosNumeros ? linhas.find((l) => l.id !== deId) ?? linhas[0]! : linhas[0]!
    setParaId(destino.id)
    setResponsavelId(destino.privateOwnerId ?? lead.ownerId ?? '')
    setRecado('')
    setAberto(true)
  }

  const escolherNumero = (id: string) => {
    const linha = linhas.find((l) => l.id === id)
    if (!linha) return
    setParaId(id)
    // Particular vai sempre para a dona. Saindo dele, volta a sugerir quem já cuida do contato.
    if (linha.privateOwnerId) setResponsavelId(linha.privateOwnerId)
    else if (para?.privateOwnerId) setResponsavelId(lead.ownerId ?? '')
  }

  const confirmar = async () => {
    if (!para || nadaMuda || enviando) return
    setEnviando(true)
    try {
      const r = await transferirConversa({
        leadId: lead.id,
        toInstanceId: para.id,
        fromInstanceId: deId,
        ownerId: responsavel || null,
        note: recado.trim() || undefined,
      })
      toast.success(
        r.trocaNumero
          ? `Conversa transferida para o número ${r.paraNome}`
          : `Contato passado para ${r.responsavelNome ?? 'outra pessoa'}`,
        { description: r.avisado && r.responsavelNome ? `${r.responsavelNome} recebeu um aviso.` : undefined },
      )
      setAberto(false)
      if (r.trocaNumero) onTransferido?.(r.whatsappInstanceId)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para transferir a conversa.')
    } finally {
      setEnviando(false)
    }
  }

  const efeitos: string[] = []
  if (para && trocaNumero) {
    efeitos.push(`A resposta, os lembretes e o follow-up passam a sair pelo número ${para.nomeCurto}.`)
    if (para.privateOwnerId && para.privateOwnerId !== crm.myAppUserId && crm.effectiveRole !== 'admin') {
      efeitos.push(
        `O número ${para.nomeCurto} é particular: a conversa por ele só aparece para ${nomeDaPessoa(para.privateOwnerId) ?? 'a dona do número'} e para admin.`,
      )
    }
    if (de && de.id !== para.id && de.aiAutoReply) {
      efeitos.push(`No número ${de.nomeCurto}, a IA fica em Humano para este contato.`)
    }
  }
  if (responsavel) {
    const quem = nomeDaPessoa(responsavel) ?? (para?.privateOwnerId ? 'A dona do número' : 'A pessoa escolhida')
    efeitos.push(souEu ? 'Você fica responsável pelo contato.' : `${quem} fica responsável e recebe um aviso.`)
  }
  efeitos.push('Fica uma nota na conversa dizendo quem transferiu.')
  if (para && trocaNumero && de && de.id !== para.id) {
    efeitos.push(`Se o paciente voltar a escrever no número ${de.nomeCurto}, a resposta volta a sair por lá.`)
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="rounded-xl gap-1.5 text-xs"
        onClick={abrir}
        title="Passar esta conversa para outro número ou outra pessoa"
        aria-label="Transferir conversa"
      >
        <ArrowLeftRight className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Transferir</span>
      </Button>

      <Dialog open={aberto} onOpenChange={(v) => !enviando && setAberto(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Transferir conversa</DialogTitle>
            <DialogDescription>
              {lead.patientName}
              {de ? `, hoje no número ${de.nomeCurto}` : ''}.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            {variosNumeros ? (
              <div className="grid gap-1.5">
                <Label className="text-xs">Para qual número</Label>
                <div role="radiogroup" aria-label="Número de destino" className="grid gap-1.5">
                  {linhas.map((l) => {
                    const escolhido = l.id === paraId
                    const detalhes = [
                      l.id === deId ? 'conversa aberta' : null,
                      l.privateOwnerId
                        ? `particular${nomeDaPessoa(l.privateOwnerId) ? ` de ${nomeDaPessoa(l.privateOwnerId)}` : ''}`
                        : null,
                      l.aiAutoReply ? 'com IA' : 'só equipe, sem IA',
                    ].filter(Boolean)
                    return (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={escolhido}
                        onClick={() => escolherNumero(l.id)}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                          escolhido
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                            : 'border-border/60 hover:bg-muted/40',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            {l.privateOwnerId ? <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
                            <span className="truncate">{l.nomeCurto}</span>
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">{detalhes.join(' · ')}</span>
                        </span>
                        <span
                          className={cn(
                            'size-4 shrink-0 rounded-full border',
                            escolhido ? 'border-[5px] border-primary' : 'border-muted-foreground/40',
                          )}
                          aria-hidden
                        />
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label className="text-xs">Responsável pelo contato</Label>
              <Select
                value={responsavel}
                onValueChange={(v) => setResponsavelId(String(v ?? ''))}
                disabled={Boolean(para?.privateOwnerId)}
              >
                <LabeledSelectTrigger aria-label="Responsável pelo contato" className="w-full">
                  {responsavel
                    ? nomeDaPessoa(responsavel) ?? (para?.privateOwnerId ? 'Dona do número' : 'Pessoa fora da lista')
                    : 'Sem responsável'}
                </LabeledSelectTrigger>
                <SelectContent>
                  {pessoas.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {para?.privateOwnerId ? (
                <p className="text-[11px] text-muted-foreground">
                  Número particular: o contato fica com {nomeDaPessoa(para.privateOwnerId) ?? 'a dona do número'}.
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="transferir-recado" className="text-xs">
                Recado para quem recebe (opcional)
              </Label>
              <Textarea
                id="transferir-recado"
                value={recado}
                onChange={(e) => setRecado(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Ex.: quer consulta em Londrina, prefere à tarde"
              />
            </div>

            {nadaMuda ? (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Esse contato já está nesse número e com essa pessoa. Escolha outro número ou outro responsável.
              </p>
            ) : (
              <ul className="m-0 grid list-disc gap-1 rounded-lg bg-muted/40 py-2 pl-7 pr-3 text-xs text-muted-foreground">
                {efeitos.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setAberto(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmar()} disabled={!para || nadaMuda || enviando}>
              {enviando ? 'Transferindo…' : 'Transferir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
