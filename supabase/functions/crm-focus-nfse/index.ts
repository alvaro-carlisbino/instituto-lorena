/**
 * crm-focus-nfse — emite, consulta e cancela NFS-e da clínica pela Focus NFe (ambiente nacional).
 *
 * Autenticado (painel): exige Authorization do usuário e resolve o polo por current_tenant_id.
 * Polo sem `tenant_integrations.focus` configurado não emite nada — é assim que o Tricopill
 * fica de fora sem precisar de CNPJ cravado no código.
 *
 * Ações (body.action):
 *   get_config -> { configured, ambiente, tributosPendentes }
 *   emitir     -> { ref?, leadId?, valorCents, descricao, tomador:{documento,nome,...} }
 *   consultar  -> { ref }   relê a Focus e atualiza a linha (o webhook pode ter se perdido)
 *   cancelar   -> { ref, justificativa }
 *
 * A emissão é ASSÍNCRONA: o retorno normal é `processando_autorizacao`. Quem chama NÃO pode
 * dizer ao paciente que a nota saiu com base nesta resposta — só `autorizado` prova.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  assertPodeEmitir,
  buildDps,
  cancelarNfse,
  consultarNfse,
  emitirNfse,
  lerValoresDoXml,
  readFocusConfig,
  type FocusResposta,
} from '../_shared/focusNfse.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v).trim())

/**
 * Campos da nota que a resposta da Focus atualiza. Um só lugar para não divergir.
 * O ISS mora no XML, não no JSON — só vale a pena buscar quando a nota autorizou.
 */
async function patchDaResposta(r: FocusResposta): Promise<Record<string, unknown>> {
  const valores = r.status === 'autorizado' && r.urlXml
    ? await lerValoresDoXml(r.urlXml)
    : { aliquota: null, issCents: null }
  return {
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
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceRole) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceRole)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'unauthorized' }, 401)
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return json({ error: 'unauthorized' }, 401)

  let p: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    p = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const { data: tid } = await userClient.rpc('current_tenant_id')
  const tenantId = typeof tid === 'string' ? tid.trim() : ''
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const cfg = await readFocusConfig(admin, tenantId)
  const action = str(p.action)

  if (action === 'get_config') {
    return json({
      ok: true,
      configured: !!cfg,
      ambiente: cfg?.ambiente ?? null,
      // A tela precisa saber ANTES de o usuário digitar a nota inteira que produção está travada.
      tributosPendentes: !!cfg && cfg.ambiente === 'producao' && !cfg.tributosAproximados,
    })
  }

  if (!cfg) return json({ error: 'focus_not_configured' }, 400)

  // ───────────────────────── emitir ─────────────────────────
  if (action === 'emitir') {
    try {
      assertPodeEmitir(cfg)
    } catch {
      return json({
        error: 'focus_tributos_aproximados_nao_configurados',
        detail: 'Defina tenant_integrations.focus.tributos_aproximados (percentuais da Lei da Transparência) antes de emitir em produção.',
      }, 400)
    }

    const valorCents = Math.round(Number(p.valorCents ?? 0))
    const descricao = str(p.descricao)
    const tomadorRaw = (p.tomador ?? {}) as Record<string, unknown>
    const documento = str(tomadorRaw.documento).replace(/\D/g, '')
    const nome = str(tomadorRaw.nome)

    if (!Number.isFinite(valorCents) || valorCents <= 0) return json({ error: 'valor_invalido' }, 400)
    if (!descricao) return json({ error: 'descricao_obrigatoria' }, 400)
    if (documento.length !== 11 && documento.length !== 14) return json({ error: 'documento_tomador_invalido' }, 400)
    if (!nome) return json({ error: 'nome_tomador_obrigatorio' }, 400)

    // `ref` estável quando quem chama sabe a origem (venda, atendimento). Reemitir com a mesma
    // ref devolve a nota que já existe em vez de emitir uma segunda — é o que salva do
    // duplo-clique e do retry. Sem origem, gera uma e o índice único cuida do resto.
    const ref = str(p.ref) || `nfse-${tenantId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

    const dps = buildDps(cfg, {
      valorServicoCents: valorCents,
      descricaoServico: descricao,
      tomador: {
        documento,
        nome,
        cep: str(tomadorRaw.cep),
        logradouro: str(tomadorRaw.logradouro),
        numero: str(tomadorRaw.numero),
        bairro: str(tomadorRaw.bairro),
        codigoMunicipio: str(tomadorRaw.codigoMunicipio) || undefined,
        email: str(tomadorRaw.email) || undefined,
      },
    })

    // Grava ANTES de chamar a Focus. Se a rede cair depois do POST, a nota pode existir lá e
    // não aqui — e nota fiscal órfã é pior que linha pendente. Com a linha já criada, o
    // `consultar` reconcilia pela ref.
    const { error: insErr } = await admin.from('nfse_notes').insert({
      tenant_id: tenantId,
      ref,
      status: 'processando_autorizacao',
      valor_servico_cents: valorCents,
      tomador_documento: documento,
      tomador_nome: nome,
      descricao_servico: descricao,
      payload: dps,
      ambiente: cfg.ambiente,
      lead_id: str(p.leadId) || null,
      created_by: user.id,
    })
    if (insErr && !String(insErr.message ?? '').includes('duplicate')) {
      return json({ error: 'db_insert_failed', detail: String(insErr.message ?? '').slice(0, 200) }, 500)
    }

    const r = await emitirNfse(cfg, ref, dps)
    await admin.from('nfse_notes').update(await patchDaResposta(r)).eq('tenant_id', tenantId).eq('ref', ref)

    return json({
      ok: r.status === 'processando_autorizacao' || r.status === 'autorizado',
      ref,
      status: r.status,
      numero: r.numero,
      erros: r.erros,
    })
  }

  // ───────────────────────── consultar ─────────────────────────
  if (action === 'consultar') {
    const ref = str(p.ref)
    if (!ref) return json({ error: 'ref_obrigatoria' }, 400)
    const r = await consultarNfse(cfg, ref)
    await admin.from('nfse_notes').update(await patchDaResposta(r)).eq('tenant_id', tenantId).eq('ref', ref)
    return json({ ok: true, ref, status: r.status, numero: r.numero, urlPdf: r.urlPdf, urlXml: r.urlXml, erros: r.erros })
  }

  // ───────────────────────── cancelar ─────────────────────────
  if (action === 'cancelar') {
    const ref = str(p.ref)
    const justificativa = str(p.justificativa)
    if (!ref) return json({ error: 'ref_obrigatoria' }, 400)
    // A SEFIN exige justificativa com tamanho mínimo; recusar aqui evita queimar a tentativa.
    if (justificativa.length < 15) return json({ error: 'justificativa_curta', detail: 'Mínimo de 15 caracteres.' }, 400)

    const r = await cancelarNfse(cfg, ref, justificativa)
    if (r.status === 'cancelado') {
      await admin.from('nfse_notes')
        .update({ status: 'cancelado', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('ref', ref)
    }
    return json({ ok: r.status === 'cancelado', ref, status: r.status, erros: r.erros, detail: str(r.raw.mensagem) || null })
  }

  // ───────────────────────── reconciliar ─────────────────────────
  // A Focus dispara o gatilho na AUTORIZAÇÃO, mas NÃO no cancelamento (medido em homologação
  // em 14/ago: `request_count` não sobe ao cancelar). Ou seja: nota cancelada direto no painel
  // da Focus fica "autorizado" aqui para sempre, e a atendente afirma ao paciente que a nota
  // vale. Isto relê o que a Focus diz hoje e reescreve o status.
  if (action === 'reconciliar') {
    const dias = Math.min(Math.max(Number(p.dias ?? 90), 1), 365)
    const desde = new Date(Date.now() - dias * 86400000).toISOString()
    const { data: rows } = await admin
      .from('nfse_notes')
      .select('ref, status')
      .eq('tenant_id', tenantId)
      .in('status', ['autorizado', 'processando_autorizacao'])
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(500)

    const mudou: Array<{ ref: string; de: string; para: string }> = []
    for (const row of (rows ?? []) as Array<{ ref: string; status: string }>) {
      const r = await consultarNfse(cfg, row.ref)
      if (r.status === 'desconhecido') continue
      if (r.status !== row.status) mudou.push({ ref: row.ref, de: row.status, para: r.status })
      await admin.from('nfse_notes').update(await patchDaResposta(r)).eq('tenant_id', tenantId).eq('ref', row.ref)
    }
    return json({ ok: true, conferidas: (rows ?? []).length, mudou })
  }

  return json({ error: 'unknown_action' }, 400)
})
