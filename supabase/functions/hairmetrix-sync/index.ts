import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

// Recebe os exames de tricoscopia que o agente lê no HairMetrix (Canfield Mirror)
// da máquina da clínica e espelha nas tabelas hairmetrix_*.
//
// DIREÇÃO: só entra. A máquina da clínica faz conexão de SAÍDA, HTTPS, e nada é
// exposto no roteador. Banco de dado de saúde atrás de port forward não entra em
// discussão — foi por isso que o desenho é agente-empurra e não Supabase-puxa.
//
// AUTENTICAÇÃO: header `x-hairmetrix-token`, validado contra o SHA-256 guardado em
// hairmetrix_agent_keys. Não usamos service_role key: máquina de consultório tem
// login compartilhado e CCleaner instalado; se o token vazar, o estrago é um agente
// que insere exame, não o banco inteiro. Rotação = inserir chave nova, desativar a velha.
//
// O AGREGADO É CALCULADO NO AGENTE, não aqui. Um tricho_N.json tem centenas de fios
// e as 32 mil capturas passariam de 6 GB no fio. O agente manda ~20 números por
// captura; o bruto nunca sai da clínica.
//
// IDEMPOTÊNCIA: upsert em (tenant, mirror_patient_id), (tenant, capture_id) e
// (exame, indice). Rodar duas vezes não duplica nada, o que importa porque a
// máquina desliga no fim do expediente e o agente reprocessa a fila.
//
// verify_jwt = false: quem chama é o agente com token próprio, não um usuário logado.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hairmetrix-token',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const int = (v: unknown): number => {
  const n = num(v)
  return n === null ? 0 : Math.round(n)
}
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** "SOBRENOME, NOME" -> "sobrenome nome", sem acento, para o matching com o CRM. */
function normalizarNome(nome: string): string {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

type Medida = Record<string, unknown>
type Exame = Record<string, unknown>
type Paciente = Record<string, unknown>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(url, key, { auth: { persistSession: false } })

  const token = req.headers.get('x-hairmetrix-token') ?? ''
  if (!token) return json({ ok: false, error: 'missing_token' }, 401)

  const hash = await sha256(token)
  const { data: chave } = await db
    .from('hairmetrix_agent_keys')
    .select('id, tenant_id, nome, ativo')
    .eq('token_sha256', hash)
    .maybeSingle()

  if (!chave || !chave.ativo) return json({ ok: false, error: 'unauthorized' }, 401)
  const tenantId = chave.tenant_id as string

  // marca uso; falha aqui não pode derrubar a ingestão
  db.from('hairmetrix_agent_keys')
    .update({ ultimo_uso_em: new Date().toISOString() })
    .eq('id', chave.id)
    .then(() => {}, () => {})

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* ping manda vazio */ }

  const action = str(body.action) ?? 'ingest'

  // --------------------------------------------------------------------------
  // ping: o agente testa credencial e rede antes de varrer 3 mil pastas
  // --------------------------------------------------------------------------
  if (action === 'ping') {
    const { count } = await db
      .from('hairmetrix_exames')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    return json({ ok: true, action: 'ping', tenant: tenantId, agente: chave.nome, exames_no_banco: count ?? 0 })
  }

  // --------------------------------------------------------------------------
  // log: o agente fecha a rodada com o resumo. Cron verde não prova nada; é isto
  // que permite alertar "sem exame novo há 48h" em vez de descobrir por reclamação.
  // --------------------------------------------------------------------------
  if (action === 'log') {
    const r = (body.resumo ?? {}) as Record<string, unknown>
    const { error } = await db.from('hairmetrix_sync_log').insert({
      tenant_id: tenantId,
      origem: str(body.origem) ?? 'agente-windows',
      iniciado_em: str(r.iniciado_em) ?? new Date().toISOString(),
      finalizado_em: new Date().toISOString(),
      pastas_varridas: int(r.pastas_varridas),
      exames_novos: int(r.exames_novos),
      medidas_novas: int(r.medidas_novas),
      imagens_enviadas: int(r.imagens_enviadas),
      erros: int(r.erros),
      detalhe_erro: str(r.detalhe_erro),
    })
    if (error) return json({ ok: false, error: error.message }, 500)
    return json({ ok: true, action: 'log' })
  }

  // --------------------------------------------------------------------------
  // imagem: miniatura JPEG de uma captura
  // --------------------------------------------------------------------------
  // O PNG original tem 2274x2048 e 4 a 8 MB. As 32 mil capturas dariam 130 a 250 GB
  // e dias de upload na internet da clínica. O agente manda JPEG reduzido, e só da
  // captura mais recente de cada região por paciente: ~18 mil imagens, ~4,5 GB.
  //
  // Bucket PRIVADO: couro cabeludo é dado sensível de saúde. Quem exibe usa URL
  // assinada de vida curta, nunca link público.
  if (action === 'imagem') {
    const captureId = str(body.capture_id)
    const indice = int(body.indice)
    const b64 = str(body.jpeg_base64)
    if (!captureId || !b64) return json({ ok: false, error: 'faltou capture_id ou jpeg_base64' }, 400)

    const { data: exame } = await db
      .from('hairmetrix_exames')
      .select('id, mirror_patient_id')
      .eq('tenant_id', tenantId)
      .eq('capture_id', captureId)
      .maybeSingle()
    if (!exame) return json({ ok: false, error: 'exame_desconhecido', capture_id: captureId }, 404)

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    if (bytes.length > 3_000_000) return json({ ok: false, error: 'imagem_grande_demais' }, 400)

    const caminho = `${tenantId}/${exame.mirror_patient_id}/${captureId}/${indice}.jpg`
    const { error: errUp } = await db.storage
      .from('hairmetrix')
      .upload(caminho, bytes, { contentType: 'image/jpeg', upsert: true })
    if (errUp) return json({ ok: false, etapa: 'storage', error: errUp.message }, 500)

    const { error: errReg } = await db.from('hairmetrix_imagens').upsert({
      tenant_id: tenantId,
      exame_id: exame.id,
      indice,
      regiao: str(body.regiao),
      storage_path: caminho,
      sha256: str(body.sha256),
      bytes: bytes.length,
      enviado_em: new Date().toISOString(),
    }, { onConflict: 'exame_id,indice' })
    if (errReg) return json({ ok: false, etapa: 'registro', error: errReg.message }, 500)

    return json({ ok: true, action: 'imagem', caminho, bytes: bytes.length })
  }

  // --------------------------------------------------------------------------
  // ingest
  // --------------------------------------------------------------------------
  const pacientes = Array.isArray(body.pacientes) ? (body.pacientes as Paciente[]) : []
  if (pacientes.length === 0) return json({ ok: false, error: 'lote_vazio' }, 400)
  if (pacientes.length > 200) return json({ ok: false, error: 'lote_grande_demais', max: 200 }, 400)

  // 1. pacientes
  const linhasPaciente = pacientes.map((p) => {
    const nome = str(p.nome_pasta) ?? '(sem nome)'
    return {
      tenant_id: tenantId,
      mirror_patient_id: String(p.mirror_patient_id ?? '').trim(),
      nome_pasta: nome,
      nome_normalizado: normalizarNome(nome),
      cadastrado_em: str(p.cadastrado_em),
      updated_at: new Date().toISOString(),
    }
  }).filter((p) => p.mirror_patient_id !== '')

  if (linhasPaciente.length === 0) return json({ ok: false, error: 'sem_mirror_patient_id' }, 400)

  const { error: errPac } = await db
    .from('hairmetrix_pacientes')
    .upsert(linhasPaciente, { onConflict: 'tenant_id,mirror_patient_id', ignoreDuplicates: false })
  if (errPac) return json({ ok: false, etapa: 'pacientes', error: errPac.message }, 500)

  const ids = linhasPaciente.map((p) => p.mirror_patient_id)
  const { data: pacSalvos, error: errSel } = await db
    .from('hairmetrix_pacientes')
    .select('id, mirror_patient_id')
    .eq('tenant_id', tenantId)
    .in('mirror_patient_id', ids)
  if (errSel) return json({ ok: false, etapa: 'pacientes_select', error: errSel.message }, 500)

  const mapaPaciente = new Map<string, string>()
  for (const p of pacSalvos ?? []) mapaPaciente.set(p.mirror_patient_id as string, p.id as string)

  // 2. exames
  const linhasExame: Record<string, unknown>[] = []
  for (const p of pacientes) {
    const mpid = String(p.mirror_patient_id ?? '').trim()
    const pacienteId = mapaPaciente.get(mpid)
    if (!pacienteId) continue
    const exames = Array.isArray(p.exames) ? (p.exames as Exame[]) : []
    for (const e of exames) {
      const captureId = str(e.capture_id)
      const capturadoEm = str(e.capturado_em)
      if (!captureId || !capturadoEm) continue
      linhasExame.push({
        tenant_id: tenantId,
        paciente_id: pacienteId,
        mirror_patient_id: mpid,
        capture_id: captureId,
        capturado_em: capturadoEm,
        consultation_guid: str(e.consultation_guid),
        dispositivo: str(e.dispositivo),
        serial_dispositivo: str(e.serial_dispositivo),
        total_medidas: Array.isArray(e.medidas) ? (e.medidas as Medida[]).length : 0,
      })
    }
  }

  let exameIds = new Map<string, string>()
  if (linhasExame.length > 0) {
    const { error: errEx } = await db
      .from('hairmetrix_exames')
      .upsert(linhasExame, { onConflict: 'tenant_id,capture_id', ignoreDuplicates: false })
    if (errEx) return json({ ok: false, etapa: 'exames', error: errEx.message }, 500)

    const capIds = linhasExame.map((e) => e.capture_id as string)
    const { data: exSalvos, error: errExSel } = await db
      .from('hairmetrix_exames')
      .select('id, capture_id')
      .eq('tenant_id', tenantId)
      .in('capture_id', capIds)
    if (errExSel) return json({ ok: false, etapa: 'exames_select', error: errExSel.message }, 500)
    exameIds = new Map((exSalvos ?? []).map((e) => [e.capture_id as string, e.id as string]))
  }

  // 3. medidas
  const linhasMedida: Record<string, unknown>[] = []
  for (const p of pacientes) {
    const exames = Array.isArray(p.exames) ? (p.exames as Exame[]) : []
    for (const e of exames) {
      const exameId = exameIds.get(str(e.capture_id) ?? '')
      if (!exameId) continue
      const medidas = Array.isArray(e.medidas) ? (e.medidas as Medida[]) : []
      for (const m of medidas) {
        linhasMedida.push({
          tenant_id: tenantId,
          exame_id: exameId,
          indice: int(m.indice),
          guid: str(m.guid),
          regiao: str(m.regiao),
          evaluator: str(m.evaluator),
          unidades_foliculares: int(m.unidades_foliculares),
          fios_total: int(m.fios_total),
          fios_validos: int(m.fios_validos),
          fios_por_uf: num(m.fios_por_uf),
          espessura_media_px: num(m.espessura_media_px),
          espessura_mediana_px: num(m.espessura_mediana_px),
          espessura_p10_px: num(m.espessura_p10_px),
          comprimento_medio_px: num(m.comprimento_medio_px),
          score_medio: num(m.score_medio),
          espessura_hist: m.espessura_hist ?? null,
          px_por_mm: num(m.px_por_mm),
          roi_area_mm2: num(m.roi_area_mm2),
          densidade_uf_cm2: num(m.densidade_uf_cm2),
          densidade_fios_cm2: num(m.densidade_fios_cm2),
          espessura_media_um: num(m.espessura_media_um),
          pct_fios_finos: num(m.pct_fios_finos),
          magnificacao: m.magnificacao === null || m.magnificacao === undefined ? null : int(m.magnificacao),
          zoom: num(m.zoom),
        })
      }
    }
  }

  if (linhasMedida.length > 0) {
    const { error: errMed } = await db
      .from('hairmetrix_medidas')
      .upsert(linhasMedida, { onConflict: 'exame_id,indice', ignoreDuplicates: false })
    if (errMed) return json({ ok: false, etapa: 'medidas', error: errMed.message }, 500)
  }

  // 4. contadores do paciente. Recalculados a partir do que existe no banco, nunca
  //    incrementados: incremento erra assim que um lote é reprocessado.
  for (const mpid of mapaPaciente.keys()) {
    const pacienteId = mapaPaciente.get(mpid)!
    const { data: agg } = await db
      .from('hairmetrix_exames')
      .select('capturado_em')
      .eq('tenant_id', tenantId)
      .eq('paciente_id', pacienteId)
      .order('capturado_em', { ascending: true })
    if (!agg || agg.length === 0) continue
    await db.from('hairmetrix_pacientes').update({
      total_exames: agg.length,
      primeiro_exame_em: agg[0].capturado_em,
      ultimo_exame_em: agg[agg.length - 1].capturado_em,
      updated_at: new Date().toISOString(),
    }).eq('id', pacienteId)
  }

  // Devolve CONTAGEM REAL, não "ok". 200 vazio já escondeu sync morto aqui antes.
  return json({
    ok: true,
    tenant: tenantId,
    pacientes: linhasPaciente.length,
    exames: linhasExame.length,
    medidas: linhasMedida.length,
  })
})
