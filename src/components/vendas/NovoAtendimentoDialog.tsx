import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import {
  type IndicacaoAtendimento,
  type TipoAtendimento,
  registrarAtendimento,
} from '@/services/atendimentos'

/**
 * "Encontrássemos uma forma de eu colocar os atendimentos que foram indicados transplante,
 * exemplo como eu faço hoje na planilha" — Aline, 08/set.
 *
 * Os campos são as colunas da planilha dela, na mesma ordem em que ela digita: de onde veio,
 * quem é, onde mora, como falar, e o atendimento (consulta ou retorno, quando, com quem).
 * O que a planilha não tem e é obrigatório aqui: a data do primeiro contato. Atendimento sem
 * data de contato é a linha que a planilha da Ingrid tem às centenas e ninguém trabalha.
 */

/** O que aparece escrito na coluna de origem da planilha dela, virado em atalho. */
const ORIGENS = ['Indicação', 'Já é paciente', 'Instagram', 'Google', 'Facebook', 'Site']

const vazio = (indicacao: IndicacaoAtendimento) => ({
  paciente: '',
  telefone: '',
  cidade: '',
  email: '',
  origem: '',
  tipo: 'consulta' as TipoAtendimento,
  indicacao,
  atendidoEm: hojeLocal(),
  medico: '',
  observacao: '',
  primeiroContatoEm: diaLocalComOffset(1),
})

export function NovoAtendimentoDialog({
  aberto,
  indicacao,
  tenantId,
  ownerId,
  usuarioId,
  onFechar,
  onSalvo,
}: {
  aberto: boolean
  indicacao: IndicacaoAtendimento
  tenantId: string
  ownerId: string
  usuarioId?: string | null
  onFechar: () => void
  onSalvo: () => void
}) {
  // Abriu do filtro de protocolo, o atendimento nasce de protocolo — chutar "transplante"
  // jogaria o paciente na safra da outra consultora. O estado nasce certo porque quem
  // chama só monta o diálogo quando ele abre; não há efeito de reset para esquecer.
  const [form, setForm] = useState(() => vazio(indicacao))
  const [salvando, setSalvando] = useState(false)

  const campo = <K extends keyof ReturnType<typeof vazio>>(
    k: K,
    v: ReturnType<typeof vazio>[K],
  ) => setForm((f) => ({ ...f, [k]: v }))

  const salvar = async () => {
    if (!form.paciente.trim()) {
      toast.error('Escreva o nome do paciente.')
      return
    }
    setSalvando(true)
    try {
      const { pacienteNovo } = await registrarAtendimento({
        tenantId,
        ownerId,
        usuarioId,
        paciente: form.paciente,
        telefone: form.telefone,
        cidade: form.cidade,
        email: form.email,
        origem: form.origem,
        tipo: form.tipo,
        indicacao: form.indicacao,
        atendidoEm: form.atendidoEm,
        medico: form.medico,
        observacao: form.observacao,
        primeiroContatoEm: form.primeiroContatoEm,
      })
      toast.success(
        pacienteNovo
          ? `${form.paciente.trim()} entrou em Atendimentos. O card do paciente foi criado.`
          : `${form.paciente.trim()} entrou em Atendimentos, no card que já existia.`,
      )
      onSalvo()
      onFechar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar o atendimento')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open ? onFechar() : null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo atendimento</DialogTitle>
          <DialogDescription>
            Consulta ou retorno em que o médico indicou{' '}
            {form.indicacao === 'protocolo' ? 'protocolo' : 'transplante'}. Entra na coluna
            "Atendimentos" e conta na safra da semana.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Paciente</Label>
              <Input
                value={form.paciente}
                onChange={(e) => campo('paciente', e.target.value)}
                placeholder="Nome completo"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Telefone</Label>
              <Input
                value={form.telefone}
                onChange={(e) => campo('telefone', e.target.value)}
                placeholder="(44) 99999-9999"
              />
              <p className="text-xs text-muted-foreground">
                É por ele que o sistema acha o paciente que já existe, para não abrir card
                repetido.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Cidade</Label>
              <Input value={form.cidade} onChange={(e) => campo('cidade', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => campo('email', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Como chegou</Label>
              <Input
                value={form.origem}
                onChange={(e) => campo('origem', e.target.value)}
                list="atendimento-origens"
                placeholder="Indicação, Instagram, já é paciente…"
              />
              <datalist id="atendimento-origens">
                {ORIGENS.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={form.tipo}
                onValueChange={(v) => campo('tipo', String(v) as TipoAtendimento)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consulta">Consulta</SelectItem>
                  <SelectItem value="retorno">Retorno</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Indicação</Label>
              <Select
                value={form.indicacao}
                onValueChange={(v) => campo('indicacao', String(v) as IndicacaoAtendimento)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cirurgia">Transplante</SelectItem>
                  <SelectItem value="protocolo">Protocolo e spa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data do atendimento</Label>
              <Input
                type="date"
                value={form.atendidoEm}
                max={hojeLocal()}
                onChange={(e) => campo('atendidoEm', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Médico</Label>
              <Input
                value={form.medico}
                onChange={(e) => campo('medico', e.target.value)}
                placeholder="Dra Lorena"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea
              value={form.observacao}
              onChange={(e) => campo('observacao', e.target.value)}
              placeholder="O que ficou combinado no atendimento"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Primeiro contato em</Label>
            <Input
              type="date"
              value={form.primeiroContatoEm}
              min={hojeLocal()}
              onChange={(e) => campo('primeiroContatoEm', e.target.value)}
              className="w-44"
            />
            <p className="text-xs text-muted-foreground">
              O card fica em "Atendimentos" até você registrar esse contato.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Registrar atendimento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
