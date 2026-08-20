import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  drainOutreachQueue,
  enqueueOutreach,
  loadLeadformOutreachConfig,
  renderMensagem,
} from '../_shared/whatsapp/outreach.ts'

/**
 * Drena a fila de primeiro contato, e varre o que ficou para trás.
 *
 * Roda de minuto em minuto (pg_cron). Cada volta entrega no máximo 3 mensagens, e mesmo
 * essas só saem se a guarda deixar — o intervalo mínimo entre proativos costuma segurar em
 * uma por volta. É de propósito: a cadência tem de parecer uma pessoa atendendo, não um
 * sistema despejando fila.
 *
 * A varredura existe porque "falar com todo lead" não pode depender de o webhook ter dado
 * certo naquele segundo. Todo lead de formulário das últimas `max_age_hours` que ainda não
 * recebeu nem mandou nada entra na fila — a trava única por (lead, tipo) garante que ele
 * entre uma vez só, mesmo com o webhook e a varredura olhando para o mesmo lead.
 *
 * Autenticação: verify_jwt=false (o cron não manda JWT de sessão) + x-cron-secret opcional.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** Leads de formulário recentes que nunca receberam nem mandaram nada. */
async function varrerLeadsSemPrimeiroContato(
  admin: SupabaseClient,
  tenantId: string,
  dry = false,
): Promise<{ enfileirados: number; olhados: number; candidatos?: string[]; motivo?: string }> {
  const cfg = await loadLeadformOutreachConfig(admin, tenantId)
  if (!cfg.enabled) return { enfileirados: 0, olhados: 0, motivo: 'desligado' }

  const desde = new Date(Date.now() - cfg.maxAgeHours * 3_600_000).toISOString()
  // SÓ formulário. A varredura larga demais pescava paciente de pós-consulta e lead de
  // planilha, e a eles a mensagem "vi que você deixou seu contato" é mentira: essa gente
  // já esteve na clínica. O carimbo `custom_fields.lead_form` é quem separa.
  const { data } = await admin
    .from('leads')
    .select('id, patient_name, phone, created_at, opted_out_at')
    .eq('tenant_id', tenantId)
    .gte('created_at', desde)
    .is('opted_out_at', null)
    .not('phone', 'is', null)
    .not('custom_fields->lead_form', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60)

  const leads = (data as Array<{ id: string; patient_name: string; phone: string }> | null) ?? []
  let enfileirados = 0
  const candidatos: string[] = []
  for (const lead of leads) {
    // Telefone sintético do ManyChat (888…) nunca teve WhatsApp de verdade.
    const digitos = String(lead.phone ?? '').replace(/[^0-9]/g, '')
    if (!digitos || digitos.startsWith('888')) continue

    // Já houve conversa de WhatsApp neste lead? Só isso conta como "alguém já falou".
    // O registo do formulário entra como interação `system` ("📋 Formulário recebido") e
    // NÃO pode contar: era exatamente ele que fazia os 24 leads de `first_touch_failed`
    // parecerem atendidos enquanto ninguém tinha dito uma palavra a eles.
    const { data: alguma } = await admin
      .from('interactions')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('channel', 'whatsapp')
      .limit(1)
      .maybeSingle()
    if (alguma) continue

    candidatos.push(`${lead.patient_name ?? '?'} (${lead.id})`)
    // Em ensaio, ninguém entra na fila: a varredura só diz quem entraria.
    if (dry) continue

    const res = await enqueueOutreach(admin, {
      tenantId,
      leadId: lead.id,
      phone: digitos,
      message: renderMensagem(cfg.message, lead.patient_name ?? ''),
      source: 'sweep_leadform',
    })
    if (res.queued) enfileirados++
  }
  return { enfileirados, olhados: leads.length, candidatos: candidatos.slice(0, 20) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ ok: false, error: 'server_misconfigured' }, 500)

  const cronSecret = (Deno.env.get('CRON_SECRET') ?? '').trim()
  if (cronSecret) {
    const enviado = req.headers.get('x-cron-secret')?.trim() ?? ''
    if (enviado !== cronSecret) return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRole)

  let body: { max?: number; tenantId?: string; sweep?: boolean; dry?: boolean } = {}
  try {
    body = req.method === 'POST' ? ((await req.json()) as typeof body) : {}
  } catch {
    body = {}
  }

  const tenantId = String(body.tenantId ?? 'instituto-lorena')

  try {
    // A varredura roda antes: um lead que chegou agora tem de poder sair nesta mesma volta.
    const sweep = body.sweep === false
      ? { enfileirados: 0, olhados: 0, motivo: 'pulado' }
      : await varrerLeadsSemPrimeiroContato(admin, tenantId, body.dry === true)

    if (body.dry === true) {
      const { count } = await admin
        .from('whatsapp_outreach_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      return json({ ok: true, dry: true, sweep, na_fila: count ?? 0 })
    }

    const drain = await drainOutreachQueue(admin, { max: body.max ?? 3 })
    return json({ ok: true, sweep, drain })
  } catch (e) {
    return json({ ok: false, error: 'worker_failed', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
