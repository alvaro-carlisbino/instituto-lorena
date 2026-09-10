import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { horaLocal } from '../_shared/whatsapp/antiBan.ts'
import { applyLeadName } from '../_shared/leadName.ts'

// `nowIso` mora em `crmAiAutoReply.ts`, que arrasta catálogo do Bling e recibo de venda
// junto. Para um cron de uma página isso é bundle e cold start pagos por nada.
const nowIso = () => new Date().toISOString()

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * Follow-up de AGENDAMENTO — 24h / 48h / 7 dias com quem conversou, ouviu sobre a consulta
 * e sumiu sem marcar.
 *
 * Pedido da equipe da clínica (reunião de 05/09/2026), textos escritos por eles. O que
 * esta rotina cobre NÃO existia: as três máquinas de hoje olham para o outro lado.
 * `crm-followup-scheduler` (1h→24h) só fala com quem está esperando resposta NOSSA; o
 * `crm-atendimento-vigia` cobra a EQUIPE; a `crm-landing-retomada` só pega lead da landing
 * /consulta — e por isso a lista daqui exclui `origem_landing`, para ninguém levar dois
 * robôs no mesmo ombro.
 *
 * O RELÓGIO CONTA DA ÚLTIMA RESPOSTA DE VERDADE, não da última mensagem que saiu. Quem
 * decide isso é a RPC `crm_sem_agendamento_para_nutrir`, que descarta outbound de robô
 * (inclusive o desta rotina) ao calcular `ultima_saida`. Sem isso o degrau de 48h nunca
 * chegaria: cada mensagem nossa empurraria a régua e a pessoa levaria a primeira mensagem
 * para sempre.
 *
 * CADA PESSOA RECEBE CADA DEGRAU UMA VEZ NA VIDA. `crm_followup_agendamento.step` só sobe;
 * conversa nova meses depois não reinicia a cadência. Mandar "segue nosso vídeo" duas vezes
 * é o erro do Ezequiel nas avaliações duplicadas, com um vídeo de 12 MB em cima.
 *
 * Autenticação: verify_jwt=false (o cron não manda JWT de sessão) + x-cron-secret
 * obrigatório. Na ausência de segredo configurado, NEGA — como a irmã `crm-landing-retomada`,
 * e ao contrário do `crm-followup-scheduler`, que libera.
 */

const TENANT = 'instituto-lorena'

/** Degraus, em horas desde a última resposta de verdade. Config sobrepõe. */
const HORAS_PADRAO = [24, 48, 168]

/**
 * Espaço mínimo entre dois degraus do MESMO paciente. A régua é absoluta (24h/48h/168h a
 * partir da última resposta), então quem entra atrasado — a rotina ficou parada, ou a
 * guarda recusou por dois dias — chegaria com dois degraus vencidos ao mesmo tempo e
 * levaria duas mensagens na mesma rodada. 20h é "um por dia, no máximo".
 */
const ESPACO_MINIMO_HORAS = 20

/** Teto por rodada: linha não-oficial que dispara em rajada é linha morta. */
const CAP_PADRAO = 6

/**
 * Depois de duas voltas FALHANDO O ENVIO, o texto sai SEM o vídeo.
 *
 * O anexo é o que pode quebrar sozinho (URL assinada, W-API fora do ar, arquivo movido no
 * storage). A mensagem importa mais que o vídeo: melhor a pessoa receber o texto do que
 * ficar em silêncio esperando um MP4.
 *
 * FALHA, e só falha. Recusa da guarda anti-ban não conta aqui — ver `ehRecusaDaGuarda`.
 */
const TENTATIVAS_ATE_DESISTIR_DO_VIDEO = 2

/**
 * Orçamento de espera dentro de uma rodada, em ms.
 *
 * A guarda exige 45–90s entre dois proativos da MESMA linha (`gap_min_segundos` +
 * jitter em `whatsapp_line_policy`). O laço aqui despacha em ~0,6s por lead, então
 * sem espera só o PRIMEIRO da rodada passa e todo o resto leva `ritmo` na cara. Em vez
 * de queimar a lista contra a parede, esperamos o tempo que a própria guarda pede e
 * tentamos o mesmo lead de novo — enquanto couber no orçamento. Fora dele, a rodada
 * acaba: a de daqui a uma hora continua de onde esta parou.
 *
 * 240s deixa a função inteira bem abaixo do teto de parede da Edge Function.
 */
const ORCAMENTO_ESPERA_MS = 240_000

/** Teto por espera: um `retryAfterSeconds` absurdo não pendura a rodada. */
const ESPERA_MAX_MS = 100_000

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Recusa = { error: string; reason: string; message: string; retryAfterSeconds: number | null }

/**
 * O MOTIVO REAL DA RECUSA, e não "Edge Function returned a non-2xx status code".
 *
 * `functions.invoke` do supabase-js engole o corpo quando o status não é 2xx: sobra uma
 * `FunctionsHttpError` com a frase genérica e a `Response` crua em `.context`. Enquanto
 * ninguém abria esse corpo, `last_reason` guardava a frase inútil para TODA recusa — e foi
 * assim que ninguém viu que o que barrava era o ritmo da linha, não o vídeo.
 */
async function lerRecusa(sendErr: unknown, sendResult: unknown): Promise<Recusa> {
  const corpo = (sendResult ?? {}) as Record<string, unknown>
  let dados: Record<string, unknown> = corpo
  const ctx = (sendErr as { context?: unknown } | null)?.context
  if (ctx instanceof Response) {
    try {
      dados = (await ctx.clone().json()) as Record<string, unknown>
    } catch {
      // Corpo não-JSON (502 do runtime, HTML de gateway): fica o que veio do invoke.
    }
  }
  const retry = Number(dados.retryAfterSeconds)
  return {
    error: String(dados.error ?? '').trim(),
    reason: String(dados.reason ?? '').trim(),
    message: String(
      dados.message ?? (sendErr as { message?: string } | null)?.message ?? 'recusado',
    ).trim(),
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : null,
  }
}

/**
 * "Ainda não" da guarda anti-ban × "quebrou" de verdade.
 *
 * A guarda devolve 429 para ritmo, teto do dia, teto da semana por lead, janela de horário
 * e contato frio. Nada disso diz uma palavra sobre o anexo — e contar essas recusas como
 * tentativa de vídeo é o que fez Rita, Karina e Fátima receberem "Segue nosso vídeo" com
 * vídeo nenhum em 10/set/2026: três rodadas barradas por `ritmo`, `attempts` em 3, e o
 * vídeo abandonado por um problema que nunca existiu.
 */
function ehRecusaDaGuarda(r: Recusa): boolean {
  return r.error === 'blocked_antiban' || r.error === 'rate_limited' || r.error === 'cooldown'
}

type Passo = { horas: number; texto: string; video: boolean }

type Config = {
  enabled: boolean
  ativadoEm: string | null
  maxDias: number
  capPorRodada: number
  videoPath: string
  passos: Passo[]
}

type LeadParado = {
  lead_id: string
  patient_name: string
  phone: string
  tenant_id: string
  conversa_tenant_id: string
  whatsapp_instance_id: string | null
  medico: string | null
  ultima_saida: string
  ultima_entrada: string | null
  horas_parado: number
}

type Estado = { lead_id: string; step: number; last_sent_at: string | null; attempts: number }

/**
 * Saudação pela hora de Maringá.
 *
 * Os textos da equipe vinham com "boa tarde" (1º) e "Bom dia" (2º) fixos. A rotina roda das
 * 9h às 19h: metade das mensagens chegaria com a saudação errada, que é o carimbo mais
 * barato de robô que existe.
 */
function saudacao(at: Date = new Date()): string {
  const { hora } = horaLocal(at)
  if (hora < 12) return 'bom dia'
  if (hora < 18) return 'boa tarde'
  return 'boa noite'
}

/**
 * "com a Dra. Lorena" — ou nada.
 *
 * O texto da equipe traz "consulta da Dra. (Lorena, Matheus, Jaqueline)": um espaço em
 * branco para quem digita à mão escolher. Automático, só dá para preencher quando a
 * conversa registrou o médico (`custom_fields.medico`), o que hoje é raro. Sem o nome, a
 * frase fecha sozinha ("Ficou alguma dúvida em relação à consulta?") em vez de sair com
 * uma lista de três médicos entre parênteses. E o pronome segue o nome: "Dra." colado no
 * Dr. Matheus é o tipo de erro que a paciente mostra para a recepção.
 */
const MEDICOS_HOMENS = ['matheus']

function consultaMedico(medico: string | null): string {
  const nome = String(medico ?? '').trim().replace(/^dr[a]?\.?\s*/i, '')
  if (!nome) return ''
  const primeiro = nome.split(/\s+/)[0].toLowerCase()
  const tratamento = MEDICOS_HOMENS.includes(primeiro) ? 'o Dr.' : 'a Dra.'
  return ` com ${tratamento} ${nome}`
}

/**
 * O NOME É O ÚLTIMO A ENTRAR, e entra pelo `applyLeadName` de casa.
 *
 * Metade da lista da clínica tem por nome o que veio do perfil do WhatsApp:
 * "socorroleitemaria311", "Leda💃🏽", "😘". Um `split(' ')[0]` cru manda "Olá, 😘, boa
 * tarde!" — foi o lote de "Oi Contato, tudo bem?" de 18/ago que criou aquele módulo. Sem
 * nome de gente o vocativo SOME ("Olá, boa tarde! Tudo bem?"), em vez de virar piada.
 *
 * A ordem importa: saudação e médico primeiro, nome depois. `applyLeadName` come a vírgula
 * do vocativo quando não há nome, e para isso a frase já tem de estar montada.
 */
function renderTexto(template: string, lead: LeadParado, agora = new Date()): string {
  const s = saudacao(agora)
  const montado = template
    .replaceAll('{{saudacao_maiuscula}}', s.charAt(0).toUpperCase() + s.slice(1))
    .replaceAll('{{saudacao}}', s)
    .replaceAll('{{consulta_medico}}', consultaMedico(lead.medico))
    // `applyLeadName` fala a língua de chave simples (`{nome}`); a config usa chave dupla,
    // como a irmã `outreach.leadform`. A ponte é aqui, num lugar só.
    .replaceAll('{{primeiro_nome}}', '{nome}')
    .replaceAll('{{nome}}', '{nome}')
  return applyLeadName(montado, lead.patient_name, 'nome').trim()
}

/**
 * Manda só o vídeo para uma lista escrita à mão, um por vez, respeitando o ritmo da linha.
 *
 * O polo da conversa vem da MESMA regra da RPC (o tenant que carimbou as saídas), e não do
 * cadastro: quem manda na linha é por onde a pessoa conversa
 * ([[crm_venda_segue_a_linha_nao_a_pessoa]]).
 */
async function reenviarVideo(
  admin: SupabaseClient,
  leadIds: string[],
  videoPath: string,
  legenda: string,
  dryRun: boolean,
): Promise<Response> {
  const { data: linhas } = await admin
    .from('leads')
    .select('id, patient_name, phone, tenant_id')
    .in('id', leadIds)
    .is('deleted_at', null)
  const leads = ((linhas as Array<Record<string, unknown>> | null) ?? [])

  const results: Array<Record<string, unknown>> = []
  let primeiro = true
  for (const lead of leads) {
    const leadId = String(lead.id)
    const { data: saida } = await admin
      .from('interactions')
      .select('tenant_id')
      .eq('lead_id', leadId)
      .eq('direction', 'out')
      .in('channel', ['whatsapp', 'meta'])
      .order('happened_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const conversaTenant = String(
      (saida as { tenant_id?: string } | null)?.tenant_id || lead.tenant_id || TENANT,
    )

    // `{nome}` na legenda passa pelo mesmo `applyLeadName` da cadência: metade da lista da
    // clínica tem por nome o que veio do perfil do WhatsApp ("Leda💃🏽", "😘"), e sem nome
    // de gente o vocativo SOME em vez de virar piada.
    const texto = applyLeadName(legenda, String(lead.patient_name ?? ''), 'nome').trim()

    if (dryRun) {
      results.push({ leadId, nome: lead.patient_name, conversaTenant, texto, status: 'dry' })
      continue
    }

    // A guarda exige 45–90s entre dois proativos da mesma linha. Esperar ANTES do segundo
    // em diante é mais barato que levar `ritmo` e ter de esperar do mesmo jeito.
    if (!primeiro) await dormir(ESPERA_MAX_MS)
    primeiro = false

    const { data: sendResult, error: sendErr } = await admin.functions.invoke('crm-send-message', {
      body: {
        leadId,
        text: texto,
        channel: 'whatsapp',
        source: 'followup_agendamento',
        senderTenantId: conversaTenant,
        requireBotKind: conversaTenant === 'tricopill' ? 'sales' : 'clinic',
        media: [{ storagePath: videoPath, kind: 'video' }],
      },
    })
    const ok = !sendErr && (sendResult as { ok?: boolean })?.ok !== false
    if (ok) {
      results.push({ leadId, nome: lead.patient_name, status: 'enviado' })
      continue
    }
    const recusa = await lerRecusa(sendErr, sendResult)
    console.warn(`followup-agendamento reenvio recusado lead=${leadId}: ${recusa.error}:${recusa.reason}`)
    results.push({
      leadId,
      nome: lead.patient_name,
      status: 'recusado',
      motivo: `${recusa.error || 'recusado'}${recusa.reason ? `:${recusa.reason}` : ''} — ${recusa.message}`.slice(0, 200),
    })
  }

  const naoAchados = leadIds.filter((id) => !leads.some((l) => String(l.id) === id))
  return json({ ok: true, modo: 'reenviarVideo', dryRun, results, naoAchados, at: nowIso() })
}

async function carregarConfig(admin: SupabaseClient): Promise<Config> {
  const { data } = await admin
    .from('tenant_integrations')
    .select('outreach')
    .eq('tenant_id', TENANT)
    .maybeSingle()
  const outreach = ((data as { outreach?: Record<string, unknown> } | null)?.outreach ?? {}) as Record<string, unknown>
  const cfg = (outreach.agendamento ?? {}) as Record<string, unknown>
  const passos = (Array.isArray(cfg.passos) ? cfg.passos : [])
    .map((p, i) => {
      const row = (p ?? {}) as Record<string, unknown>
      return {
        horas: Number(row.horas) > 0 ? Number(row.horas) : (HORAS_PADRAO[i] ?? 0),
        texto: String(row.texto ?? '').trim(),
        video: row.video === true,
      }
    })
    .filter((p) => p.texto && p.horas > 0)

  return {
    enabled: cfg.enabled === true,
    ativadoEm: cfg.ativado_em ? String(cfg.ativado_em) : null,
    maxDias: Number(cfg.max_dias) > 0 ? Number(cfg.max_dias) : 30,
    capPorRodada: Number(cfg.cap_por_rodada) > 0 ? Number(cfg.cap_por_rodada) : CAP_PADRAO,
    videoPath: String(cfg.video_path ?? '').trim(),
    passos,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const cronSecret = (Deno.env.get('FOLLOWUP_AGENDAMENTO_CRON_SECRET') ?? '').trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()

  // NEGA na ausência de segredo. Rotina que fala com paciente não pode ficar aberta na
  // internet só porque alguém esqueceu de configurar a env.
  if (!cronSecret || provided !== cronSecret) return json({ error: 'unauthorized' }, 401)
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  const admin = createClient(supabaseUrl, serviceRole)

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  /** `{"dry": true}` lista quem receberia o quê, sem mandar nada. */
  const dryRun = body.dry === true

  const cfg = await carregarConfig(admin)

  // ── Reenvio do vídeo que ficou para trás ────────────────────────────────────────
  // `{"reenviarVideo": ["lead-x", ...], "legenda": "..."}` manda SÓ o vídeo para uma
  // lista escrita à mão. É a vassoura do estrago de 10/set/2026: enquanto a recusa por
  // ritmo contava como tentativa de anexo falhada, três pacientes receberam o texto
  // prometendo um vídeo que nunca vinha, e prometer de novo não desfaz o primeiro.
  //
  // NÃO mexe em `step`: a cadência já entregou aquele degrau. Isto é conserto, não
  // degrau novo — e por isso também não vira uma linha em `crm_followup_agendamento`.
  // A guarda anti-ban decide igual (o teto semanal por lead continua valendo), e o
  // envio sai pelo `crm-send-message`, que é quem grava a bolha no chat.
  const reenviar = (Array.isArray(body.reenviarVideo) ? body.reenviarVideo : [])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  if (reenviar.length > 0) {
    if (!cfg.videoPath) return json({ error: 'sem_video_configurado' }, 400)
    return await reenviarVideo(admin, reenviar, cfg.videoPath, String(body.legenda ?? '').trim(), dryRun)
  }

  if (!cfg.enabled) return json({ ok: true, desligado: true, at: nowIso() })
  if (cfg.passos.length === 0) return json({ ok: true, erro: 'sem_passos_configurados' }, 200)

  const minHoras = Math.min(...cfg.passos.map((p) => p.horas))

  const { data: parados, error: rpcErr } = await admin.rpc('crm_sem_agendamento_para_nutrir', {
    p_tenant: TENANT,
    p_min_horas: Math.max(1, Math.floor(minHoras)),
    p_desde: cfg.ativadoEm,
    p_max_dias: cfg.maxDias,
  })
  if (rpcErr) {
    console.error('followup-agendamento rpc:', rpcErr)
    return json({ error: rpcErr.message }, 500)
  }

  const leads = (parados as LeadParado[] | null) ?? []
  if (leads.length === 0) return json({ ok: true, encontrados: 0, enviadas: 0, at: nowIso() })

  // Estado de todo mundo de uma vez: a lista pode ter 200 nomes e uma query por lead seria
  // 200 idas ao banco por rodada.
  const { data: estados } = await admin
    .from('crm_followup_agendamento')
    .select('lead_id, step, last_sent_at, attempts')
    .in('lead_id', leads.map((l) => l.lead_id))
  const estadoPorLead = new Map<string, Estado>()
  for (const e of ((estados as Estado[] | null) ?? [])) estadoPorLead.set(e.lead_id, e)

  const agora = new Date()
  let enviadas = 0
  let gastoEmEsperaMs = 0
  const results: Array<Record<string, unknown>> = []

  for (const lead of leads) {
    if (enviadas >= cfg.capPorRodada) break

    const estado = estadoPorLead.get(lead.lead_id) ?? { lead_id: lead.lead_id, step: 0, last_sent_at: null, attempts: 0 }
    const proximo = estado.step // índice 0-based do degrau a enviar
    if (proximo >= cfg.passos.length) continue // já recebeu os três

    const passo = cfg.passos[proximo]
    if (lead.horas_parado < passo.horas) continue // ainda não venceu

    // Um degrau por dia, no máximo. Ver ESPACO_MINIMO_HORAS.
    if (estado.last_sent_at) {
      const desdeUltimo = (agora.getTime() - new Date(estado.last_sent_at).getTime()) / 3_600_000
      if (desdeUltimo < ESPACO_MINIMO_HORAS) continue
    }

    const texto = renderTexto(passo.texto, lead, agora)
    const comVideo = passo.video && cfg.videoPath && estado.attempts < TENTATIVAS_ATE_DESISTIR_DO_VIDEO

    if (dryRun) {
      results.push({
        leadId: lead.lead_id,
        nome: lead.patient_name,
        degrau: proximo + 1,
        horasParado: lead.horas_parado,
        comVideo,
        texto,
      })
      enviadas++
      continue
    }

    try {
      const enviar = () =>
        admin.functions.invoke('crm-send-message', {
          body: {
            leadId: lead.lead_id,
            text: texto,
            channel: 'whatsapp',
            source: 'followup_agendamento',
            // Polo da CONVERSA, não do cadastro: quem carimba é a linha por onde ela vive
            // ([[crm_venda_segue_a_linha_nao_a_pessoa]]).
            senderTenantId: lead.conversa_tenant_id,
            requireBotKind: lead.conversa_tenant_id === 'tricopill' ? 'sales' : 'clinic',
            // O texto vira legenda do vídeo: o `crm-send-message` cola a mensagem avulsa na
            // primeira peça sem legenda. Uma mensagem só, como uma pessoa mandaria.
            ...(comVideo ? { media: [{ storagePath: cfg.videoPath, kind: 'video' }] } : {}),
          },
        })

      // Sem `antiBanKind: 'transactional'` de propósito: isto NÃO é confirmação de um ato
      // que a pessoa acabou de praticar, é a casa puxando assunto. Passa pela guarda
      // inteira (janela, teto do dia, ritmo, teto semanal por lead).
      let { data: sendResult, error: sendErr } = await enviar()
      let ok = !sendErr && (sendResult as { ok?: boolean })?.ok !== false
      let recusa = ok ? null : await lerRecusa(sendErr, sendResult)

      // RITMO É RELÓGIO, não veredito: a guarda diz em quantos segundos a linha volta a
      // aceitar. Esperar o que ela pediu e tentar de novo é o que faz a rodada entregar
      // mais de um nome — antes, o 2º em diante batia na parede e ia embora recusado.
      if (recusa && recusa.reason === 'ritmo' && recusa.retryAfterSeconds) {
        const esperaMs = Math.min(recusa.retryAfterSeconds * 1000 + 2_000, ESPERA_MAX_MS)
        if (gastoEmEsperaMs + esperaMs <= ORCAMENTO_ESPERA_MS) {
          gastoEmEsperaMs += esperaMs
          await dormir(esperaMs)
          ;({ data: sendResult, error: sendErr } = await enviar())
          ok = !sendErr && (sendResult as { ok?: boolean })?.ok !== false
          recusa = ok ? null : await lerRecusa(sendErr, sendResult)
        } else {
          // Sem orçamento: o resto da lista levaria `ritmo` igual. Encerra a rodada em vez
          // de gastar uma recusa por nome — a próxima hora continua daqui.
          results.push({ leadId: lead.lead_id, status: 'adiado', degrau: proximo + 1, motivo: 'ritmo' })
          break
        }
      }

      if (!ok && recusa) {
        const motivo = `${recusa.error || 'recusado'}${recusa.reason ? `:${recusa.reason}` : ''} — ${recusa.message}`.slice(0, 200)
        // Recusa da guarda (fora de janela, teto do dia, teto semanal por lead) é "ainda
        // não", não "não": o degrau NÃO sobe e a próxima rodada tenta de novo. É assim que
        // o 3º degrau acaba saindo no 8º dia em vez do 7º, segurado pelo
        // `cap_proativo_semana_por_lead = 2` — e isso é a guarda funcionando.
        //
        // E ela NÃO gasta tentativa de vídeo: `attempts` só existe para desistir de um
        // anexo que quebrou. Ver `ehRecusaDaGuarda`.
        const daGuarda = ehRecusaDaGuarda(recusa)
        await admin.from('crm_followup_agendamento').upsert({
          lead_id: lead.lead_id,
          tenant_id: lead.tenant_id,
          step: estado.step,
          last_sent_at: estado.last_sent_at,
          attempts: daGuarda ? estado.attempts : estado.attempts + 1,
          last_reason: motivo,
          updated_at: nowIso(),
        })
        console.warn(`followup-agendamento recusado lead=${lead.lead_id}: ${motivo}`)
        results.push({ leadId: lead.lead_id, status: 'recusado', degrau: proximo + 1, motivo, daGuarda })
        continue
      }

      await admin.from('crm_followup_agendamento').upsert({
        lead_id: lead.lead_id,
        tenant_id: lead.tenant_id,
        step: proximo + 1,
        last_sent_at: nowIso(),
        attempts: 0,
        last_reason: null,
        updated_at: nowIso(),
      })

      enviadas++
      results.push({ leadId: lead.lead_id, status: 'enviada', degrau: proximo + 1, comVideo })
    } catch (e) {
      console.error(`followup-agendamento erro lead=${lead.lead_id}:`, e)
      results.push({ leadId: lead.lead_id, status: 'erro' })
    }
  }

  return json({
    ok: true,
    dryRun,
    encontrados: leads.length,
    enviadas,
    results,
    at: nowIso(),
  })
})
