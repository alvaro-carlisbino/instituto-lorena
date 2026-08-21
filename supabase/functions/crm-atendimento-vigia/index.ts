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
/** Não mexe em conversa velha: o que passou de 12h é assunto de follow-up, não de vigia. */
const HORAS_JANELA = 12

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

    return json({ ok: true, dry: body.dry === true, ...resultado })
  } catch (e) {
    return json({ ok: false, error: 'vigia_falhou', message: e instanceof Error ? e.message : String(e) }, 500)
  }
})
