import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { sendWapiDirectText } from '../_shared/saleReceipt.ts'
import {
  avaliarLinha,
  SONDA_TIMEOUT_MS,
  type SinalDaLinha,
  type SondaDaLinha,
} from '../_shared/whatsapp/lineWatch.ts'

/**
 * crm-linha-vigia — o alarme que faltou em 11/09/2026.
 *
 * A linha da clínica ficou 1h30 sem receber nada, o CRM continuou mandando, o painel
 * continuou dizendo "conectada" e ninguém foi avisado: quem descobriu foi a atendente,
 * porque o paciente respondeu no celular dela. `crm-wapi-events` só sabe o que o provedor
 * conta, e o provedor não contou nada — quem travou foi a instância dele.
 *
 * Aqui a pergunta é outra e não depende do provedor: **por que ninguém escreve para uma
 * linha que está mandando mensagem?** A regra mora em `_shared/whatsapp/lineWatch.ts`
 * (com testes); esta função é só os olhos e a boca — mede, sonda e avisa.
 *
 * O que ele NÃO faz: não pausa linha (pausar cala também a atendente, e isso é decisão de
 * operação) e não fala com paciente. O aviso sai pela linha do OUTRO polo, porque a linha
 * caída não consegue avisar que caiu, mais notificação in-app para quem atende.
 *
 * Cron: de 5 em 5 minutos. verify_jwt=false + x-cron-secret obrigatório.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const SP_TZ = 'America/Sao_Paulo'
const DEFAULT_WAPI_BASE_URL = 'https://api.w-api.app/v1'
const nowIso = () => new Date().toISOString()

type LinhaRow = {
  id: string
  label: string | null
  tenant_id: string
  phone_e164: string | null
  wapi_instance_id: string | null
  wapi_token: string | null
  wapi_base_url: string | null
}

type PolicyRow = {
  instance_id: string
  janela_inicio: number | null
  janela_fim: number | null
  permite_domingo: boolean | null
  pausado_ate: string | null
}

type HealthRow = {
  instance_id: string
  status: string | null
  detail: Record<string, unknown> | null
}

/** Hora e dia da semana em Maringá — a janela da linha é escrita no fuso de quem atende. */
function horaEDiaEmMaringa(now: Date): { hora: number; domingo: boolean } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SP_TZ,
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now)
  const hora = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const weekday = String(parts.find((p) => p.type === 'weekday')?.value ?? '')
  return { hora, domingo: weekday === 'Sun' }
}

function dentroDaJanela(policy: PolicyRow | null, now: Date): boolean {
  const inicio = Number(policy?.janela_inicio ?? 8)
  const fim = Number(policy?.janela_fim ?? 20)
  const domingoOk = policy?.permite_domingo === true
  const { hora, domingo } = horaEDiaEmMaringa(now)
  if (domingo && !domingoOk) return false
  return hora >= inicio && hora < fim
}

/** Timestamp da última mensagem RECEBIDA nesta linha. `null` = nunca recebeu nada. */
async function ultimaEntradaMs(admin: SupabaseClient, line: LinhaRow): Promise<number | null> {
  const { data } = await admin
    .from('interactions')
    .select('happened_at')
    .eq('tenant_id', line.tenant_id)
    .eq('channel', 'whatsapp')
    .eq('direction', 'in')
    .order('happened_at', { ascending: false })
    .limit(1)
  const ultima = (data ?? [])[0] as { happened_at?: string } | undefined
  if (!ultima?.happened_at) return null
  return Date.parse(ultima.happened_at)
}

/** Quantas mensagens o CRM mandou desde então: a prova de que insistimos e ninguém voltou. */
async function saidasDesde(admin: SupabaseClient, line: LinhaRow, desdeIso: string): Promise<number> {
  const { count } = await admin
    .from('interactions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', line.tenant_id)
    .eq('channel', 'whatsapp')
    .eq('direction', 'out')
    .gte('happened_at', desdeIso)
  return Number(count ?? 0)
}

/**
 * Abertura da janela de HOJE, no fuso de Maringá. É o piso do silêncio: sem ele toda linha
 * amanhece "muda há 12 horas" porque a madrugada inteira entra na conta (visto no primeiro
 * ensaio, 12/09). O Brasil não tem mais horário de verão desde 2019, então -03:00 é fixo.
 */
function aberturaDaJanelaHoje(policy: PolicyRow | null, now: Date): number {
  const inicio = Number(policy?.janela_inicio ?? 8)
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  return Date.parse(`${ymd}T${String(inicio).padStart(2, '0')}:00:00-03:00`)
}

/**
 * Sonda curta no provedor. Demora JÁ É a resposta: em 11/09 a instância travada não
 * devolveu byte nenhum em 30s enquanto a linha saudável respondia em menos de 1s.
 * Não usamos `WapiProvider.instanceStatus()` aqui porque o `call()` dele espera 25s, e
 * um cron de 5 em 5 minutos não pode ficar 25s pendurado por linha.
 */
async function sondar(line: LinhaRow): Promise<SondaDaLinha> {
  const base = (line.wapi_base_url?.trim() || DEFAULT_WAPI_BASE_URL).replace(/\/$/, '')
  const url = `${base}/instance/status-instance?instanceId=${encodeURIComponent(String(line.wapi_instance_id ?? ''))}`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${line.wapi_token ?? ''}` },
      signal: AbortSignal.timeout(SONDA_TIMEOUT_MS),
    })
    const raw = (await res.text()).slice(0, 200)
    let parsed: Record<string, unknown> = {}
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch { /* corpo não-JSON: fica no detalhe */ }
    const flag = parsed.connected
    const statusStr = String(parsed.status ?? '').toLowerCase()
    let connected: boolean | null = null
    if (typeof flag === 'boolean') connected = flag
    else if (/^(connected|open|online|conectado)$/.test(statusStr)) connected = true
    else if (/(disconnect|close|offline|desconect|ban)/.test(statusStr)) connected = false
    return { respondeu: res.ok, connected, detalhe: `http_${res.status} ${raw}`.trim() }
  } catch (e) {
    return { respondeu: false, connected: null, detalhe: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Quem recebe o aviso no WhatsApp. Linha fora do ar é assunto `sistema_parado`
 * ([[crm_owner_dm_por_assunto]]): se o polo filtrou os assuntos e não pediu este,
 * respeitamos o silêncio — o in-app sai de qualquer jeito.
 *
 * `line_watch_phones` existe porque quem conserta a linha não é necessariamente quem
 * recebe cópia de venda: a clínica não tem telefone de dono configurado, e foi por isso
 * que ninguém foi avisado em 11/09.
 */
async function telefonesDoAviso(admin: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('notifications')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const cfg = ((data as { notifications?: Record<string, unknown> } | null)?.notifications ?? {}) as {
    owner_dm_kinds?: string[]
    line_watch_phones?: string[]
    sales_receipt_owner_phones?: string[]
  }
  const permitidos = Array.isArray(cfg.owner_dm_kinds) ? cfg.owner_dm_kinds : null
  if (permitidos && !permitidos.includes('sistema_parado')) return []
  const lista = Array.isArray(cfg.line_watch_phones) && cfg.line_watch_phones.length > 0
    ? cfg.line_watch_phones
    : (cfg.sales_receipt_owner_phones ?? [])
  return lista.map((p) => String(p ?? '').trim()).filter(Boolean)
}

/** O aviso sai pela linha do OUTRO polo — a caída não consegue avisar que caiu. */
async function avisarPeloOutroPolo(
  admin: SupabaseClient,
  tenantAfetado: string,
  texto: string,
): Promise<number> {
  const tenantMensageiro = tenantAfetado === 'tricopill' ? 'instituto-lorena' : 'tricopill'
  const phones = await telefonesDoAviso(admin, tenantAfetado)
  let enviados = 0
  for (const p of phones) {
    const ok = await sendWapiDirectText(admin, tenantMensageiro, p, texto)
    // Na queda de 03/09 o ENVIO funcionava e só a entrada estava morta: a própria linha
    // afetada ainda é uma segunda chance melhor que nenhuma.
    const okFallback = ok || (await sendWapiDirectText(admin, tenantAfetado, p, texto))
    if (okFallback) enviados++
  }
  return enviados
}

async function registrarSaude(
  admin: SupabaseClient,
  line: LinhaRow,
  patch: { status: string; connected: boolean; evento: string; vigia: Record<string, unknown> },
): Promise<void> {
  await admin.from('whatsapp_line_health').upsert(
    {
      instance_id: line.id,
      tenant_id: line.tenant_id,
      status: patch.status,
      connected: patch.connected,
      phone_e164: line.phone_e164,
      last_event: patch.evento,
      last_event_at: nowIso(),
      detail: { vigia: patch.vigia },
      updated_at: nowIso(),
    },
    { onConflict: 'instance_id' },
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('LINHA_VIGIA_CRON_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  // NEGA sem segredo: o endpoint manda WhatsApp para o dono, então aberto na internet
  // ele é um megafone de graça.
  if (!cronSecret || provided !== cronSecret) return json({ error: 'unauthorized' }, 401)
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const admin = createClient(supabaseUrl, serviceRole)
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch { /* cron manda {} */ }
  /** `{"dry": true}` mede e sonda, mas não avisa ninguém nem grava saúde. */
  const dry = body.dry === true
  /**
   * `{"ensaio": "<instance_id>"}` manda UM aviso de mentirinha pelo caminho de verdade.
   * Existe porque o defeito de 11/09 não foi o alarme tocar errado: foi ninguém receber
   * nada. A clínica não tinha telefone configurado, e isso só aparece quando se tenta.
   * Não grava saúde e não notifica a equipe in-app — só o DM, marcado como ensaio.
   */
  const ensaio = String(body.ensaio ?? '').trim()

  if (ensaio) {
    const { data: linhaRaw } = await admin
      .from('whatsapp_channel_instances')
      .select('id, label, tenant_id, phone_e164, wapi_instance_id, wapi_token, wapi_base_url')
      .eq('id', ensaio)
      .maybeSingle()
    const line = (linhaRaw ?? null) as LinhaRow | null
    if (!line) return json({ ok: false, error: 'linha_nao_encontrada', ensaio }, 404)
    const telefones = await telefonesDoAviso(admin, line.tenant_id)
    const enviados = await avisarPeloOutroPolo(
      admin,
      line.tenant_id,
      `🧪 ENSAIO do vigia de linha — ninguém caiu.\n\n` +
        `É assim que chega o aviso se a linha *${line.label || line.id}* parar de receber ` +
        `mensagem durante o expediente. Se você está lendo isto, o caminho do alerta funciona.`,
    )
    return json({ ok: true, ensaio: line.id, telefones_configurados: telefones.length, dms: enviados })
  }

  const { data: linhasRaw, error } = await admin
    .from('whatsapp_channel_instances')
    .select('id, label, tenant_id, phone_e164, wapi_instance_id, wapi_token, wapi_base_url')
    .eq('channel_provider', 'wapi')
    .eq('active', true)
  if (error) return json({ ok: false, error: error.message }, 500)
  const linhas = (linhasRaw ?? []) as LinhaRow[]

  const porTenant = new Map<string, number>()
  for (const l of linhas) porTenant.set(l.tenant_id, (porTenant.get(l.tenant_id) ?? 0) + 1)

  const agora = new Date()
  const resultado: Array<Record<string, unknown>> = []

  for (const line of linhas) {
    if (!line.wapi_instance_id || !line.wapi_token) {
      resultado.push({ linha: line.id, acao: 'ok', motivo: 'sem_credencial' })
      continue
    }
    // `interactions` não diz por qual linha a mensagem entrou. Com uma linha ativa por polo
    // a conta do polo É a conta da linha; com duas, seria chute — e chute vira alarme falso.
    if ((porTenant.get(line.tenant_id) ?? 0) > 1) {
      resultado.push({ linha: line.id, acao: 'ok', motivo: 'polo_com_mais_de_uma_linha_ativa' })
      continue
    }

    const [{ data: policyRaw }, { data: healthRaw }] = await Promise.all([
      admin.from('whatsapp_line_policy')
        .select('instance_id, janela_inicio, janela_fim, permite_domingo, pausado_ate')
        .eq('instance_id', line.id).maybeSingle(),
      admin.from('whatsapp_line_health')
        .select('instance_id, status, detail')
        .eq('instance_id', line.id).maybeSingle(),
    ])
    const policy = (policyRaw ?? null) as PolicyRow | null
    const health = (healthRaw ?? null) as HealthRow | null

    // Linha pausada de propósito não recebe porque ninguém mandou: cobrar silêncio dela é ruído.
    const pausada = policy?.pausado_ate ? Date.parse(policy.pausado_ate) > Date.now() : false
    if (pausada) {
      resultado.push({ linha: line.id, acao: 'ok', motivo: 'pausada' })
      continue
    }

    const vigiaAntes = ((health?.detail ?? {}) as { vigia?: Record<string, unknown> }).vigia ?? {}
    const avisadoEm = String(vigiaAntes.avisado_em ?? '')
    const entradaMs = await ultimaEntradaMs(admin, line)
    // O silêncio que acusa começa na abertura da janela de hoje, nunca antes dela.
    const referenciaMs = Math.max(entradaMs ?? 0, aberturaDaJanelaHoje(policy, agora))
    const sinal: SinalDaLinha = {
      minutosSemEntrada: entradaMs === null ? null : Math.floor((Date.now() - entradaMs) / 60_000),
      minutosDeSilencioNaJanela: Math.max(0, Math.floor((Date.now() - referenciaMs) / 60_000)),
      saidasNoSilencio: await saidasDesde(admin, line, new Date(referenciaMs).toISOString()),
      dentroDaJanela: dentroDaJanela(policy, agora),
      sonda: null,
      avisadoHaMinutos: avisadoEm ? Math.floor((Date.now() - Date.parse(avisadoEm)) / 60_000) : null,
      marcadaMuda: health?.status === 'muda' || health?.status === 'travada',
    }

    let veredito = avaliarLinha(sinal)
    if (veredito.acao === 'sondar') {
      sinal.sonda = await sondar(line)
      veredito = avaliarLinha(sinal)
    }

    const linhaNome = line.label || line.id
    const telefone = line.phone_e164 ?? ''
    const minutos = sinal.minutosDeSilencioNaJanela

    if (veredito.acao === 'alertar') {
      const travada = veredito.tipo === 'travada'
      const texto = travada
        ? `🔴 A linha *${linhaNome}* (${telefone}) parou de RECEBER mensagem há ${minutos} min e o status da W-API não respondeu em ${Math.round(SONDA_TIMEOUT_MS / 1000)}s.\n\n` +
          `É a assinatura da instância travada (11/09): o envio ainda devolve id, mas nada chega ao paciente.\n` +
          `O que fazer: reiniciar ou reconectar a instância no painel da W-API. Enquanto isso, atender pelo celular.`
        : `🟠 A linha *${linhaNome}* (${telefone}) está conectada e parou de RECEBER há ${minutos} min, com ${sinal.saidasNoSilencio} saída(s) no período.\n\n` +
          `É a assinatura do gancho morto (03/09): o provedor diz que está tudo certo e não entrega o que chega.\n` +
          `O que fazer: reescrever o webhook de entrada (PUT update-webhook-received) — resolveu em 8 segundos da última vez.`

      if (dry) {
        resultado.push({ linha: line.id, acao: 'alertaria', tipo: veredito.tipo, minutos, texto })
        continue
      }
      await registrarSaude(admin, line, {
        status: veredito.tipo === 'travada' ? 'travada' : 'muda',
        connected: sinal.sonda?.connected ?? false,
        evento: `vigia_linha_${veredito.tipo}`,
        vigia: {
          avisado_em: nowIso(),
          muda_desde: String(vigiaAntes.muda_desde ?? nowIso()),
          minutos_sem_entrada: minutos,
          saidas_no_silencio: sinal.saidasNoSilencio,
          sonda: sinal.sonda?.detalhe ?? '',
          motivo: veredito.motivo,
        },
      })
      const enviados = await avisarPeloOutroPolo(admin, line.tenant_id, texto)
      await notifyAgents(admin, {
        leadId: `linha-${line.id}`,
        tenantId: line.tenant_id,
        kind: 'urgent',
        title: travada ? '🔴 WhatsApp travado no provedor' : '🟠 WhatsApp não está recebendo',
        body: `${linhaNome} está há ${minutos} min sem receber mensagem. Atenda pelo celular até voltar.`,
        dedupeKey: `linha-muda-${line.id}`,
        dedupeWindowMinutes: 60,
      }).catch(() => {})
      resultado.push({ linha: line.id, acao: 'alertou', tipo: veredito.tipo, minutos, dms: enviados })
      continue
    }

    if (veredito.acao === 'voltou') {
      if (dry) {
        resultado.push({ linha: line.id, acao: 'diria_que_voltou', minutos })
        continue
      }
      await registrarSaude(admin, line, {
        status: 'connected',
        connected: true,
        evento: 'vigia_linha_voltou',
        vigia: { voltou_em: nowIso(), muda_desde: String(vigiaAntes.muda_desde ?? '') },
      })
      const desde = String(vigiaAntes.muda_desde ?? '')
      const paradaMin = desde ? Math.floor((Date.now() - Date.parse(desde)) / 60_000) : null
      const enviados = await avisarPeloOutroPolo(
        admin,
        line.tenant_id,
        `🟢 A linha *${linhaNome}* voltou a receber mensagem${paradaMin ? ` (ficou ${paradaMin} min fora)` : ''}.\n\n` +
          `As mensagens presas costumam entrar todas de uma vez, gravadas com a hora da volta e não com a hora em que o paciente escreveu.`,
      )
      resultado.push({ linha: line.id, acao: 'voltou', dms: enviados })
      continue
    }

    resultado.push({
      linha: line.id,
      acao: veredito.acao,
      motivo: veredito.acao === 'ok' ? veredito.motivo : '',
      minutos: sinal.minutosDeSilencioNaJanela,
      relogio: sinal.minutosSemEntrada,
      saidas: sinal.saidasNoSilencio,
      sonda: sinal.sonda?.detalhe ?? null,
    })
  }

  return json({ ok: true, at: nowIso(), dry, linhas: resultado })
})
