import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { evaluateCrmAiAutoReplyGate, runWhatsappAiAutoReply } from '../_shared/crmAiAutoReply.ts'
import { resolveOutboundProviderForLead } from '../_shared/whatsapp/resolveProvider.ts'
import { notifyAgents } from '../_shared/notifyAgents.ts'
import { notifyOwnerWhatsapp } from '../_shared/saleReceipt.ts'

/**
 * Vigia do atendimento: ninguém fica no vácuo.
 *
 * Duas faltas silenciosas, uma função:
 *
 * 1. **A IA devia ter respondido e não respondeu.** O webhook grava o job como
 *    `processing` e só depois chama o modelo; se a função morre no meio (timeout do
 *    modelo, 504 do gateway), o job fica `processing` para sempre e a mensagem do cliente
 *    some do fluxo. Em 20/08/2026 havia 4 jobs assim na linha do Tricopill, um deles de um
 *    cliente que tinha acabado de dizer "1 frasco" — quase duas horas sem resposta. Nada,
 *    em lugar nenhum, recuperava esses casos.
 *
 * 2. **Está em modo Humano e ninguém assumiu.** Aqui a IA cala por regra (é o handoff), e
 *    isso está certo — mas silêncio de uma hora não é handoff, é cliente abandonado. O
 *    vigia cutuca a equipe e, se demorar demais, o dono no WhatsApp.
 *
 * A pergunta que o vigia faz é sempre a mesma, e é a única que importa: **existe mensagem
 * de entrada sem nenhuma saída depois dela?** Não olha job, não olha estado interno — olha
 * a conversa. Assim ele cobre qualquer causa, inclusive as que ainda não conhecemos.
 *
 * Cron: a cada 5 minutos. verify_jwt=false + x-cron-secret opcional.
 */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** Minutos de silêncio antes de cada providência. */
const MIN_RETOMAR_IA = 6 // a IA demora até ~2min; 6 já é anomalia
const MIN_AVISAR_EQUIPE = 30
const MIN_AVISAR_DONO = 90
/**
 * Janela QUENTE: aqui a IA ainda pode retomar a conversa. Passadas 12h, responder um "oi"
 * de ontem como se fosse agora é pior do que não responder, então a IA cala e o caso vira
 * cobrança da equipe (bloco 3 abaixo).
 */
const HORAS_JANELA = 12

// ── Zona morta (21/ago/2026) ────────────────────────────────────────────────
// Este arquivo dizia "o que passou de 12h é assunto de follow-up". O sino dizia o mesmo
// ("viram lead frio: vão para follow-up", usePendingHandoff.ts). E o follow-up não podia
// pegar nenhum dos dois: `crm-followup-scheduler` exige ai_enabled=true E owner_mode
// diferente de 'human', que é exatamente o que `disableAiOnHandoff` desfaz quando a Sofia
// entrega o lead para a atendente. E esse handoff não expira.
//
// Resultado: no instante em que o lead vira oportunidade de verdade, ele saía de todas as
// redes ao mesmo tempo. Medição do dia: 190 conversas na clínica e 44 no Tricopill com a
// última mensagem do cliente e nenhuma resposta; pior caso esperando 88 dias.
//
// A saída aqui é COBRAR A EQUIPE, não falar com o paciente: handoff desliga a IA e essa
// regra continua de pé. Nada é enviado para o cliente por este bloco.
/** Abaixo disto ainda é a janela quente acima. */
const HORAS_ABANDONO_MIN = HORAS_JANELA
/** Acima disto a conversa é arqueologia, não fila de trabalho. */
const DIAS_ABANDONO_MAX = 90
/** Fronteira entre "esfriou ontem" (cobra sempre) e passivo acumulado (entra com teto). */
const HORAS_PASSIVO = 48
/**
 * Quantos leads do PASSIVO estreiam na cobrança por dia. Sem teto, o conserto despejaria
 * 224 alertas de uma vez e enterraria justamente quem está esperando hoje, que é o medo
 * escrito na fila do sino. A 25/dia o acumulado escoa em ~9 dias.
 */
const TETO_PASSIVO_DIA = 25
/** Teto por volta (o cron roda de 5 em 5 min); o teto do dia é quem manda de verdade. */
const MAX_ABANDONO_POR_VOLTA = 5

/**
 * Cadência decrescente: quem esfriou ontem é cobrado todo dia, quem esfriou na semana
 * passada de 3 em 3 dias, e o resto uma vez por semana. Cobrar o de 60 dias com a mesma
 * insistência do de ontem treina a equipe a ignorar o alerta inteiro.
 */
function intervaloCobrancaMin(horas: number): number {
  if (horas <= HORAS_PASSIVO) return 24 * 60
  if (horas <= 7 * 24) return 72 * 60
  return 7 * 24 * 60
}

function humanizarEspera(horas: number): string {
  if (horas < 48) return `${horas}h`
  return `${Math.floor(horas / 24)} dias`
}

type Pendencia = {
  lead_id: string
  patient_name: string
  phone: string
  tenant_id: string
  whatsapp_instance_id: string | null
  content: string
  happened_at: string
  minutos: number
  owner_mode: string
  ai_enabled: boolean
  /** Polo da CONVERSA (carimbo da última mensagem recebida). Pode diferir do cadastro. */
  conversa_tenant_id?: string | null
}

/**
 * Quem escreveu e não recebeu nada depois. Feito em SQL porque a pergunta é relacional
 * ("não existe saída posterior") e trazer as interações para o Deno seria varrer milhares
 * de linhas a cada 5 minutos.
 */
async function pendenciasSemResposta(admin: SupabaseClient): Promise<Pendencia[]> {
  const { data, error } = await admin.rpc('crm_pendencias_sem_resposta', {
    p_horas: HORAS_JANELA,
    p_min_minutos: MIN_RETOMAR_IA,
  })
  if (error) throw new Error(`rpc_falhou: ${error.message}`)
  return ((data ?? []) as Pendencia[]).filter((p) => p.phone && !p.phone.startsWith('888'))
}

type Abandonada = Omit<Pendencia, 'minutos'> & { horas: number }

/**
 * A zona morta: cliente falou por último, ninguém respondeu, e já passou da janela quente.
 *
 * Sem o filtro de telefone sintético que a fila de cima usa: aqui ninguém envia nada, só
 * se cobra a equipe, e um lead de Instagram sem WhatsApp de verdade é respondido no chat
 * do CRM como qualquer outro. Excluí-lo só o esconderia.
 */
async function pendenciasAbandonadas(admin: SupabaseClient): Promise<Abandonada[]> {
  const { data, error } = await admin.rpc('crm_pendencias_abandonadas', {
    p_min_horas: HORAS_ABANDONO_MIN,
    p_max_dias: DIAS_ABANDONO_MAX,
  })
  if (error) throw new Error(`rpc_abandono_falhou: ${error.message}`)
  return (data ?? []) as Abandonada[]
}

/**
 * Quando cada lead foi cobrado pela última vez, por trilha.
 *
 * Existe porque o dedupe do `notifyAgents` é tarde demais para esta decisão: ele impede a
 * notificação repetida, mas o lead já gastou a vaga da volta. Com 10 conversas frescas e
 * 5 vagas por volta, as mesmas 10 ocupariam todas as vagas de 5 em 5 minutos durante 24h
 * e o passivo NUNCA sairia do lugar. Quem já foi cobrado tem de sair da fila antes do
 * corte, não depois.
 *
 * Conta LEAD distinto, não linha: `notifyAgents` grava uma linha por destinatário.
 */
async function ultimaCobrancaPorLead(admin: SupabaseClient): Promise<Map<string, number>> {
  const desde = new Date(Date.now() - 8 * 24 * 3_600_000).toISOString() // maior cadência + folga
  const mapa = new Map<string, number>()
  for (const lane of ['vigia-fresco', 'vigia-passivo']) {
    const { data } = await admin
      .from('app_inbox_notifications')
      .select('metadata, created_at')
      .gte('created_at', desde)
      .contains('metadata', { dedupeKey: lane })
      .limit(5000)
    for (const row of (data ?? []) as Array<{ metadata?: { leadId?: string }; created_at: string }>) {
      const id = row.metadata?.leadId
      if (!id) continue
      const quando = new Date(row.created_at).getTime()
      const atual = mapa.get(String(id)) ?? 0
      if (quando > atual) mapa.set(String(id), quando)
    }
  }
  return mapa
}

/** Leads distintos do passivo que estrearam na cobrança desde a virada do dia. */
function passivoCobradoHoje(ultima: Map<string, number>, passivo: Abandonada[]): number {
  const inicioDoDia = new Date()
  inicioDoDia.setUTCHours(0, 0, 0, 0)
  const corte = inicioDoDia.getTime()
  let n = 0
  for (const a of passivo) {
    const quando = ultima.get(a.lead_id)
    if (quando && quando >= corte) n++
  }
  return n
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ ok: false, error: 'server_misconfigured' }, 500)

  const cronSecret = (Deno.env.get('CRON_SECRET') ?? '').trim()
  if (cronSecret && (req.headers.get('x-cron-secret')?.trim() ?? '') !== cronSecret) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRole)
  let body: { dry?: boolean; max?: number } = {}
  try {
    body = req.method === 'POST' ? ((await req.json()) as typeof body) : {}
  } catch {
    body = {}
  }
  const max = Math.max(1, Math.min(20, body.max ?? 5))

  try {
    const pendentes = await pendenciasSemResposta(admin)
    const resultado = {
      olhados: pendentes.length,
      ia_retomada: 0,
      equipe_avisada: 0,
      dono_avisado: 0,
      detalhes: [] as Array<{ lead: string; nome: string; minutos: number; acao: string; motivo?: string }>,
    }

    for (const p of pendentes.slice(0, max)) {
      const registrar = (acao: string, motivo?: string) =>
        resultado.detalhes.push({ lead: p.lead_id, nome: p.patient_name, minutos: p.minutos, acao, motivo })

      // ── 1. A IA devia ter respondido? ────────────────────────────────────────
      // RETOMAR é continuar a conversa parada, então quem manda é o polo DELA, não o do
      // cadastro da pessoa. `conversa_tenant_id` é o carimbo da última mensagem recebida,
      // que segue a linha por onde ela entrou (trigger de 14/ago).
      //
      // Passando o tenant do CADASTRO, como era até 21/ago/26, o resolvedor descartava a
      // linha de vendas como "de outro polo" e o vigia respondia pelo número da CLÍNICA:
      // Hugo Bongiorno recebeu às 08:51 a conferência do comprovante do shampoo pelo
      // WhatsApp do Instituto. São 13 leads da clínica vivendo na linha de vendas.
      //
      // `bindDefault: false` porque vigia não reescreve vínculo de conversa.
      const poloDaConversa = String(p.conversa_tenant_id ?? '').trim() || p.tenant_id
      let linhaDaConversa: string | null = null
      let provider
      try {
        const resolvido = await resolveOutboundProviderForLead(
          admin,
          { id: p.lead_id, whatsapp_instance_id: p.whatsapp_instance_id, tenant_id: poloDaConversa },
          { bindDefault: false },
        )
        // Trava final: se nem assim a linha for do polo da conversa, o vigia cala. Deixar a
        // pessoa esperando é menos pior do que responder pelo número do outro negócio (a
        // etapa 2, de avisar a equipe, continua rodando logo abaixo).
        if (resolvido.lineTenantId && resolvido.lineTenantId !== poloDaConversa) {
          registrar('sem_linha', `conversa é ${poloDaConversa} e a linha resolvida é ${resolvido.lineTenantId}`)
          continue
        }
        provider = resolvido.provider
        linhaDaConversa = resolvido.instanceId
      } catch (e) {
        registrar('sem_linha', e instanceof Error ? e.message.slice(0, 120) : String(e))
        continue
      }

      const gate = await evaluateCrmAiAutoReplyGate(admin, p.lead_id, {
        directionIsInbound: true,
        whatsappInstanceId: linhaDaConversa,
      })

      if (gate.canAutoReply) {
        if (body.dry === true) {
          registrar('retomaria_ia')
          continue
        }
        try {
          const { data: st } = await admin
            .from('crm_conversation_states')
            .select('prompt_override')
            .eq('lead_id', p.lead_id)
            .maybeSingle()
          // Prompt do polo da CONVERSA. Com o do cadastro, a pessoa que fala de pedido na
          // linha de vendas era atendida com o prompt da clínica (Sofia, agenda, triagem).
          const { data: cfg } = await admin
            .from('crm_ai_configs')
            .select('system_prompt')
            .eq('id', 'default')
            .eq('tenant_id', poloDaConversa)
            .maybeSingle()

          const { replied } = await runWhatsappAiAutoReply(admin, {
            leadId: p.lead_id,
            patientName: p.patient_name,
            fromPhone: p.phone,
            aiInboundUserText: p.content,
            inboundHappenedAt: p.happened_at,
            ownerMode: gate.ownerMode,
            aiEnabled: gate.aiEnabled,
            statePrompt: String(
              (st as { prompt_override?: string } | null)?.prompt_override ??
                (cfg as { system_prompt?: string } | null)?.system_prompt ??
                '',
            ).trim(),
            aiJobSource: 'vigia_atendimento',
            whatsappInstanceId: linhaDaConversa,
            sendProvider: provider,
            // Rajada já passou (a mensagem está parada há minutos): responde agora, não
            // reenfileira — senão o vigia devolveria o cliente para a mesma fila que falhou.
            burstFlush: true,
          })
          if (replied) {
            resultado.ia_retomada++
            registrar('ia_respondeu')
          } else {
            registrar('ia_nao_respondeu')
          }
        } catch (e) {
          registrar('ia_falhou', e instanceof Error ? e.message.slice(0, 120) : String(e))
        }
        continue
      }

      // ── 2. Está com humano e ninguém assumiu ─────────────────────────────────
      if (p.minutos >= MIN_AVISAR_DONO) {
        if (body.dry === true) {
          registrar('avisaria_dono')
          continue
        }
        const texto =
          `⏰ *${p.patient_name}* está sem resposta há ${Math.floor(p.minutos / 60)}h${String(p.minutos % 60).padStart(2, '0')}.\n` +
          `Última mensagem: "${p.content.slice(0, 90)}"\n` +
          `WhatsApp: ${p.phone}`
        // Passa pelo filtro de assuntos do polo: quem só quer venda e Ads não recebe isto
        // no WhatsApp — mas o alerta in-app abaixo sai de qualquer jeito, para a equipe.
        await notifyOwnerWhatsapp(admin, p.tenant_id, 'cliente_esperando', texto)
        await notifyAgents(admin, {
          leadId: p.lead_id,
          kind: 'urgent',
          title: '⏰ Cliente esperando há muito tempo',
          body: `${p.patient_name} está sem resposta há ${p.minutos} minutos.`,
          includeOwner: true,
          tenantId: p.tenant_id,
          dedupeKey: `vigia-dono-${p.lead_id}`,
          dedupeWindowMinutes: 180,
        }).catch(() => {})
        resultado.dono_avisado++
        registrar('dono_avisado')
        continue
      }

      if (p.minutos >= MIN_AVISAR_EQUIPE) {
        if (body.dry === true) {
          registrar('avisaria_equipe')
          continue
        }
        await notifyAgents(admin, {
          leadId: p.lead_id,
          kind: 'urgent',
          title: 'Cliente aguardando atendimento',
          body: `${p.patient_name} escreveu há ${p.minutos} minutos e ninguém respondeu.`,
          includeOwner: true,
          tenantId: p.tenant_id,
          dedupeKey: `vigia-equipe-${p.lead_id}`,
          dedupeWindowMinutes: 60,
        }).catch(() => {})
        resultado.equipe_avisada++
        registrar('equipe_avisada')
        continue
      }

      registrar('aguardando', `IA calada (${p.owner_mode}), ${p.minutos}min`)
    }

    // ── 3. Esfriou e ninguém voltou ──────────────────────────────────────────
    // Ninguém fala com o paciente aqui. O bloco só empurra o caso de volta para a mesa de
    // quem pode resolver, com cadência decrescente para não virar ruído.
    const abandono = { olhados: 0, frescos_cobrados: 0, passivo_cobrado: 0, teto_batido: false }
    try {
      const abandonadas = await pendenciasAbandonadas(admin)
      abandono.olhados = abandonadas.length

      const ultima = await ultimaCobrancaPorLead(admin)
      // Fora quem ainda está dentro da própria cadência. Sem este corte a fila nunca anda.
      const devido = (a: Abandonada) => {
        const quando = ultima.get(a.lead_id)
        if (!quando) return true
        return Date.now() - quando >= intervaloCobrancaMin(a.horas) * 60_000
      }

      const frescas = abandonadas.filter((a) => a.horas <= HORAS_PASSIVO)
      // Passivo entra do MAIS RECENTE para o mais antigo, ao contrário da fila quente.
      // Ali "quem esperou mais vai primeiro" é justo porque todo mundo ainda é recuperável.
      // Aqui não: o teto é de 25 por dia e quem escreveu anteontem tem chance real, enquanto
      // o de 88 dias já resolveu a vida em outro lugar. Estrear a cobrança pelos mais velhos
      // gastaria a primeira semana em arqueologia e ensinaria a equipe a ignorar o alerta.
      const passivo = abandonadas
        .filter((a) => a.horas > HORAS_PASSIVO)
        .sort((a, b) => a.horas - b.horas)

      // O passivo tem teto do dia; quem esfriou ontem não espera na fila do passivo.
      const sobraDoDia = Math.max(0, TETO_PASSIVO_DIA - passivoCobradoHoje(ultima, passivo))
      abandono.teto_batido = passivo.length > 0 && sobraDoDia === 0

      // Orçamento por trilha, não compartilhado: dez conversas de ontem não podem consumir
      // as vagas do passivo, nem o contrário.
      const fila = [
        ...frescas.filter(devido).slice(0, MAX_ABANDONO_POR_VOLTA)
          .map((a) => ({ item: a, lane: 'fresco' as const })),
        ...passivo.filter(devido).slice(0, Math.min(sobraDoDia, MAX_ABANDONO_POR_VOLTA))
          .map((a) => ({ item: a, lane: 'passivo' as const })),
      ]

      for (const { item, lane } of fila) {
        if (body.dry === true) {
          resultado.detalhes.push({
            lead: item.lead_id,
            nome: item.patient_name,
            minutos: item.horas * 60,
            acao: `cobraria_${lane}`,
          })
          continue
        }
        const espera = humanizarEspera(item.horas)
        const criadas = await notifyAgents(admin, {
          leadId: item.lead_id,
          kind: 'urgent',
          title: `Sem resposta há ${espera}`,
          body: `${item.patient_name} escreveu "${item.content.slice(0, 70)}" e ninguém respondeu.`,
          includeOwner: true,
          // Polo da CONVERSA: quem cobra é o time da linha por onde a pessoa falou, não o
          // do cadastro. Mesma regra do bloco 1.
          tenantId: String(item.conversa_tenant_id ?? '').trim() || item.tenant_id,
          dedupeKey: `vigia-${lane}`,
          dedupeWindowMinutes: intervaloCobrancaMin(item.horas),
        }).catch(() => 0)
        if (criadas > 0) {
          if (lane === 'fresco') abandono.frescos_cobrados++
          else abandono.passivo_cobrado++
        }
        resultado.detalhes.push({
          lead: item.lead_id,
          nome: item.patient_name,
          minutos: item.horas * 60,
          acao: criadas > 0 ? `cobrado_${lane}` : 'ja_cobrado',
        })
      }
    } catch (e) {
      // O bloco novo não pode derrubar o vigia quente: quem espera há 40 minutos importa
      // mais do que quem espera há 40 dias.
      console.warn('[vigia] abandono falhou:', e instanceof Error ? e.message : String(e))
    }

    return json({ ok: true, dry: body.dry === true, ...resultado, abandono })
  } catch (e) {
    return json({ ok: false, error: 'vigia_falhou', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
