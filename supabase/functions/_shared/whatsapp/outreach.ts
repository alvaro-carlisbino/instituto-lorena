import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { resolveOutboundProviderForLead } from './resolveProvider.ts'
import { horaLocal, loadLinePolicy } from './antiBan.ts'
import { insertInteraction } from '../crm.ts'
import { fimDoTurno, isWithinTeamHours, parseTeamHours, type TeamHoursSchedule } from '../teamHours.ts'

/**
 * Fila de PRIMEIRO CONTATO — o que o ManyChat fazia com template aprovado, agora pela
 * linha da casa.
 *
 * Duas perguntas separadas, de propósito:
 *   • "temos de falar com esta pessoa?" — sim, sempre, no instante em que ela preenche o
 *     formulário. É `enqueueOutreach`, e ela nunca recusa nada por causa de horário ou teto.
 *   • "podemos falar AGORA?" — é a guarda anti-ban, no momento de drenar a fila.
 *
 * Assim nenhum lead se perde por ter chegado às 23h ou por ter chegado em oito de uma vez:
 * ele sai na primeira janela boa, no ritmo de gente. O contrário — mandar tudo na hora —
 * é o que mata linha não-oficial, e linha morta não fala com lead nenhum.
 */

export type OutreachItem = {
  id: string
  tenant_id: string
  instance_id: string | null
  lead_id: string | null
  phone: string
  message: string
  kind: string
  source: string
  status: string
  scheduled_at: string
  attempts: number
  created_at: string
}

export type LeadformOutreachConfig = {
  enabled: boolean
  message: string
  maxAgeHours: number
}

const MENSAGEM_PADRAO =
  'Oi, {{primeiro_nome}}! Aqui é a Sofia, do Instituto Lorena. Vi que você deixou seu contato para saber ' +
  'mais sobre o tratamento capilar. Posso te explicar como funciona a avaliação?'

/** Config do primeiro contato do polo (tenant_integrations.outreach.leadform). */
export async function loadLeadformOutreachConfig(
  admin: SupabaseClient,
  tenantId: string,
): Promise<LeadformOutreachConfig> {
  try {
    const { data } = await admin
      .from('tenant_integrations')
      .select('outreach')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const cfg = (((data as { outreach?: Record<string, unknown> } | null)?.outreach ?? {}) as Record<string, unknown>)
    const lf = (cfg.leadform ?? {}) as { enabled?: boolean; message?: string; max_age_hours?: number }
    return {
      enabled: lf.enabled === true,
      message: String(lf.message ?? '').trim() || MENSAGEM_PADRAO,
      maxAgeHours: Number(lf.max_age_hours) > 0 ? Number(lf.max_age_hours) : 48,
    }
  } catch {
    return { enabled: false, message: MENSAGEM_PADRAO, maxAgeHours: 48 }
  }
}

export function renderMensagem(template: string, nome: string): string {
  const limpo = String(nome ?? '').trim()
  const primeiro = limpo.split(/\s+/)[0] || 'tudo bem'
  return template
    .replaceAll('{{primeiro_nome}}', primeiro)
    .replaceAll('{{nome}}', limpo || primeiro)
    .trim()
}

/**
 * Primeiro instante em que faz sentido tentar: agora, se estivermos dentro da janela;
 * senão, a abertura da próxima janela. Agendar para "agora" às 3h só encheria a fila de
 * tentativas recusadas e apagaria a informação de quando a mensagem realmente deve sair.
 */
export function proximaJanela(
  janelaInicio: number,
  janelaFim: number,
  permiteDomingo: boolean,
  agora: Date = new Date(),
): Date {
  const { hora, diaSemana } = horaLocal(agora)
  const dentroDoHorario = hora >= janelaInicio && hora < janelaFim
  const diaOk = permiteDomingo || diaSemana !== 0
  if (dentroDoHorario && diaOk) return agora

  // Próxima abertura: hoje se ainda não abriu, senão amanhã (pulando domingo se for o caso).
  const alvo = new Date(agora.getTime())
  let saltos = 0
  do {
    if (hora >= janelaFim || saltos > 0) alvo.setTime(alvo.getTime() + 86_400_000)
    const { diaSemana: d } = horaLocal(alvo)
    if (permiteDomingo || d !== 0) break
    saltos++
  } while (saltos < 8)

  const { diaIso } = horaLocal(alvo)
  const hh = String(Math.max(0, Math.min(23, janelaInicio))).padStart(2, '0')
  // Um empurrãozinho aleatório de até 20 minutos: a fila inteira abrindo às 08:00:00 em
  // ponto, todo dia, é um padrão que não parece gente.
  return new Date(new Date(`${diaIso}T${hh}:00:00-03:00`).getTime() + Math.floor(Math.random() * 20 * 60_000))
}

/**
 * O primeiro contato da Sofia espera a equipe? (11/09/2026)
 *
 * Com `ai_offhours_only` ligado e `ai_first_touch_in_team_hours` desligado, quem abre conversa
 * dentro do turno é a equipe. A apresentação da fila só sai no plantão da IA, e só se ninguém
 * da casa tiver falado com a pessoa até lá. Pedido da clínica: IA ativa de segunda a sexta das
 * 18h às 8h (na segunda, até as 7h) e do sábado ao meio-dia até segunda às 7h, valendo para o
 * primeiro contato; follow-up segue como está.
 */
export type PrimeiroContatoTurno = { esperaEquipe: boolean; schedule: TeamHoursSchedule }

export async function loadPrimeiroContatoTurno(
  admin: SupabaseClient,
  tenantId: string,
): Promise<PrimeiroContatoTurno> {
  try {
    const { data } = await admin
      .from('crm_ai_configs')
      .select('ai_offhours_only, ai_team_hours, ai_first_touch_in_team_hours')
      .eq('id', 'default')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const cfg = (data ?? {}) as {
      ai_offhours_only?: boolean | null
      ai_team_hours?: unknown
      ai_first_touch_in_team_hours?: boolean | null
    }
    return {
      esperaEquipe: cfg.ai_offhours_only === true && cfg.ai_first_touch_in_team_hours === false,
      schedule: parseTeamHours(cfg.ai_team_hours),
    }
  } catch {
    // Sem config legível a fila faz o que sempre fez: segurar lead por erro de leitura seria
    // perder primeiro contato em silêncio.
    return { esperaEquipe: false, schedule: parseTeamHours(null) }
  }
}

/**
 * Primeiro instante em que a Sofia pode abrir conversa: dentro da janela da linha E, quando o
 * polo quer a equipe primeiro, fora do turno. As duas grades se cruzam (o turno acaba às 18h,
 * a janela da linha fecha às 20h e reabre às 8h já dentro do turno), então anda de uma para a
 * outra até achar um instante que as duas aceitam.
 */
export function proximaAberturaDaSofia(
  janela: { janelaInicio: number; janelaFim: number; permiteDomingo: boolean },
  turno: PrimeiroContatoTurno,
  agora: Date = new Date(),
): Date {
  let alvo = proximaJanela(janela.janelaInicio, janela.janelaFim, janela.permiteDomingo, agora)
  if (!turno.esperaEquipe) return alvo
  for (let volta = 0; volta < 20; volta++) {
    const fim = fimDoTurno(alvo, turno.schedule)
    if (!fim) return alvo
    // O mesmo empurrão da janela: a fila inteira saindo às 18:00:00 em ponto não parece gente.
    const depois = new Date(fim.getTime() + Math.floor(Math.random() * 20 * 60_000))
    alvo = proximaJanela(janela.janelaInicio, janela.janelaFim, janela.permiteDomingo, depois)
  }
  return alvo
}

/**
 * Põe um primeiro contato na fila. Idempotente por (lead, kind) enquanto pendente ou já
 * enviado — o webhook ao vivo e a varredura de 30 em 30 minutos veem o mesmo lead, e a
 * pessoa não pode receber a mesma apresentação duas vezes.
 */
export async function enqueueOutreach(
  admin: SupabaseClient,
  input: {
    tenantId: string
    leadId: string
    phone: string
    message: string
    kind?: string
    source?: string
    instanceId?: string | null
    /**
     * Janela, em dias, que define "conversa aberta". Sem ela, QUALQUER mensagem
     * que a pessoa já tenha mandado um dia bloqueia o contato para sempre.
     */
    conversaRecenteDias?: number
    /**
     * Manda mesmo com conversa aberta. Decisão do Álvaro em 26/08/2026 para o
     * formulário: preencher formulário é PEDIR contato, e o pedido não pode
     * ficar sem resposta porque a pessoa falou com a casa outro dia. O que
     * impede repetição não é esta guarda, é o índice único (lead, kind): cada
     * lead recebe a apresentação UMA vez na vida. Opt-out continua valendo.
     */
    ignorarConversaAberta?: boolean
  },
): Promise<{ ok: boolean; queued: boolean; reason?: string; scheduledAt?: string }> {
  const phone = String(input.phone ?? '').replace(/[^0-9]/g, '')
  if (phone.length < 12) return { ok: false, queued: false, reason: 'telefone_invalido' }
  const kind = input.kind ?? 'optin'

  try {
    // Já falou com a gente? Então não é primeiro contato: a conversa está aberta e quem
    // responde é o atendimento (ou a IA), não a fila.
    let q = admin
      .from('interactions')
      .select('id')
      .eq('lead_id', input.leadId)
      .eq('direction', 'in')
      .eq('channel', 'whatsapp')
    if (Number(input.conversaRecenteDias) > 0) {
      const desde = new Date(Date.now() - Number(input.conversaRecenteDias) * 864e5).toISOString()
      q = q.gte('created_at', desde)
    }
    const { data: jaEscreveu } = input.ignorarConversaAberta ? { data: null } : await q.limit(1).maybeSingle()
    if (jaEscreveu) return { ok: true, queued: false, reason: 'ja_conversa' }

    const { data: lead } = await admin
      .from('leads')
      .select('opted_out_at, whatsapp_instance_id, tenant_id')
      .eq('id', input.leadId)
      .maybeSingle()
    if ((lead as { opted_out_at?: string | null } | null)?.opted_out_at) {
      return { ok: true, queued: false, reason: 'opt_out' }
    }

    // Linha de saída do polo: a mesma que responderia esta pessoa.
    let instanceId = input.instanceId ?? null
    if (!instanceId) {
      const { data: linha } = await admin
        .from('whatsapp_channel_instances')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle()
      instanceId = (linha as { id?: string } | null)?.id ?? null
    }
    if (!instanceId) return { ok: false, queued: false, reason: 'sem_linha_ativa' }

    const policy = await loadLinePolicy(admin, instanceId, input.tenantId)
    // Janela da linha e, se o polo quer a equipe primeiro, o fim do turno (11/09/2026).
    const turno = await loadPrimeiroContatoTurno(admin, input.tenantId)
    const quando = proximaAberturaDaSofia(
      { janelaInicio: policy.janela_inicio, janelaFim: policy.janela_fim, permiteDomingo: policy.permite_domingo },
      turno,
    )

    const { error } = await admin.from('whatsapp_outreach_queue').insert({
      tenant_id: input.tenantId,
      instance_id: instanceId,
      lead_id: input.leadId,
      phone,
      message: input.message.trim(),
      kind,
      source: input.source ?? 'leadform',
      scheduled_at: quando.toISOString(),
    })
    if (error) {
      // 23505 = já existe um pendente/enviado para este lead. É o comportamento desejado.
      if (String(error.code) === '23505') return { ok: true, queued: false, reason: 'ja_na_fila' }
      return { ok: false, queued: false, reason: error.message }
    }
    return { ok: true, queued: true, scheduledAt: quando.toISOString() }
  } catch (e) {
    return { ok: false, queued: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

export type DrainResult = {
  processados: number
  enviados: number
  reagendados: number
  recusados: number
  detalhes: Array<{ id: string; lead_id: string | null; resultado: string; motivo?: string }>
}

/**
 * Drena a fila respeitando a guarda. Sai pouco de cada vez, de propósito: quem impõe o
 * ritmo é o intervalo mínimo entre proativos, e chamar isto a cada minuto entrega ~1
 * mensagem por minuto no melhor caso — que é a cadência de uma pessoa atendendo.
 */
export async function drainOutreachQueue(
  admin: SupabaseClient,
  opts?: { max?: number; tenantId?: string },
): Promise<DrainResult> {
  const max = Math.max(1, Math.min(20, opts?.max ?? 3))
  const out: DrainResult = { processados: 0, enviados: 0, reagendados: 0, recusados: 0, detalhes: [] }

  let q = admin
    .from('whatsapp_outreach_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(max)
  if (opts?.tenantId) q = q.eq('tenant_id', opts.tenantId)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  const itens = (data as OutreachItem[] | null) ?? []

  // Turno de cada polo, lido uma vez por volta: a fila mistura polos e a config não muda no meio.
  const turnos = new Map<string, PrimeiroContatoTurno>()
  const turnoDoPolo = async (tenantId: string): Promise<PrimeiroContatoTurno> => {
    const lido = turnos.get(tenantId)
    if (lido) return lido
    const novo = await loadPrimeiroContatoTurno(admin, tenantId)
    turnos.set(tenantId, novo)
    return novo
  }

  for (const item of itens) {
    out.processados++
    const marcar = async (patch: Record<string, unknown>) => {
      await admin
        .from('whatsapp_outreach_queue')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', item.id)
    }

    try {
      // A pessoa pode ter escrito ENQUANTO ESPERAVA na fila. Aí a apresentação perdeu o
      // sentido: quem fala com ela é o atendimento, e mandar o texto pronto por cima é o
      // robô atropelando a conversa.
      //
      // O CORTE MUDA CONFORME A ORIGEM, e a diferença é deliberada:
      //
      // - formulário recém-preenchido: só cancela se a pessoa escreveu DEPOIS de entrar
      //   na fila. Preencher formulário é pedir contato, e o pedido não pode morrer
      //   porque a pessoa mandou uma mensagem meses atrás (decisão do Álvaro, 26/08/2026);
      // - todo o resto (backlog, carrinho, reengajamento): qualquer mensagem que a pessoa
      //   já mandou cancela, como sempre foi. São 516 mensagens de backlog de 20/08
      //   esperando outubro nesta fila: afrouxar a regra delas por tabela mandaria
      //   apresentação para quem já conversou, e ninguém pediu isso.
      const ehFormularioFresco = item.source === 'leadform' || item.source === 'sweep_leadform'
      let qEntrou = admin
        .from('interactions')
        .select('id')
        .eq('lead_id', item.lead_id ?? '')
        .eq('direction', 'in')
        .eq('channel', 'whatsapp')
      if (ehFormularioFresco) qEntrou = qEntrou.gte('created_at', item.created_at ?? item.scheduled_at)
      const { data: entrou } = await qEntrou.limit(1).maybeSingle()
      if (entrou) {
        await marcar({ status: 'canceled', last_reason: 'a pessoa escreveu antes' })
        out.recusados++
        out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'cancelado', motivo: 'ja_escreveu' })
        continue
      }

      // A CASA já falou com a pessoa depois que ela entrou na fila: a equipe pelo painel ou
      // pelo celular (o celular chega aqui pelo crm-wapi-events), ou outra automação. A
      // apresentação "vi que você deixou seu contato" por cima disso é o robô chegando atrasado
      // numa conversa que já existe. Virou obrigatório em 11/09/2026: com o primeiro contato do
      // turno sendo da equipe, a fila segura o lead até o fim do turno justamente para dar a vez
      // a ela, e não pode falar por cima de quem aproveitou a vez.
      const { data: casaFalou } = await admin
        .from('interactions')
        .select('id')
        .eq('lead_id', item.lead_id ?? '')
        .eq('direction', 'out')
        .eq('channel', 'whatsapp')
        .gte('created_at', item.created_at ?? item.scheduled_at)
        .limit(1)
        .maybeSingle()
      if (casaFalou) {
        await marcar({ status: 'canceled', last_reason: 'a equipe já falou com a pessoa' })
        out.recusados++
        out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'cancelado', motivo: 'casa_ja_falou' })
        continue
      }

      // Venceu dentro do turno de um polo que quer a equipe primeiro (11/09/2026): volta para o
      // fim do turno. Não conta tentativa, porque não é recusa: é a vez da equipe.
      const turno = await turnoDoPolo(item.tenant_id)
      if (turno.esperaEquipe && isWithinTeamHours(new Date(), turno.schedule)) {
        const policy = await loadLinePolicy(admin, item.instance_id ?? '', item.tenant_id)
        const quando = proximaAberturaDaSofia(
          { janelaInicio: policy.janela_inicio, janelaFim: policy.janela_fim, permiteDomingo: policy.permite_domingo },
          turno,
        )
        await marcar({ scheduled_at: quando.toISOString(), last_reason: 'turno_da_equipe' })
        out.reagendados++
        out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'reagendado', motivo: 'turno_da_equipe' })
        continue
      }

      // Sem `bindDefault: false` de propósito: depois desta mensagem a conversa passa a
      // viver nesta linha, e amarrar o lead a ela é o que faz a resposta da pessoa (e a
      // resposta da equipe pelo painel) cair no lugar certo.
      const { provider } = await resolveOutboundProviderForLead(admin, {
        id: item.lead_id ?? '',
        whatsapp_instance_id: item.instance_id,
        tenant_id: item.tenant_id,
      })

      const sent = await provider.sendMessage({
        to: item.phone,
        text: item.message,
        leadId: item.lead_id ?? undefined,
        metadata: { antiBanKind: item.kind, antiBanSource: `fila_${item.source}` },
      })

      await marcar({
        status: 'sent',
        sent_at: new Date().toISOString(),
        external_message_id: sent.externalMessageId,
        attempts: item.attempts + 1,
        last_reason: null,
      })

      if (item.lead_id) {
        const { data: leadRow } = await admin
          .from('leads')
          .select('patient_name')
          .eq('id', item.lead_id)
          .maybeSingle()
        await insertInteraction(admin, {
          leadId: item.lead_id,
          patientName: String((leadRow as { patient_name?: string } | null)?.patient_name ?? 'Lead'),
          channel: 'whatsapp',
          direction: 'out',
          author: 'Sofia (IA)',
          content: item.message,
          externalMessageId: sent.externalMessageId,
          tenantId: item.tenant_id,
        }).catch(() => {})
      }

      out.enviados++
      out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'enviado' })
    } catch (e) {
      const err = e as Error & { name?: string; reason?: string; retryAfterSeconds?: number }
      const bloqueado = err?.name === 'WapiBlockedError'
      const motivo = bloqueado ? String(err.reason ?? 'antiban') : (err?.message ?? 'erro').slice(0, 200)

      // Só estas recusas são DEFINITIVAS. Todo o resto — ritmo, teto, janela, linha ainda
      // não conectada, erro de rede — é "ainda não", e a pessoa continua na fila. O padrão
      // tem de ser esperar: desistir por um erro passageiro é perder o lead em silêncio,
      // que é o mesmo buraco que o ManyChat quebrado abriu.
      const definitivo =
        bloqueado &&
        ['opt_out', 'numero_sem_whatsapp', 'link_primeiro_contato', 'frio_max_tentativas', 'frio_espera', 'linha_banida', 'guarda_desligada']
          .includes(String(err.reason ?? ''))

      if (!definitivo && item.attempts < 40) {
        const espera = Math.max(120, Number(err.retryAfterSeconds ?? 900))
        await marcar({
          attempts: item.attempts + 1,
          scheduled_at: new Date(Date.now() + espera * 1000).toISOString(),
          last_reason: motivo,
        })
        out.reagendados++
        out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'reagendado', motivo })
        continue
      }

      // Recusa definitiva (opt-out, número sem WhatsApp, link na apresentação) ou 40 voltas
      // sem conseguir — a esta altura o formulário já envelheceu e a fila vira ruído.
      await marcar({ status: 'blocked', attempts: item.attempts + 1, last_reason: motivo })
      out.recusados++
      out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'recusado', motivo })
    }
  }

  return out
}
