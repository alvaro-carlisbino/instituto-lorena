import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { Client as MySqlClient } from 'https://deno.land/x/mysql@v2.12.1/mod.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Remarcar e cancelar cirurgia, dos dois lados de uma vez.
//
// O crm-cirurgia-push já leva a cirurgia VENDIDA para a agenda do centro
// cirúrgico (MySQL c7lorenaap, o sistema PHP/CI4 que a equipe usa lá embaixo) —
// 50 cirurgias entraram lá de uma vez em 11/08/2026, e todo dia às 9h15 ele leva
// as novas. O que ele nunca fez, de propósito, foi TOCAR em linha existente.
//
// O buraco que isso deixava: paciente que remarca ou desiste continuava marcado
// na agenda da enfermagem. A recepção mudava a data no CRM, a sala não sabia, e o
// bloco de sala seguia reservado para uma cirurgia que não ia acontecer.
//
// Regra que essa função respeita, e é o que a torna segura de existir: só mexe em
// cirurgia que a SALA AINDA NÃO COMEÇOU (status AGUARDANDO e horaInicio nulo).
// Cirurgia EM_PROCESSO ou FINALIZADA é fato consumado, é dado clínico da equipe
// deles, e um UPDATE nela apagaria trabalho registrado. Nesse caso a função
// atualiza só o CRM e devolve o aviso para quem está na tela avisar a sala.
//
// SEGURANÇA: usa o mesmo interruptor do push (CIRURGIA_PUSH_ENABLED). Desligado,
// a venda é atualizada no CRM e a agenda deles não é tocada — e a resposta diz
// isso, em vez de fingir que foi.
//
// Secrets: CIRURGIA_DB_HOST, CIRURGIA_DB_NAME, CIRURGIA_DB_USER,
//          CIRURGIA_DB_PASSWORD, CIRURGIA_PUSH_ENABLED
// ─────────────────────────────────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const ENABLED = (Deno.env.get('CIRURGIA_PUSH_ENABLED') ?? '').trim().toLowerCase() === 'true'

/** 'YYYY-MM-DD' e 'HH:MM:SS' no fuso da clínica, que é como o MySQL deles guarda. */
function saoPaulo(iso: string): { dia: string; hora: string } {
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(new Date(iso))
  const [dia, hora] = partes.split(' ')
  return { dia, hora }
}

const agoraSaoPaulo = () => {
  const { dia, hora } = saoPaulo(new Date().toISOString())
  return `${dia} ${hora}`
}

type Body = {
  saleId?: string
  action?: 'remarcar' | 'cancelar'
  /** ISO completo, só para remarcar. */
  scheduledAt?: string | null
  reason?: string
  refundStatus?: string
  note?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !anonKey || !serviceRole) return json({ ok: false, error: 'server_misconfigured' }, 500)

  // Quem chama é gente logada na tela, não cron: a ação é destrutiva na agenda de
  // outro sistema e precisa ter dono.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ ok: false, error: 'unauthorized' }, 401)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ ok: false, error: 'unauthorized' }, 401)

  const admin = createClient(url, serviceRole)

  // Precisa ser da equipe do polo da clínica. A checagem é feita com a sessão do
  // próprio usuário: se a RLS não entrega a venda para ele, ele não mexe nela.
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400)
  }

  const saleId = String(body.saleId ?? '').trim()
  const action = body.action === 'cancelar' ? 'cancelar' : 'remarcar'
  if (!saleId) return json({ ok: false, error: 'sale_id_obrigatorio' }, 400)

  const { data: venda, error: vendaErr } = await userClient
    .from('clinic_sales')
    .select('id, patient_name, scheduled_at, srg_surgery_id, status, kind')
    .eq('id', saleId)
    .maybeSingle()
  if (vendaErr) return json({ ok: false, error: vendaErr.message }, 400)
  if (!venda) return json({ ok: false, error: 'venda_nao_encontrada' }, 404)
  if (venda.kind !== 'cirurgia') return json({ ok: false, error: 'nao_e_cirurgia' }, 400)

  let novoIso: string | null = null
  if (action === 'remarcar') {
    novoIso = String(body.scheduledAt ?? '').trim() || null
    if (!novoIso || Number.isNaN(Date.parse(novoIso))) {
      return json({ ok: false, error: 'data_invalida' }, 400)
    }
  }

  // ── 1. Agenda da enfermagem primeiro ──────────────────────────────────────
  // A ordem importa: se a escrita lá falhar, o CRM não fica dizendo uma data que
  // a sala nunca recebeu. O contrário (lá certo, CRM errado) é visível na tela;
  // este é o silencioso.
  const srgId = venda.srg_surgery_id != null ? Number(venda.srg_surgery_id) : null
  let enfermagem: Record<string, unknown> = { tocou: false }

  if (srgId == null) {
    enfermagem = {
      tocou: false,
      motivo: 'esta cirurgia ainda não existe na agenda da enfermagem; o envio diário a cria já com a data nova',
    }
  } else if (!ENABLED) {
    enfermagem = { tocou: false, motivo: 'a escrita na agenda da enfermagem está desligada (CIRURGIA_PUSH_ENABLED)' }
  } else {
    const host = Deno.env.get('CIRURGIA_DB_HOST')
    const db = Deno.env.get('CIRURGIA_DB_NAME')
    const usuario = Deno.env.get('CIRURGIA_DB_USER')
    const password = Deno.env.get('CIRURGIA_DB_PASSWORD')
    if (!host || !db || !usuario || !password) return json({ ok: false, error: 'missing_secrets' }, 500)

    const cliente = await new MySqlClient().connect({
      hostname: host, db, username: usuario, password, poolSize: 1, timeout: 20_000,
    })
    try {
      const atual = await cliente.query(
        'select id, dia, horaInicio, status, excluido from cirurgia where id = ? limit 1',
        [srgId],
      )
      const linha = Array.isArray(atual) && atual.length > 0 ? atual[0] : null
      if (!linha) {
        enfermagem = { tocou: false, motivo: 'a cirurgia não está mais na agenda da enfermagem' }
      } else if (linha.excluido != null) {
        enfermagem = { tocou: false, motivo: 'a enfermagem já havia excluído esta cirurgia' }
      } else if (linha.horaInicio != null || String(linha.status ?? '') !== 'AGUARDANDO') {
        // Fato consumado: a equipe já apertou o start. Não se mexe.
        enfermagem = {
          tocou: false,
          motivo: `a sala já iniciou esta cirurgia (status ${linha.status}). Avise a enfermagem: o sistema não altera cirurgia começada`,
          precisaAvisar: true,
        }
      } else {
        const agora = agoraSaoPaulo()
        if (action === 'cancelar') {
          // Soft delete, igual ao que o sistema deles faz: `excluido` preenchido é
          // como eles somem a cirurgia da agenda sem perder o histórico.
          await cliente.execute('update cirurgia set excluido = ?, dtAlteracao = ? where id = ?', [
            agora, agora, srgId,
          ])
          enfermagem = { tocou: true, acao: 'cancelada na agenda da enfermagem' }
        } else {
          const { dia } = saoPaulo(novoIso as string)
          await cliente.execute('update cirurgia set dia = ?, dtAlteracao = ? where id = ?', [
            dia, agora, srgId,
          ])
          enfermagem = { tocou: true, acao: `data alterada na agenda da enfermagem para ${dia}`, de: String(linha.dia ?? '') }
        }
      }
    } catch (e) {
      return json({ ok: false, error: `agenda_enfermagem: ${e instanceof Error ? e.message : 'falha'}` }, 502)
    } finally {
      await cliente.close()
    }
  }

  // ── 2. Agora o CRM ────────────────────────────────────────────────────────
  // Escrito com a sessão do usuário: a RLS do polo continua valendo, e o trigger
  // de confirmação devolve o paciente para "não confirmada" quando a data muda.
  if (action === 'cancelar') {
    const { error } = await userClient
      .from('clinic_sales')
      .update({
        status: 'cancelada',
        canceled_at: new Date().toISOString().slice(0, 10),
        cancel_reason: String(body.reason ?? '').trim() || 'Cancelada na fila de cirurgias',
        refund_status: String(body.refundStatus ?? '').trim() || 'Em avaliação',
        cancel_note: String(body.note ?? '').trim() || null,
      })
      .eq('id', saleId)
    if (error) return json({ ok: false, error: error.message, enfermagem }, 400)
  } else {
    const { error } = await userClient
      .from('clinic_sales')
      .update({ scheduled_at: novoIso, schedule_pending: false, status: 'agendada' })
      .eq('id', saleId)
    if (error) return json({ ok: false, error: error.message, enfermagem }, 400)
  }

  // Quem fez, para a auditoria: a ação atravessa dois sistemas e precisa de rastro.
  // Falha aqui não desfaz nada nem devolve erro: o registro já mudou nos dois
  // lados, e negar a resposta faria a tela pedir para repetir o que já foi feito.
  const { error: auditErr } = await admin.from('audit_logs').insert({
    actor_id: user.id,
    actor_email: user.email ?? null,
    action: action === 'cancelar' ? 'cirurgia_cancelada' : 'cirurgia_remarcada',
    target_table: 'clinic_sales',
    target_id: saleId,
    metadata: { de: venda.scheduled_at, para: novoIso, enfermagem },
    tenant_id: 'instituto-lorena',
  })
  if (auditErr) console.error('audit_logs:', auditErr.message)

  return json({ ok: true, acao: action, paciente: venda.patient_name, enfermagem })
})
