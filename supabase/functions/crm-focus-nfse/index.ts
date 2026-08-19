/**
 * crm-focus-nfse — emite, consulta e cancela NFS-e da clínica pela Focus NFe (ambiente nacional).
 *
 * Autenticado (painel): exige Authorization do usuário e resolve o polo por current_tenant_id.
 * Rotina (service_role, p.ex. cron de reconciliação ou smoke test): manda `tenantId` no body.
 * Polo sem `tenant_integrations.focus` configurado não emite nada — é assim que o Tricopill
 * fica de fora sem precisar de CNPJ cravado no código.
 *
 * Ações (body.action):
 *   get_config -> { configured, ambiente, tributosPendentes, servicos[] }
 *   emitir     -> { ref?, leadId?, valorCents, servico (key) | descricao, tomador:{documento(CPF),nome,...} }
 *   consultar  -> { ref }   relê a Focus e atualiza a linha (o webhook pode ter se perdido)
 *   cancelar   -> { ref, justificativa }
 *   reconciliar-> { dias? }
 *
 * Regras do financeiro (Kauan, 19/ago/2026) que moram em `_shared/focusNfse.ts`: só tomador
 * pessoa física (CNPJ devolve `tomador_pj_emissao_manual` e NÃO emite), descrição de uma lista
 * fechada por tipo de atendimento, PIS/COFINS não retidos sobre o bruto, competência = hoje.
 *
 * A emissão é ASSÍNCRONA: o retorno normal é `processando_autorizacao`. Quem chama NÃO pode
 * dizer ao paciente que a nota saiu com base nesta resposta — só `autorizado` prova.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import {
  assertPodeEmitir,
  buildDps,
  cancelarNfse,
  consultarNfse,
  descricaoDoServico,
  emitirNfse,
  lerValoresDoXml,
  readFocusConfig,
  SERVICOS_CLINICA,
  TomadorPjError,
  type FocusResposta,
} from '../_shared/focusNfse.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const str = (v: unknown, fallback = '') => (v == null ? fallback : String(v).trim())
const onlyDigitsLocal = (v: unknown) => str(v).replace(/\D/g, '')

/**
 * A chave service_role que chega no Authorization nem sempre é byte a byte a que o runtime tem
 * em SUPABASE_SERVICE_ROLE_KEY (medido em 19/ago: a chave da CLI funciona no PostgREST e o
 * digest do secret do runtime é outro). Então: lê o claim `role` do JWT e, se disser
 * service_role, CONFIRMA a assinatura no PostgREST — um JWT forjado com esse claim toma 401 lá.
 * Nunca confiar só no claim: verify_jwt já virou false por acidente em redeploy antes.
 */
async function ehServiceRoleAssinada(supabaseUrl: string, bearer: string): Promise<boolean> {
  try {
    const parts = bearer.split('.')
    if (parts.length !== 3) return false
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))) as Record<string, unknown>
    if (claims.role !== 'service_role') return false
    // O que importa aqui é a ASSINATURA: PostgREST devolve 401 para JWT que não foi assinado
    // pelo projeto, seja qual for o claim. Um 200 prova que é a service_role de verdade.
    const res = await fetch(`${supabaseUrl}/rest/v1/tenant_integrations?select=tenant_id&limit=1`, {
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}` },
    })
    return res.ok
  } catch {
    return false
  }
}

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

async function ehCronAutorizado(admin: SupabaseClient, recebido: string | null): Promise<boolean> {
  const got = (recebido ?? '').trim()
  if (!got) return false
  const { data } = await admin.from('app_cron_secrets').select('secret').eq('key', 'focus_nfse').maybeSingle()
  const esperado = String((data as { secret?: string } | null)?.secret ?? '').trim()
  return esperado.length > 0 && got === esperado
}

const FOCUS_PROD_BASE = 'https://api.focusnfe.com.br/v2'

/**
 * Chamada crua à API de PRODUÇÃO da Focus com o token de produção, independente do
 * FOCUS_NFE_AMBIENTE. Só para as ações de preparação (sondar habilitação, gatilho), que
 * precisam enxergar produção ANTES de a gente virar a chave.
 */
async function focusProd(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> | unknown[] }> {
  const token = (Deno.env.get('FOCUS_NFE_TOKEN_PRODUCAO') ?? '').trim()
  if (!token) throw new Error('FOCUS_NFE_TOKEN_PRODUCAO ausente')
  const res = await fetch(`${FOCUS_PROD_BASE}${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${token}:`)}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  let parsed: Record<string, unknown> | unknown[] = {}
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { codigo: 'resposta_nao_json', mensagem: text.slice(0, 300) } }
  return { status: res.status, body: parsed }
}

/**
 * A nota pertence ao ambiente em que NASCEU. Depois que a chave virou para produção, as notas
 * de homologação continuam na tabela (com o selo), e consultar/cancelar uma delas na Focus de
 * produção devolveria `nao_encontrado` por cima do status real. Rotina e painel só falam com
 * a Focus do ambiente da própria linha.
 */
async function ambienteDaNota(admin: SupabaseClient, tenantId: string, ref: string): Promise<string | null> {
  const { data } = await admin.from('nfse_notes').select('ambiente').eq('tenant_id', tenantId).eq('ref', ref).maybeSingle()
  return (data as { ambiente?: string } | null)?.ambiente ?? null
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

  let p: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    p = raw ? JSON.parse(raw) : {}
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  // Máquina (service_role) x pessoa (JWT de usuário). auth.getUser() não devolve usuário para a
  // service_role key, então o caminho de rotina é reconhecido pela chave e recebe o polo no
  // body; o painel continua exigindo usuário real e resolve o polo pelo RLS.
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim()
  const isServiceRole = bearer.length > 0 && (bearer === serviceRole || await ehServiceRoleAssinada(supabaseUrl, bearer))
  // pg_cron não tem service_role à mão (ver crm_cron_auth_gotcha): chega com o anon key no
  // Bearer (passa o gateway) + x-cron-secret conferido contra app_cron_secrets['focus_nfse'].
  const isCron = !isServiceRole && await ehCronAutorizado(admin, req.headers.get('x-cron-secret'))
  const isRotina = isServiceRole || isCron
  let user: { id: string } | null = null
  let tenantId = ''
  if (isRotina) {
    tenantId = str(p.tenantId)
  } else {
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: u }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !u) return json({ error: 'unauthorized' }, 401)
    user = { id: u.id }
    const { data: tid } = await userClient.rpc('current_tenant_id')
    tenantId = typeof tid === 'string' ? tid.trim() : ''
  }
  if (!tenantId) return json({ error: 'tenant_not_resolved' }, 400)

  const cfg = await readFocusConfig(admin, tenantId)
  const action = str(p.action)

  // ───────────────────── preparação de produção (só rotina) ─────────────────────
  // Sondar habilitação: payload de propósito INCOMPLETO (só prestador + município). A Focus
  // checa a habilitação da empresa antes dos campos e valida campos antes de assinar, então
  // a resposta diz se produção está ligada sem nunca virar nota.
  if (action === 'sondar_producao') {
    if (!isRotina) return json({ error: 'forbidden' }, 403)
    if (!cfg) return json({ error: 'focus_not_configured' }, 400)
    const ref = `sonda-${tenantId}-${Date.now()}`
    const r = await focusProd('POST', `/nfsen?ref=${encodeURIComponent(ref)}`, {
      cnpj_prestador: cfg.cnpjPrestador,
      codigo_municipio_emissora: cfg.codigoMunicipio,
    })
    const b = (Array.isArray(r.body) ? {} : r.body) as Record<string, unknown>
    const codigo = str(b.codigo) || str(b.status)
    const mensagem = str(b.mensagem)
    const habilitada = codigo !== 'empresa_nao_habilitada' && !/habilita_nfsen_producao/i.test(mensagem)
    return json({ ok: true, httpStatus: r.status, codigo, mensagem, habilitada })
  }

  // Gatilho de produção: a Focus avisa por POST quando a nota muda de estado. Hooks são por
  // AMBIENTE, e o de homologação já existe; este garante o de produção (idempotente).
  if (action === 'garantir_webhook') {
    if (!isRotina) return json({ error: 'forbidden' }, 403)
    if (!cfg) return json({ error: 'focus_not_configured' }, 400)
    const secret = (Deno.env.get('FOCUS_NFE_WEBHOOK_SECRET') ?? '').trim()
    if (!secret) return json({ error: 'webhook_secret_nao_configurado' }, 400)
    const url = `${supabaseUrl}/functions/v1/crm-focus-webhook`
    const lista = await focusProd('GET', '/hooks')
    const hooks = (Array.isArray(lista.body) ? lista.body : []) as Array<Record<string, unknown>>
    const existente = hooks.find((h) => str(h.url) === url && str(h.event) === 'nfsen' && onlyDigitsLocal(h.cnpj) === cfg.cnpjPrestador)
    if (existente) return json({ ok: true, criado: false, hook: existente })
    const criado = await focusProd('POST', '/hooks', {
      cnpj: cfg.cnpjPrestador,
      event: 'nfsen',
      url,
      authorization: secret,
      authorization_header: 'x-focus-secret',
    })
    return json({ ok: criado.status >= 200 && criado.status < 300, criado: true, httpStatus: criado.status, hook: criado.body })
  }

  if (action === 'get_config') {
    return json({
      ok: true,
      configured: !!cfg,
      ambiente: cfg?.ambiente ?? null,
      // A tela precisa saber ANTES de o usuário digitar a nota inteira que produção está travada.
      tributosPendentes: !!cfg && cfg.ambiente === 'producao' && !cfg.tributosAproximados,
      // A lista fechada de descrições: a tela oferece, não inventa.
      servicos: SERVICOS_CLINICA,
      apenasPessoaFisica: true,
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
    // `servico` (chave da lista fechada) é o caminho normal; `descricao` livre só como
    // exceção explícita de quem chama — e nunca os dois misturados.
    const servicoKey = str(p.servico)
    const descricao = servicoKey ? (descricaoDoServico(servicoKey) ?? '') : str(p.descricao)
    const tomadorRaw = (p.tomador ?? {}) as Record<string, unknown>
    const documento = str(tomadorRaw.documento).replace(/\D/g, '')
    const nome = str(tomadorRaw.nome)

    if (!Number.isFinite(valorCents) || valorCents <= 0) return json({ error: 'valor_invalido' }, 400)
    if (servicoKey && !descricao) return json({ error: 'servico_desconhecido', detail: `Use uma das chaves: ${SERVICOS_CLINICA.map((s) => s.key).join(', ')}.` }, 400)
    if (!descricao) return json({ error: 'descricao_obrigatoria' }, 400)
    if (documento.length === 14) {
      // Regra do financeiro: PJ tem retenção na fonte por faixa e é nota manual do Kauan.
      return json({ error: 'tomador_pj_emissao_manual', detail: new TomadorPjError().message }, 400)
    }
    if (documento.length !== 11) return json({ error: 'documento_tomador_invalido' }, 400)
    if (!nome) return json({ error: 'nome_tomador_obrigatorio' }, 400)

    // `ref` estável quando quem chama sabe a origem (venda, atendimento). Reemitir com a mesma
    // ref devolve a nota que já existe em vez de emitir uma segunda — é o que salva do
    // duplo-clique e do retry. Sem origem, gera uma e o índice único cuida do resto.
    const ref = str(p.ref) || `nfse-${tenantId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`

    let dps: Record<string, unknown>
    try {
      dps = buildDps(cfg, {
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
    } catch (e) {
      if (e instanceof TomadorPjError) return json({ error: 'tomador_pj_emissao_manual', detail: e.message }, 400)
      throw e
    }

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
      created_by: user?.id ?? null,
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
    const amb = await ambienteDaNota(admin, tenantId, ref)
    if (amb && amb !== cfg.ambiente) {
      return json({ error: 'ambiente_divergente', detail: `Esta nota é de ${amb}; o sistema está em ${cfg.ambiente}.` }, 400)
    }
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
    const amb = await ambienteDaNota(admin, tenantId, ref)
    if (amb && amb !== cfg.ambiente) {
      return json({ error: 'ambiente_divergente', detail: `Esta nota é de ${amb}; o sistema está em ${cfg.ambiente}.` }, 400)
    }

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
      .eq('ambiente', cfg.ambiente)
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
