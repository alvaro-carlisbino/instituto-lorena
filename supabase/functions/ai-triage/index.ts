import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { insertInteraction } from '../_shared/crm.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type TriageClassification = 'qualified' | 'human_handoff' | 'not_qualified'

function classifyText(text: string): { classification: TriageClassification; confidence: number; recommendation: string } {
  const normalized = text.toLowerCase()
  if (/(pre[cç]o|valor|or[cç]amento|agendar|consulta|quero fechar|formas de pagamento)/.test(normalized)) {
    return {
      classification: 'qualified',
      confidence: 0.9,
      recommendation: 'Lead com intenção comercial clara. Priorizar atendimento humano em até 15 minutos.',
    }
  }
  if (/(duvida|dúvida|medo|urgente|dor|reclama|problema|cancelar)/.test(normalized)) {
    return {
      classification: 'human_handoff',
      confidence: 0.8,
      recommendation: 'Mensagem sensível. Encaminhar para atendimento humano com contexto completo.',
    }
  }
  return {
    classification: 'not_qualified',
    confidence: 0.72,
    recommendation: 'Manter nutrição automatizada e tentar novo contato em 24h.',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const admin = createClient(supabaseUrl, serviceRole)

  let body: { leadId?: string; text?: string; patientName?: string }
  try {
    body = (await req.json()) as { leadId?: string; text?: string; patientName?: string }
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const leadId = String(body.leadId ?? '').trim()
  const text = String(body.text ?? '').trim()
  if (!leadId || !text) {
    return new Response(JSON.stringify({ error: 'missing_lead_or_text' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const triage = classifyText(text)
  const patientName = String(body.patientName ?? 'Lead')

  try {
    await insertInteraction(admin, {
      leadId,
      patientName,
      channel: 'ai',
      direction: 'system',
      author: 'Assistente (triagem)',
      content: `${triage.classification} (${Math.round(triage.confidence * 100)}%): ${triage.recommendation}`,
      happenedAt: new Date().toISOString(),
    })
  } catch {
    // Evita falha total por erro de auditoria da interação de IA.
  }

  return new Response(
    JSON.stringify({
      leadId,
      classification: triage.classification,
      confidence: triage.confidence,
      recommendation: triage.recommendation,
    }),
    {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    },
  )
})

