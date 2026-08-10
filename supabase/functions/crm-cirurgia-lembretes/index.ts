import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// ─────────────────────────────────────────────────────────────────────────────
// Lembretes de cirurgia: D-30, D-15, D-7 e D-2.
//
// O problema que isso resolve: o desmarque de véspera. Hoje a Aline descobre que
// falta exame quando liga na semana da cirurgia, e o paciente que quer remarcar
// espera o último dia porque sabe que ninguém vai cobrar a multa. O D-30 avisa
// dos exames e do prazo de remanejamento enquanto ainda dá tempo dos dois lados.
//
// A fila é montada pelo banco (trigger clinic_sales_after_write). Aqui só sai
// enviando o que já venceu.
//
// SEGURANÇA: só manda de verdade com CIRURGIA_LEMBRETES_ENABLED='true'. Sem isso
// roda em DRY-RUN e grava status 'simulado', para conferir texto e destinatário
// antes de falar com paciente de verdade.
//
// ANTI-BAN: no máximo MAX_POR_RODADA por execução, com 8 a 20 segundos entre uma
// mensagem e outra. É mensagem transacional para quem já comprou, mas rajada é
// rajada e o número é o da clínica.
//
// Env:
//   CIRURGIA_LEMBRETES_ENABLED  'true' liga o envio real (default: dry-run)
//   CIRURGIA_LEMBRETES_MAX      teto por rodada (default 25)
//   CIRURGIA_POLITICA_TEXTO     a cláusula de remanejamento, do contrato
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const ENABLED = (Deno.env.get('CIRURGIA_LEMBRETES_ENABLED') ?? '').trim().toLowerCase() === 'true'
const MAX_POR_RODADA = Number(Deno.env.get('CIRURGIA_LEMBRETES_MAX') ?? '25')

// Redação fiel ao Item 40 do contrato ("TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO
// / CONTRATO DE PRESTAÇÃO DE SERVIÇOS"): aviso com no mínimo 30 dias, multa de 30%
// do valor total abaixo disso, e isenção por motivo de saúde comprovado. O secret
// permite trocar sem deploy se o jurídico mudar a cláusula.
const POLITICA =
  (Deno.env.get('CIRURGIA_POLITICA_TEXTO') ?? '').trim() ||
  'Sobre remarcação: o contrato pede aviso com no mínimo 30 dias de antecedência. ' +
    'Abaixo desse prazo, está prevista multa de 30% do valor total, que não se aplica ' +
    'quando há impedimento por motivo de saúde comprovado.'

// Item 39 do mesmo contrato. Vai no D-15, que é quando ainda dá tempo de resolver.
const PAGAMENTO =
  (Deno.env.get('CIRURGIA_PAGAMENTO_TEXTO') ?? '').trim() ||
  'O contrato prevê o valor do procedimento quitado até 10 dias antes da cirurgia.'

type Kind = 'd30' | 'd15' | 'd7' | 'd2'

type Fila = {
  id: string
  kind: Kind
  scheduled_for: string
  sale_id: string
  clinic_sales: {
    lead_id: string | null
    patient_name: string
    scheduled_at: string | null
    procedure_label: string
    status: string
  } | null
}

const primeiroNome = (s: string) => String(s ?? '').trim().split(/\s+/)[0] || 'tudo bem'

const dataBonita = (iso: string | null) => {
  if (!iso) return 'a definir'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' })
}

const horaBonita = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/**
 * Sem travessão e sem emoji: é aviso de procedimento cirúrgico, não promoção.
 *
 * O texto pede conferência em vez de afirmar que falta. O checklist é preenchido
 * pela clínica, e item não marcado quer dizer "ninguém marcou aqui", não
 * "o paciente não entregou". Cobrar o que já foi entregue queima a confiança do
 * aviso inteiro, e aí ninguém lê mais. Corta em 4 itens para não virar parede.
 */
const MAX_ITENS = 4

function montarTexto(kind: Kind, nome: string, quando: string, hora: string, pendentes: string[]): string {
  const lista = pendentes.slice(0, MAX_ITENS).join(', ')
  const resto = pendentes.length > MAX_ITENS ? `, entre outros` : ''
  const falta = pendentes.length > 0
    ? `\n\nConfere se já nos enviou: ${lista}${resto}. Se já mandou, pode desconsiderar.`
    : ''
  switch (kind) {
    case 'd30':
      return (
        `Oi, ${nome}! Sua cirurgia está marcada para ${quando}${hora ? `, às ${hora}` : ''}.\n\n` +
        (pendentes.length > 0
          ? `Já dá para ir preparando a documentação.${falta}`
          : `Os exames pré-operatórios e a avaliação de risco cirúrgico podem ser feitos a partir de agora. ` +
            `Assim que estiverem prontos, é só enviar aqui neste contato.`) +
        `\n\n${POLITICA}`
      )
    case 'd15':
      return (
        `Oi, ${nome}! Faltam 15 dias para a sua cirurgia (${quando}).${falta}\n\n` +
        `${PAGAMENTO}\n\nQualquer dúvida é só chamar por aqui.`
      )
    case 'd7':
      return (
        `Oi, ${nome}! Sua cirurgia é semana que vem, dia ${quando}${hora ? `, às ${hora}` : ''}.${falta}\n\n` +
        `Nos próximos dias mandamos as orientações de preparo (jejum, medicação e o que levar).`
      )
    case 'd2':
      return (
        `Oi, ${nome}! Sua cirurgia é ${quando}${hora ? `, às ${hora}` : ''}. Está tudo confirmado por aqui.${falta}\n\n` +
        `Se precisar de qualquer coisa antes, é só responder esta mensagem.`
      )
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(url, serviceRole)

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  const { data, error } = await admin
    .from('surgery_reminders')
    .select(
      'id, kind, scheduled_for, sale_id, clinic_sales!inner(lead_id, patient_name, scheduled_at, procedure_label, status)',
    )
    .eq('status', 'pendente')
    .lte('scheduled_for', hoje)
    .order('scheduled_for', { ascending: true })
    .limit(MAX_POR_RODADA)
  if (error) return json({ error: error.message }, 500)

  const fila = (data ?? []) as unknown as Fila[]
  const resultado: Array<Record<string, unknown>> = []
  let enviados = 0

  for (const r of fila) {
    const venda = r.clinic_sales
    if (!venda || venda.status === 'cancelada') {
      await admin.from('surgery_reminders').update({ status: 'cancelado' }).eq('id', r.id)
      continue
    }

    // A cirurgia já passou? Não existe "sua cirurgia está chegando" depois dela.
    if (venda.scheduled_at && new Date(venda.scheduled_at).getTime() < Date.now()) {
      await admin.from('surgery_reminders').update({ status: 'cancelado' }).eq('id', r.id)
      continue
    }

    const { data: itens } = await admin
      .from('surgery_checklist_items')
      .select('item, required, received_at')
      .eq('sale_id', r.sale_id)
      .is('received_at', null)
    const pendentes = (itens ?? []).filter((i) => i.required === true).map((i) => String(i.item))

    const texto = montarTexto(
      r.kind,
      primeiroNome(venda.patient_name),
      dataBonita(venda.scheduled_at),
      horaBonita(venda.scheduled_at),
      pendentes,
    )

    if (!venda.lead_id) {
      await admin
        .from('surgery_reminders')
        .update({ status: 'erro', error: 'venda sem lead vinculado', message: texto })
        .eq('id', r.id)
      resultado.push({ sale: r.sale_id, kind: r.kind, skip: 'sem lead' })
      continue
    }

    if (!ENABLED) {
      await admin
        .from('surgery_reminders')
        .update({ status: 'simulado', message: texto, sent_at: new Date().toISOString() })
        .eq('id', r.id)
      resultado.push({ paciente: venda.patient_name, kind: r.kind, dryRun: true, texto })
      continue
    }

    try {
      const res = await fetch(`${url}/functions/v1/crm-send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRole}` },
        body: JSON.stringify({ leadId: venda.lead_id, text: texto, source: 'cirurgia_lembrete' }),
      })
      const ok = res.ok
      const corpo = await res.text()
      await admin
        .from('surgery_reminders')
        .update({
          status: ok ? 'enviado' : 'erro',
          message: texto,
          sent_at: new Date().toISOString(),
          error: ok ? null : corpo.slice(0, 400),
          channel: 'whatsapp',
        })
        .eq('id', r.id)
      if (ok) enviados += 1
      resultado.push({ paciente: venda.patient_name, kind: r.kind, ok })
    } catch (e) {
      await admin
        .from('surgery_reminders')
        .update({ status: 'erro', error: e instanceof Error ? e.message : 'falha no envio', message: texto })
        .eq('id', r.id)
      resultado.push({ paciente: venda.patient_name, kind: r.kind, ok: false })
    }

    // Intervalo irregular entre 8 e 20 segundos.
    await dormir(8000 + Math.floor(Math.random() * 12000))
  }

  return json({ ok: true, dryRun: !ENABLED, naFila: fila.length, enviados, resultado })
})
