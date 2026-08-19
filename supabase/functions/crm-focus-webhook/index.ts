/**
 * crm-focus-webhook — recebe o aviso da Focus NFe quando a nota muda de estado.
 *
 * Público (verify_jwt = false no config.toml — sem isso a Focus toma 401 e o CRM fica com a
 * nota eternamente "processando"). A guarda é um segredo combinado no header, gravado no
 * gatilho lá na Focus (`authorization` / `authorization_header` do POST /v2/hooks).
 *
 * O corpo recebido é tratado como PISTA, não como verdade: daqui a gente só aproveita a `ref`
 * e vai reconsultar a nota na Focus. Status de documento fiscal não pode vir de um POST que
 * qualquer um pode forjar contra uma URL pública.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { consultarNfse, lerValoresDoXml, readFocusConfig } from '../_shared/focusNfse.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  // Segredo obrigatório. Sem ele configurado a rota fica FECHADA — "aberto por enquanto"
  // numa URL pública que carimba nota fiscal não é um estado aceitável.
  // Header PRÓPRIO, não `Authorization`: o gateway do Supabase trata Authorization de forma
  // especial e um dia isso vira 401 antes de o código rodar. Configurado no gatilho da Focus
  // via `authorization_header: "x-focus-secret"`.
  const expected = (Deno.env.get('FOCUS_NFE_WEBHOOK_SECRET') ?? '').trim()
  if (!expected) return json({ error: 'webhook_secret_nao_configurado' }, 503)
  const got = (req.headers.get('x-focus-secret') ?? '').trim()
  if (got !== expected) return json({ error: 'unauthorized' }, 401)

  let payload: Record<string, unknown> = {}
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    // 200 de propósito: corpo ilegível não é motivo para a Focus ficar reenviando.
    return json({ ok: true, skipped: 'invalid_json' })
  }

  const ref = String(payload.ref ?? '').trim()
  if (!ref) return json({ ok: true, skipped: 'sem_ref' })

  // A ref diz de quem é a nota. Nota que não nasceu aqui a gente ignora em vez de criar linha
  // solta — o CRM não é o registro de tudo que existe na conta da Focus.
  const { data: row } = await admin
    .from('nfse_notes')
    .select('tenant_id, status, ambiente')
    .eq('ref', ref)
    .maybeSingle()
  if (!row) return json({ ok: true, skipped: 'nota_desconhecida' })
  const tenantId = String((row as { tenant_id?: string }).tenant_id ?? '')
  const ambienteDaNota = String((row as { ambiente?: string }).ambiente ?? '')

  const cfg = await readFocusConfig(admin, tenantId)
  if (!cfg) return json({ ok: true, skipped: 'focus_not_configured' })
  // Gatilho de homologação batendo depois que a chave virou para produção (ou vice-versa):
  // consultar no ambiente errado devolve `nao_encontrado` por cima do status real. Ignora.
  if (ambienteDaNota && ambienteDaNota !== cfg.ambiente) return json({ ok: true, skipped: 'ambiente_divergente' })

  const r = await consultarNfse(cfg, ref)
  const valores = r.status === 'autorizado' && r.urlXml
    ? await lerValoresDoXml(r.urlXml)
    : { aliquota: null, issCents: null }

  await admin
    .from('nfse_notes')
    .update({
      status: r.status,
      numero: r.numero,
      codigo_verificacao: r.codigoVerificacao,
      url_consulta: r.urlConsulta,
      url_xml: r.urlXml,
      url_pdf: r.urlPdf,
      ...(valores.issCents != null ? { valor_iss_cents: valores.issCents } : {}),
      ...(valores.aliquota != null ? { aliquota_aplicada: valores.aliquota } : {}),
      erros: r.erros,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('ref', ref)

  return json({ ok: true, ref, status: r.status })
})
