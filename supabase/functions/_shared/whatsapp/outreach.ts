import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { resolveOutboundProviderForLead } from './resolveProvider.ts'
import { horaLocal, loadLinePolicy } from './antiBan.ts'
import { insertInteraction } from '../crm.ts'

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
     * que a pessoa já tenha mandado um dia bloqueia o contato para sempre — o
     * que é certo para carrinho e reengajamento, e errado para formulário: quem
     * escreveu "oi" há três meses e agora preenche um formulário levantou a mão
     * de novo.
     */
    conversaRecenteDias?: number
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
    const { data: jaEscreveu } = await q.limit(1).maybeSingle()
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
    const quando = proximaJanela(policy.janela_inicio, policy.janela_fim, policy.permite_domingo)

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

  for (const item of itens) {
    out.processados++
    const marcar = async (patch: Record<string, unknown>) => {
      await admin
        .from('whatsapp_outreach_queue')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', item.id)
    }

    try {
      // A pessoa pode ter escrito enquanto esperava na fila. Aí a apresentação perdeu o
      // sentido: quem fala com ela é o atendimento, e mandar o texto pronto por cima é o
      // robô atropelando a conversa.
      const { data: entrou } = await admin
        .from('interactions')
        .select('id')
        .eq('lead_id', item.lead_id ?? '')
        .eq('direction', 'in')
        .eq('channel', 'whatsapp')
        .limit(1)
        .maybeSingle()
      if (entrou) {
        await marcar({ status: 'canceled', last_reason: 'a pessoa escreveu antes' })
        out.recusados++
        out.detalhes.push({ id: item.id, lead_id: item.lead_id, resultado: 'cancelado', motivo: 'ja_escreveu' })
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
