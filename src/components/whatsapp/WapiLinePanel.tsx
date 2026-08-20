import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { WhatsappChannelInstance } from '@/services/whatsappChannelInstances'
import { Textarea } from '@/components/ui/textarea'
import {
  fetchBlockedRecent,
  fetchLeadformConfig,
  fetchLineGuard,
  fetchLinePolicy,
  fetchOutreachFila,
  saveLeadformConfig,
  saveLinePolicy,
  wapiConnectionAction,
  type LeadformOutreachConfig,
  type OutreachFila,
  type WapiLineGuardRow,
  type WapiLinePolicy,
  type WapiOutboundLogRow,
} from '@/services/wapiConnection'

/**
 * Painel de uma linha W-API: conectar, apontar os webhooks e — a parte que importa — ver e
 * ajustar o que protege o número de ser banido.
 *
 * A W-API é API NÃO-oficial: a sessão é um WhatsApp comum a ser conduzido por fora. Isso muda
 * o pior caso. Na API da Meta, exagerar faz a mensagem ser recusada; aqui, faz o NÚMERO
 * morrer — e com ele a porta de entrada do comercial. Por isso este ecrã mostra, lado a lado,
 * o que já saiu hoje e o que a guarda recusou: teto que ninguém vê é teto que ninguém respeita.
 */

const MOTIVOS_PT: Record<string, string> = {
  linha_pausada: 'linha pausada',
  linha_banida: 'linha banida',
  sessao_caida: 'sessão caída',
  opt_out: 'pediu para parar',
  fora_da_janela: 'fora do horário',
  domingo: 'domingo',
  cap_proativo_dia: 'teto do dia',
  cap_proativo_hora: 'teto da hora',
  ritmo: 'muito rápido',
  texto_repetido: 'texto repetido',
  cap_semana_por_lead: 'já recebeu esta semana',
  cap_frio_dia: 'teto de contatos novos',
  link_primeiro_contato: 'link no 1.º contato',
  frio_max_tentativas: 'já tentámos demais',
  frio_espera: 'tentativa recente',
  numero_sem_whatsapp: 'número sem WhatsApp',
  numero_nao_verificado: 'número não confirmado',
  guarda_desligada: 'guarda desligada',
}

function saudeBadge(row: WapiLineGuardRow | null): { texto: string; classe: string } {
  const status = String(row?.health_status ?? 'unknown')
  if (row?.pausado_ate && new Date(row.pausado_ate).getTime() > Date.now()) {
    return { texto: 'Pausada', classe: 'border-amber-300 bg-amber-50 text-amber-900' }
  }
  if (status === 'connected') return { texto: 'No ar', classe: 'border-emerald-300 bg-emerald-50 text-emerald-900' }
  if (status === 'banned') return { texto: 'Banida', classe: 'border-red-300 bg-red-50 text-red-900' }
  if (status === 'disconnected') return { texto: 'Desconectada', classe: 'border-red-300 bg-red-50 text-red-900' }
  return { texto: 'Sem leitura', classe: 'border-border bg-muted text-muted-foreground' }
}

function Numero({ rotulo, valor, teto, alerta }: { rotulo: string; valor: number; teto?: number; alerta?: boolean }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      <p className="m-0 text-[0.7rem] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className={cn('m-0 text-lg font-semibold tabular-nums', alerta && 'text-amber-700')}>
        {valor}
        {typeof teto === 'number' ? <span className="text-sm font-normal text-muted-foreground"> / {teto}</span> : null}
      </p>
    </div>
  )
}

export function WapiLinePanel({ instance }: { instance: WhatsappChannelInstance }) {
  const [guard, setGuard] = useState<WapiLineGuardRow | null>(null)
  const [policy, setPolicy] = useState<WapiLinePolicy | null>(null)
  const [bloqueios, setBloqueios] = useState<WapiOutboundLogRow[]>([])
  const [fila, setFila] = useState<OutreachFila | null>(null)
  const [leadform, setLeadform] = useState<LeadformOutreachConfig | null>(null)
  const [salvandoLeadform, setSalvandoLeadform] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [acao, setAcao] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [pairPhone, setPairPhone] = useState(instance.phoneE164?.replace(/\D/g, '') ?? '')
  const [pairCode, setPairCode] = useState('')
  const [testePhone, setTestePhone] = useState('')
  const [salvandoPolitica, setSalvandoPolitica] = useState(false)

  const webhookBase = (import.meta.env.VITE_SUPABASE_URL ?? '<SUPABASE_URL>').replace(/\/$/, '')
  const urlRecebidas = `${webhookBase}/functions/v1/crm-wapi-webhook`
  const urlEventos = `${webhookBase}/functions/v1/crm-wapi-events`

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      const [g, p, b, f, lf] = await Promise.all([
        fetchLineGuard(instance.id),
        fetchLinePolicy(instance.id),
        fetchBlockedRecent(instance.id),
        fetchOutreachFila(instance.id),
        instance.tenantId ? fetchLeadformConfig(instance.tenantId) : Promise.resolve(null),
      ])
      setGuard(g)
      setPolicy(p)
      setBloqueios(b)
      setFila(f)
      setLeadform(lf)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler a guarda desta linha.')
    } finally {
      setCarregando(false)
    }
  }, [instance.id])

  useEffect(() => {
    setQr('')
    setPairCode('')
    void carregar()
  }, [carregar, instance.tenantId])

  const guardarLeadform = async () => {
    if (!leadform || !instance.tenantId) return
    setSalvandoLeadform(true)
    try {
      await saveLeadformConfig(instance.tenantId, leadform)
      toast.success('Primeiro contato salvo. Vale para quem entrar na fila a partir de agora.')
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSalvandoLeadform(false)
    }
  }

  const executar = async (
    nome: string,
    fn: () => Promise<{ ok: boolean; message?: string; error?: string }>,
    sucesso?: string,
  ) => {
    setAcao(nome)
    try {
      const res = await fn()
      if (res.ok) toast.success(res.message || sucesso || 'Pronto.')
      else toast.error(res.message || res.error || 'Não deu certo.')
      return res
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro inesperado.')
      return { ok: false }
    } finally {
      setAcao(null)
      void carregar()
    }
  }

  const badge = useMemo(() => saudeBadge(guard), [guard])
  const pausada = Boolean(guard?.pausado_ate && new Date(guard.pausado_ate).getTime() > Date.now())

  const emAquecimento = useMemo(() => {
    if (!guard?.aquecimento_inicio) return null
    const dias = Math.floor((Date.now() - new Date(guard.aquecimento_inicio).getTime()) / 86_400_000)
    if (dias >= (guard.aquecimento_dias ?? 14)) return null
    return { dia: dias + 1, total: guard.aquecimento_dias ?? 14 }
  }, [guard])

  const patch = (p: Partial<WapiLinePolicy>) => setPolicy((cur) => (cur ? { ...cur, ...p } : cur))

  const guardarPolitica = async () => {
    if (!policy) return
    setSalvandoPolitica(true)
    try {
      await saveLinePolicy({ ...policy, instance_id: instance.id })
      toast.success('Limites salvos. Valem no próximo envio, sem deploy.')
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
    } finally {
      setSalvandoPolitica(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Conexão ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Conexão da linha · {instance.label}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={badge.classe}>
                {badge.texto}
              </Badge>
              <Badge variant="outline" className="border-violet-300 bg-violet-50 text-violet-900">
                W-API
              </Badge>
            </div>
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            instanceId <span className="font-mono">{instance.wapiInstanceId ?? '—'}</span>
            {guard?.last_event_at ? ` · última leitura ${new Date(guard.last_event_at).toLocaleString('pt-BR')}` : null}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acao !== null}
              onClick={() =>
                void executar('status', () => wapiConnectionAction('status', { instanceId: instance.id }))
              }
            >
              {acao === 'status' ? 'A ler…' : 'Ver estado'}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={acao !== null}
              onClick={async () => {
                setAcao('qrcode')
                const res = await wapiConnectionAction('qrcode', { instanceId: instance.id })
                setAcao(null)
                if (res.qrCode) {
                  setQr(res.qrCode)
                  toast.success(res.message || 'QR gerado.')
                } else {
                  toast.error(res.message || res.error || 'A W-API não devolveu QR.')
                }
              }}
            >
              {acao === 'qrcode' ? 'A gerar…' : 'Gerar QR code'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={acao !== null}
              onClick={() =>
                void executar(
                  'webhooks',
                  () => wapiConnectionAction('configure_webhooks', { instanceId: instance.id }),
                  'Webhooks apontados para o CRM.',
                )
              }
            >
              {acao === 'webhooks' ? 'A apontar…' : 'Apontar webhooks para o CRM'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acao !== null}
              onClick={() => void executar('restart', () => wapiConnectionAction('restart', { instanceId: instance.id }), 'Instância reiniciada.')}
            >
              Reiniciar
            </Button>
          </div>

          {qr ? (
            <div className="flex flex-col items-start gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR code da W-API"
                className="h-56 w-56 rounded bg-white p-2"
              />
              <p className="m-0 text-xs text-muted-foreground">
                No telemóvel: WhatsApp → Aparelhos ligados → Ligar um aparelho. O código expira depressa; se falhar,
                gere outro.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="wapi-pair">Ligar por código, sem QR (número com país e DDD)</Label>
              <Input
                id="wapi-pair"
                value={pairPhone}
                onChange={(e) => setPairPhone(e.target.value)}
                placeholder="5544999999999"
                className="font-mono text-xs"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={acao !== null}
                onClick={async () => {
                  setAcao('pair')
                  const res = await wapiConnectionAction('pairing_code', { instanceId: instance.id, phone: pairPhone })
                  setAcao(null)
                  if (res.code) {
                    setPairCode(res.code)
                    toast.success('Código gerado. Digite-o no telemóvel.')
                  } else {
                    toast.error(res.message || res.error || 'Não veio código.')
                  }
                }}
              >
                Gerar código
              </Button>
            </div>
          </div>
          {pairCode ? (
            <p className="m-0 font-mono text-lg tracking-widest">{pairCode}</p>
          ) : null}

          <Separator />

          <div className="space-y-2">
            <p className="m-0 text-xs font-medium">Endereços que o botão acima configura (se preferir colar à mão):</p>
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-[0.7rem] break-all">
              <p className="m-0">Mensagens recebidas → {urlRecebidas}</p>
              <p className="m-0">Conectou / desconectou / status → {urlEventos}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Guarda anti-ban ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Proteção do número</CardTitle>
          <p className="m-0 text-xs text-muted-foreground">
            Resposta a quem escreveu sai sempre, a qualquer hora, sem teto. O que está limitado aqui é a mensagem
            que a pessoa não pediu — e é ela que derruba linha não-oficial.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Numero rotulo="Respostas hoje" valor={guard?.respostas_hoje ?? 0} />
            <Numero
              rotulo="Proativos hoje"
              valor={guard?.proativos_hoje ?? 0}
              teto={guard?.cap_proativo_dia}
              alerta={(guard?.proativos_hoje ?? 0) >= (guard?.cap_proativo_dia ?? 60) * 0.8}
            />
            <Numero
              rotulo="Contatos novos"
              valor={guard?.frios_hoje ?? 0}
              teto={guard?.cap_frio_dia}
              alerta={(guard?.frios_hoje ?? 0) >= (guard?.cap_frio_dia ?? 20) * 0.8}
            />
            <Numero rotulo="Na última hora" valor={guard?.proativos_1h ?? 0} teto={guard?.cap_proativo_hora} />
            <Numero rotulo="Recusados hoje" valor={guard?.bloqueados_hoje ?? 0} />
          </div>

          {emAquecimento ? (
            <p className="m-0 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              Linha em aquecimento: dia {emAquecimento.dia} de {emAquecimento.total}. O teto de contatos novos sobe
              sozinho a cada dia — número que troca de provedor volta a ser um desconhecido para a plataforma, mesmo
              já estando aquecido no aparelho.
            </p>
          ) : null}

          {pausada ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>
                Pausada até {new Date(guard!.pausado_ate!).toLocaleString('pt-BR')}
                {guard?.pausa_motivo ? ` · ${guard.pausa_motivo}` : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={acao !== null}
                onClick={() => void executar('resume', () => wapiConnectionAction('resume', { instanceId: instance.id }), 'Linha retomada.')}
              >
                Retomar envios
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              disabled={acao !== null}
              onClick={() =>
                void executar(
                  'pause',
                  () =>
                    wapiConnectionAction('pause', {
                      instanceId: instance.id,
                      minutes: 120,
                      reason: 'pausa manual pelo painel',
                    }),
                  'Linha pausada por 2 horas. Nada sai por ela.',
                )
              }
            >
              Parar tudo por 2 horas
            </Button>
          )}

          {policy ? (
            <>
              <Separator />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="pol-frio">Contatos novos por dia</Label>
                  <Input
                    id="pol-frio"
                    type="number"
                    min={0}
                    value={policy.cap_frio_dia}
                    onChange={(e) => patch({ cap_frio_dia: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-proativo">Proativos por dia</Label>
                  <Input
                    id="pol-proativo"
                    type="number"
                    min={0}
                    value={policy.cap_proativo_dia}
                    onChange={(e) => patch({ cap_proativo_dia: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-hora">Proativos por hora</Label>
                  <Input
                    id="pol-hora"
                    type="number"
                    min={0}
                    value={policy.cap_proativo_hora}
                    onChange={(e) => patch({ cap_proativo_hora: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-gap">Intervalo mínimo (s)</Label>
                  <Input
                    id="pol-gap"
                    type="number"
                    min={0}
                    value={policy.gap_min_segundos}
                    onChange={(e) => patch({ gap_min_segundos: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-ini">Janela: início</Label>
                  <Input
                    id="pol-ini"
                    type="number"
                    min={0}
                    max={23}
                    value={policy.janela_inicio}
                    onChange={(e) => patch({ janela_inicio: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-fim">Janela: fim</Label>
                  <Input
                    id="pol-fim"
                    type="number"
                    min={1}
                    max={24}
                    value={policy.janela_fim}
                    onChange={(e) => patch({ janela_fim: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-semana">Proativos por pessoa / semana</Label>
                  <Input
                    id="pol-semana"
                    type="number"
                    min={0}
                    value={policy.cap_proativo_semana_por_lead}
                    onChange={(e) => patch({ cap_proativo_semana_por_lead: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-espera">Espera entre tentativas (dias)</Label>
                  <Input
                    id="pol-espera"
                    type="number"
                    min={0}
                    value={policy.frio_espera_dias}
                    onChange={(e) => patch({ frio_espera_dias: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Guarda ligada
                    <span className="block text-xs text-muted-foreground">
                      Desligar não libera geral: passa a sair só resposta dentro da conversa.
                    </span>
                  </span>
                  <Switch checked={policy.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Sem link na primeira mensagem
                    <span className="block text-xs text-muted-foreground">
                      Link para quem nunca falou com a gente é o sinal de spam mais barato de evitar.
                    </span>
                  </span>
                  <Switch
                    checked={policy.bloqueia_link_primeiro_contato}
                    onCheckedChange={(v) => patch({ bloqueia_link_primeiro_contato: v })}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Proativo aos domingos
                    <span className="block text-xs text-muted-foreground">Resposta a quem escreve não é afetada.</span>
                  </span>
                  <Switch checked={policy.permite_domingo} onCheckedChange={(v) => patch({ permite_domingo: v })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    Em aquecimento
                    <span className="block text-xs text-muted-foreground">
                      Liga a rampa de {policy.aquecimento_dias} dias a partir de hoje. Ligue ao trocar o número de
                      provedor.
                    </span>
                  </span>
                  <Switch
                    checked={Boolean(policy.aquecimento_inicio)}
                    onCheckedChange={(v) => patch({ aquecimento_inicio: v ? new Date().toISOString() : null })}
                  />
                </label>
              </div>

              <Button type="button" size="sm" disabled={salvandoPolitica} onClick={() => void guardarPolitica()}>
                {salvandoPolitica ? 'A salvar…' : 'Salvar limites'}
              </Button>
            </>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              {carregando ? 'A carregar…' : 'Sem política nesta linha: a guarda usa os valores padrão.'}
            </p>
          )}

          {bloqueios.length > 0 ? (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="m-0 text-xs font-medium">Últimas recusas da guarda</p>
                <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground">
                  {bloqueios.map((b) => (
                    <li key={b.id} className="flex flex-wrap gap-2">
                      <span className="tabular-nums">{new Date(b.created_at).toLocaleString('pt-BR')}</span>
                      <span className="font-mono">{b.phone}</span>
                      <span>{MOTIVOS_PT[b.reason ?? ''] ?? b.reason ?? '—'}</span>
                      {b.source ? <span className="opacity-70">({b.source})</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Primeiro contato automático (o que o ManyChat fazia) ─────────────── */}
      <Card>
        <CardHeader className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Primeiro contato com quem preenche o formulário</CardTitle>
            {leadform?.enabled ? (
              <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-900">
                Ligado
              </Badge>
            ) : (
              <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                Desligado
              </Badge>
            )}
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            Todo lead de formulário entra na fila no instante em que preenche. Sair da fila é que depende da hora,
            do intervalo e do teto do dia: assim ninguém fica sem contato, e o número não leva rajada.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-4">
            <Numero rotulo="Na fila" valor={fila?.na_fila ?? 0} />
            <Numero rotulo="Prontos agora" valor={fila?.prontos_agora ?? 0} />
            <Numero rotulo="Chamados hoje" valor={fila?.enviados_hoje ?? 0} />
            <Numero rotulo="Recusados hoje" valor={fila?.recusados_hoje ?? 0} alerta={(fila?.recusados_hoje ?? 0) > 0} />
          </div>
          {fila?.proximo_em ? (
            <p className="m-0 text-xs text-muted-foreground">
              Próximo sai por volta de {new Date(fila.proximo_em).toLocaleString('pt-BR')}.
            </p>
          ) : null}

          {leadform ? (
            <>
              <label className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                <span>
                  Chamar automaticamente
                  <span className="block text-xs text-muted-foreground">
                    Desligado, o lead ainda entra no CRM e a equipe é avisada — só ninguém escreve sozinho.
                  </span>
                </span>
                <Switch
                  checked={leadform.enabled}
                  onCheckedChange={(v) => setLeadform({ ...leadform, enabled: v })}
                />
              </label>

              <div className="space-y-1.5">
                <Label htmlFor="lf-msg">Mensagem de apresentação</Label>
                <Textarea
                  id="lf-msg"
                  rows={4}
                  value={leadform.message}
                  onChange={(e) => setLeadform({ ...leadform, message: e.target.value })}
                  placeholder="Oi, {{primeiro_nome}}! Aqui é a Sofia…"
                  className="min-h-[96px] text-sm"
                />
                <p className="m-0 text-[0.7rem] text-muted-foreground">
                  <span className="font-mono">{'{{primeiro_nome}}'}</span> e{' '}
                  <span className="font-mono">{'{{nome}}'}</span> são trocados pelo nome da pessoa. Sem link nesta
                  mensagem: link para quem ainda não sabe quem você é é o sinal de spam mais caro e mais fácil de
                  evitar. A resposta dela abre a conversa, e daí a Sofia segue normalmente.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lf-idade">Vale por quantas horas</Label>
                  <Input
                    id="lf-idade"
                    type="number"
                    min={1}
                    value={leadform.max_age_hours}
                    onChange={(e) => setLeadform({ ...leadform, max_age_hours: Number(e.target.value) || 48 })}
                  />
                  <p className="m-0 text-[0.7rem] text-muted-foreground">
                    Formulário mais velho que isto vira abordagem a estranho, e passa a valer a regra de contato novo.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pol-optin">Primeiros contatos por dia</Label>
                  <Input
                    id="pol-optin"
                    type="number"
                    min={0}
                    value={policy?.cap_optin_dia ?? 40}
                    onChange={(e) => patch({ cap_optin_dia: Number(e.target.value) || 0 })}
                  />
                  <p className="m-0 text-[0.7rem] text-muted-foreground">
                    Salvo no botão "Salvar limites", acima. O que passar do teto espera na fila até amanhã.
                  </p>
                </div>
                <div className="flex items-end">
                  <Button type="button" size="sm" disabled={salvandoLeadform} onClick={() => void guardarLeadform()}>
                    {salvandoLeadform ? 'A salvar…' : 'Salvar primeiro contato'}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="m-0 text-xs text-muted-foreground">
              {carregando ? 'A carregar…' : 'Sem polo definido nesta linha: não dá para configurar o primeiro contato.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Blindagens da instância + teste de número ────────────────────────── */}
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">Ajustes do aparelho</CardTitle>
          <p className="m-0 text-xs text-muted-foreground">
            Cada opção tem um preço, por isso nenhuma é ligada sozinha: ignorar grupos desliga o registo do grupo de
            comprovantes, e a leitura automática esconde o "não lido" de quem também usa o WhatsApp Web deste número.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acao !== null}
              onClick={() =>
                void executar(
                  'reject',
                  () =>
                    wapiConnectionAction('apply_settings', {
                      instanceId: instance.id,
                      settings: {
                        rejeitarLigacoes: true,
                        mensagemLigacao: 'Oi! Não conseguimos atender ligações por aqui — me escreve que eu respondo já. 💬',
                      },
                    }),
                  'Ligações passam a ser recusadas com aviso.',
                )
              }
            >
              Recusar ligações com aviso
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acao !== null}
              onClick={() =>
                void executar(
                  'grupos',
                  () => wapiConnectionAction('apply_settings', { instanceId: instance.id, settings: { ignorarGrupos: true } }),
                  'Eventos de grupo passam a ser ignorados.',
                )
              }
            >
              Ignorar grupos
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acao !== null}
              onClick={() =>
                void executar(
                  'leitura',
                  () =>
                    wapiConnectionAction('apply_settings', {
                      instanceId: instance.id,
                      settings: { leituraAutomatica: true },
                    }),
                  'Mensagens recebidas passam a ser marcadas como lidas.',
                )
              }
            >
              Marcar recebidas como lidas
            </Button>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="wapi-teste">Este número tem WhatsApp?</Label>
              <Input
                id="wapi-teste"
                value={testePhone}
                onChange={(e) => setTestePhone(e.target.value)}
                placeholder="5544999999999"
                className="font-mono text-xs"
              />
              <p className="m-0 text-[0.7rem] text-muted-foreground">
                A guarda já faz esta pergunta sozinha antes de qualquer primeiro contato — bater em número que não
                existe é o que denuncia lista comprada.
              </p>
            </div>
            <div className="flex items-start pt-6">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={acao !== null}
                onClick={() =>
                  void executar('check', () =>
                    wapiConnectionAction('check_number', { instanceId: instance.id, phone: testePhone }),
                  )
                }
              >
                Conferir
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
