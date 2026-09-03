import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { applyLeadName } from '../_shared/leadName.ts'
import { horaLocal } from '../_shared/whatsapp/antiBan.ts'

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
 * Retomada do lead da landing que a casa atendeu e que parou de responder.
 *
 * A EQUIPE PRIMEIRO, O ROBÔ DEPOIS — e essa ordem é a decisão, não um detalhe. Cada lead
 * da lista (`crm_landing_sem_retorno`) primeiro vira TAREFA no CRM, com data e dono, na
 * mesma tabela que a Central de Vendas já mostra (`lead_followups`). Só se essa tarefa
 * vencer e ninguém encostar nela é que sai mensagem automática. Quem atende continua
 * sendo gente; a automação é a rede embaixo, não o trapézio.
 *
 * Por que esta rotina existe, se já há três olhando "cliente sem resposta": porque as três
 * olham para o outro lado. `crm-followup-scheduler`, `crm_pendencias_abandonadas` e o sino
 * do `usePendingHandoff` só enxergam quem está esperando A GENTE. No instante em que a
 * Aline responde, o lead sai de todas, e quem sumiu depois disso não é de ninguém. Ver o
 * comentário da migration `20260831210000_landing_parada_vira_tarefa_e_retomada.sql`.
 *
 * A COPY ASSUME O ATRASO. Estes leads pediram consulta e esperaram de 15h a 63h pela
 * primeira palavra de um humano — cobrar "você sumiu" de quem ficou esperando é o erro
 * que já apareceu na tela do Álvaro em 18/ago. Ela também NÃO oferece dia nem horário: o
 * modo da linha é o meio-termo (`auto_scheduling_enabled = false`), quem fecha agenda é a
 * consultora, e esta rotina não abre exceção a essa regra.
 */

/** Dias, a partir do vencimento da tarefa, até a tarefa seguinte. Uma cobrança por degrau. */
const CADENCIA_DIAS = [2, 4]

/**
 * Horas de carência entre a tarefa vencer e o robô falar. É o tempo que a equipe tem
 * para pegar o lead na mão antes de a rede embaixo entrar. 24h = um dia útil inteiro.
 */
const CARENCIA_HORAS = 24

/** Teto por rodada: linha não-oficial que dispara em rajada é linha morta. */
const MAX_ENVIOS_POR_RODADA = 20

/**
 * `lead_followups.scheduled_for` é DATE, não timestamp — a agenda da equipe é por DIA.
 * Lida como `new Date('2026-08-31')` viraria meia-noite UTC, ou seja, 21h do dia ANTERIOR
 * em Maringá, e o robô falaria três horas antes do que a conta diz. Aqui a data é ancorada
 * na meia-noite local e a carência conta a partir dela.
 */
function prazoDaTarefa(scheduledFor: string, carenciaHoras: number): number {
  const dia = String(scheduledFor).slice(0, 10)
  return new Date(`${dia}T00:00:00-03:00`).getTime() + carenciaHoras * 3600_000
}

/** Data (não timestamp) para gravar em `scheduled_for`, no dia de Maringá. */
function diaLocal(at: Date = new Date()): string {
  return horaLocal(at).diaIso
}

const MENSAGENS = [
  'Oi, {name}! Aqui é a Sofia, do Instituto Lorena Visentainer. 💚 Desculpa a demora no retorno. ' +
    'Você chegou a receber as informações sobre a sua consulta capilar? Se ainda fizer sentido pra você, ' +
    'é só me responder aqui que eu retomo o seu atendimento.',
  '{name}, passando para não te deixar sem retorno 😊 O seu atendimento continua aberto aqui com a gente. ' +
    'Quando puder, me diz se ainda quer seguir que eu continuo de onde a gente parou.',
  '{name}, este é o meu último contato para não te incomodar 💚 Se um dia quiser retomar a conversa sobre a ' +
    'sua consulta, é só responder esta mensagem que a gente continua de onde parou. Um abraço!',
]

type LeadParado = {
  lead_id: string
  patient_name: string
  phone: string
  tenant_id: string
  conversa_tenant_id: string
  whatsapp_instance_id: string | null
  owner_id: string | null
  score: number | null
  temperature: string | null
  triagem: string | null
  ultima_saida: string
  ultima_entrada: string | null
  horas_parado: number
  respondeu: boolean
}

type Tarefa = {
  id: string
  attempt_no: number
  scheduled_for: string
  done_at: string | null
  dismissed_at: string | null
}

/** Nota que a atendente lê na fila, antes de ligar. Sem isso a tarefa é um nome e uma data. */
function notaDaTarefa(lead: LeadParado, tentativa: number): string {
  const espera = lead.respondeu
    ? `respondeu e depois parou (${lead.horas_parado}h sem falar)`
    : `NUNCA respondeu a primeira mensagem (${lead.horas_parado}h)`
  const triagem = lead.triagem ? ` · triagem: ${lead.triagem}` : ''
  const nota = lead.score != null ? ` · score ${lead.score}` : ''
  return `Lead da landing /consulta, tentativa ${tentativa}: ${espera}${nota}${triagem}. ` +
    `Se ninguém encostar em ${CARENCIA_HORAS}h, a Sofia manda uma retomada automática.`
}

/**
 * A tarefa vencida vira histórico e a próxima nasce no lugar dela.
 *
 * `lead_followups` tem índice único de UM aberto por lead (`lead_followups_um_aberto_idx`),
 * então fechar antes de abrir não é escolha de estilo: é o que a tabela permite. Fechar com
 * `outcome = 'Sem resposta'` é honesto — a tentativa aconteceu, só não foi humana, e a nota
 * diz isso com todas as letras para ninguém ler "feito" como "alguém ligou".
 */
async function fecharEAbrirProxima(
  admin: SupabaseClient,
  lead: LeadParado,
  tarefa: Tarefa,
  enviou: boolean,
): Promise<void> {
  const proximoIndice = tarefa.attempt_no // attempt_no é 1-based; o índice da próxima mensagem é este
  const temProxima = enviou && proximoIndice < MENSAGENS.length

  await admin
    .from('lead_followups')
    .update({
      done_at: nowIso(),
      outcome: 'Sem resposta',
      note: `${tarefa.attempt_no}ª tentativa: ${
        enviou ? 'retomada automática enviada pela Sofia' : 'venceu sem contato (envio recusado)'
      }, ninguém da equipe encostou na tarefa.`,
      updated_at: nowIso(),
    })
    .eq('id', tarefa.id)

  if (!temProxima) return

  const dias = CADENCIA_DIAS[Math.min(proximoIndice - 1, CADENCIA_DIAS.length - 1)]
  await admin.from('lead_followups').insert({
    tenant_id: lead.conversa_tenant_id,
    lead_id: lead.lead_id,
    attempt_no: tarefa.attempt_no + 1,
    scheduled_for: diaLocal(new Date(Date.now() + dias * 864e5)),
    channel: 'WhatsApp',
    owner_id: lead.owner_id,
    note: notaDaTarefa(lead, tarefa.attempt_no + 1),
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)

  // Esta função ABRE tarefa e MANDA mensagem para paciente, então ela fecha por padrão.
  //
  // O padrão herdado (`if (cronSecret && provided !== cronSecret)`) só tranca a porta
  // quando o segredo EXISTE: com a variável em branco, qualquer um com a chave `anon` —
  // que a landing carrega no navegador de quem vem do anúncio — dispara a rotina. E
  // `CRON_INBOX_SECRET` não está configurado neste projeto (conferido em 31/ago/2026),
  // ou seja, o guarda estava aberto no irmão `crm-followup-scheduler`. Aqui a ausência de
  // segredo NEGA em vez de liberar, e o service_role continua entrando direto para
  // chamada manual. Mesma lógica de [[supabase_rpc_aberta_anon]]: o padrão é fechado.
  const cronSecret = (
    Deno.env.get('LANDING_RETOMADA_CRON_SECRET') ?? Deno.env.get('CRON_INBOX_SECRET') ?? ''
  ).trim()
  const provided = (req.headers.get('x-cron-secret') ?? '').trim()
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  const autorizado = (cronSecret.length > 0 && provided === cronSecret) || bearer === serviceRole
  if (!autorizado) return json({ error: 'unauthorized' }, 401)

  const admin = createClient(supabaseUrl, serviceRole)

  let body: Record<string, unknown> = {}
  try {
    body = req.method === 'POST' ? ((await req.json()) ?? {}) : {}
  } catch {
    body = {}
  }
  // `dryRun` existe para a primeira rodada em produção: lista o que faria sem abrir tarefa
  // nem falar com ninguém. Rotina que só se conhece depois de ter mandado mensagem é
  // rotina que se conhece tarde demais.
  const dryRun = body.dryRun === true
  const minHoras = Number(body.minHoras ?? 20)
  const maxDias = Number(body.maxDias ?? 30)

  const { data: parados, error: rpcErr } = await admin.rpc('crm_landing_sem_retorno', {
    p_min_horas: minHoras,
    p_max_dias: maxDias,
  })
  if (rpcErr) {
    console.error('crm-landing-retomada rpc:', rpcErr)
    return json({ error: rpcErr.message }, 500)
  }

  const leads = (parados ?? []) as LeadParado[]
  let tarefasAbertas = 0
  let enviadas = 0
  let aguardandoEquipe = 0
  let encerrados = 0
  const results: Array<Record<string, unknown>> = []

  for (const lead of leads) {
    if (enviadas >= MAX_ENVIOS_POR_RODADA) break

    const { data: tarefas } = await admin
      .from('lead_followups')
      .select('id, attempt_no, scheduled_for, done_at, dismissed_at')
      .eq('lead_id', lead.lead_id)
      .order('attempt_no', { ascending: false })
      .limit(20)

    const historico = (tarefas ?? []) as Tarefa[]
    const aberta = historico.find((t) => !t.done_at && !t.dismissed_at)

    // ── 1. Sem tarefa aberta: a equipe leva a primeira chance ──────────────────
    if (!aberta) {
      // Já dispensada ou já cumprida a cadência inteira? Então acabou: dispensar é ordem
      // humana explícita, e ela não pode ser desfeita por um cron que roda de hora em hora.
      const dispensada = historico.some((t) => t.dismissed_at)
      const tentativasFeitas = historico.length
      if (dispensada || tentativasFeitas >= MENSAGENS.length) {
        encerrados++
        results.push({ leadId: lead.lead_id, status: dispensada ? 'dispensado' : 'cadencia_cumprida' })
        continue
      }
      if (dryRun) {
        tarefasAbertas++
        results.push({ leadId: lead.lead_id, status: 'abriria_tarefa', tentativa: tentativasFeitas + 1 })
        continue
      }
      const { error: insErr } = await admin.from('lead_followups').insert({
        tenant_id: lead.conversa_tenant_id,
        lead_id: lead.lead_id,
        attempt_no: tentativasFeitas + 1,
        // Vence HOJE: o lead já está parado há `horas_parado`. A carência de 24h abaixo é
        // que dá o tempo da equipe, e ela conta do vencimento, não da criação.
        scheduled_for: diaLocal(),
        channel: 'WhatsApp',
        owner_id: lead.owner_id,
        note: notaDaTarefa(lead, tentativasFeitas + 1),
      })
      if (insErr) {
        console.warn(`retomada: tarefa não abriu lead=${lead.lead_id}:`, insErr.message)
        results.push({ leadId: lead.lead_id, status: 'tarefa_falhou' })
        continue
      }
      tarefasAbertas++
      results.push({ leadId: lead.lead_id, status: 'tarefa_aberta', tentativa: tentativasFeitas + 1 })
      continue
    }

    // ── 2. Tarefa aberta e ainda no prazo: a vez é da equipe ───────────────────
    const venceEm = prazoDaTarefa(aberta.scheduled_for, CARENCIA_HORAS)
    if (Date.now() < venceEm) {
      aguardandoEquipe++
      results.push({ leadId: lead.lead_id, status: 'com_a_equipe', ate: new Date(venceEm).toISOString() })
      continue
    }

    // ── 3. Venceu sem ninguém encostar: a rede embaixo entra ───────────────────
    const indice = Math.min(aberta.attempt_no - 1, MENSAGENS.length - 1)
    const texto = applyLeadName(MENSAGENS[indice], lead.patient_name, 'name')
    const phoneDigits = String(lead.phone ?? '').replace(/[^0-9]/g, '')
    // 888001… é o telefone sintético do ManyChat: não existe no WhatsApp.
    if (phoneDigits.length < 10 || phoneDigits.startsWith('888001')) {
      results.push({ leadId: lead.lead_id, status: 'sem_telefone_real' })
      continue
    }
    if (dryRun) {
      enviadas++
      results.push({ leadId: lead.lead_id, status: 'enviaria', tentativa: aberta.attempt_no, texto })
      continue
    }

    try {
      const { data: sendResult, error: sendErr } = await admin.functions.invoke('crm-send-message', {
        body: {
          leadId: lead.lead_id,
          text: texto,
          channel: 'whatsapp',
          source: 'followup_scheduler',
          // Polo da CONVERSA, não do cadastro: quem carimba é a linha por onde ela vive.
          senderTenantId: lead.conversa_tenant_id,
          requireBotKind: lead.conversa_tenant_id === 'tricopill' ? 'sales' : 'clinic',
        },
      })
      // Sem `antiBanKind: 'transactional'` de propósito: isto NÃO é confirmação de um ato
      // que a pessoa acabou de praticar, é a casa puxando assunto. Passa pela guarda
      // inteira (janela, teto, ritmo) como qualquer outra cobrança.
      const ok = !sendErr && (sendResult as { ok?: boolean })?.ok !== false
      if (!ok) {
        console.warn(`retomada: envio recusado lead=${lead.lead_id}:`, sendErr ?? sendResult)
        // A tarefa NÃO é fechada aqui: recusa da guarda (fora de janela, teto do dia) é
        // "ainda não", não "não". A próxima rodada tenta de novo.
        results.push({ leadId: lead.lead_id, status: 'envio_recusado' })
        continue
      }
      await fecharEAbrirProxima(admin, lead, aberta, true)
      enviadas++
      results.push({ leadId: lead.lead_id, status: 'retomada_enviada', tentativa: aberta.attempt_no })
    } catch (e) {
      console.error(`retomada erro lead=${lead.lead_id}:`, e)
      results.push({ leadId: lead.lead_id, status: 'erro' })
    }
  }

  return json({
    ok: true,
    dryRun,
    encontrados: leads.length,
    tarefasAbertas,
    aguardandoEquipe,
    enviadas,
    encerrados,
    results,
    at: nowIso(),
  })
})
