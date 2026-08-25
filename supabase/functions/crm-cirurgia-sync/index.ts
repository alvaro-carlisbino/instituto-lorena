import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { Client as MySqlClient } from 'https://deno.land/x/mysql@v2.12.1/mod.ts'

// Espelha o sistema de centro cirúrgico (MySQL c7lorenaap, PHP/CI4 no cPanel) nas
// tabelas srg_* do Supabase. Unidirecional: o MySQL continua sendo a fonte de
// escrita — o centro cirúrgico roda com paciente na mesa e não se reescreve.
//
// FULL SYNC sempre, de propósito. O banco todo são ~14 mil linhas; sync
// incremental por watermark introduziria uma classe inteira de bug silencioso
// (linha com dtAlteracao nulo, hard delete no MySQL, relógio do servidor) para
// economizar segundos que não fazem falta.
//
// FUSO: os datetime do MySQL não têm timezone e o servidor roda em UTC-3
// (validado: now()=14:26 vs utc_timestamp()=17:26). Lemos como STRING via
// date_format e carimbamos '-03:00' na mão — deixar o driver converter usaria o
// fuso do processo (UTC no edge) e jogaria toda cirurgia 3h para trás.
// Brasil não tem mais horário de verão desde 2019 e o dado começa em nov/2025,
// então o offset é constante.
//
// Secrets: CIRURGIA_DB_HOST, CIRURGIA_DB_NAME, CIRURGIA_DB_USER,
//          CIRURGIA_DB_PASSWORD, CIRURGIA_CRON_SECRET (opcional).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const TZ = '-03:00'
/** date_format devolve 'YYYY-MM-DDTHH:MM:SS' ou null; vira timestamptz explícito. */
const ts = (v: unknown): string | null => (v ? `${String(v)}${TZ}` : null)
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

type Row = Record<string, unknown>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const cronSecret = Deno.env.get('CIRURGIA_CRON_SECRET') ?? ''
  if (cronSecret && req.headers.get('x-cron-secret') !== cronSecret) {
    const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    // Sem o secret configurado ninguem entra: comparar contra '' deixaria passar quem
    // mandasse Authorization vazio. A sentinela anterior era um byte NUL literal, que
    // fazia o arquivo virar "binary file" para o grep e sumir de qualquer busca.
    const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!expected || auth !== expected) {
      return json({ ok: false, error: 'unauthorized' }, 401)
    }
  }

  const host = Deno.env.get('CIRURGIA_DB_HOST')
  const db = Deno.env.get('CIRURGIA_DB_NAME')
  const user = Deno.env.get('CIRURGIA_DB_USER')
  const password = Deno.env.get('CIRURGIA_DB_PASSWORD')
  if (!host || !db || !user || !password) {
    return json({ ok: false, error: 'missing_secrets', need: ['CIRURGIA_DB_HOST', 'CIRURGIA_DB_NAME', 'CIRURGIA_DB_USER', 'CIRURGIA_DB_PASSWORD'] }, 500)
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* cron manda vazio */ }
  const runMatch = body.match !== false          // casar paciente↔lead por padrão
  const dryRun = body.dry_run === true

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )

  const started = Date.now()
  const counts: Record<string, number> = {}
  const errors: Record<string, string> = {}
  let mysql: MySqlClient | null = null

  /** Grava em lotes; o espelho é chaveado pelo id do MySQL, então upsert é idempotente. */
  const upsert = async (table: string, rows: Row[]) => {
    if (dryRun) { counts[table] = rows.length; return }
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500)
      const { error } = await supa.from(table).upsert(chunk, { onConflict: 'id' })
      if (error) throw new Error(`${table}: ${error.message}`)
    }
    counts[table] = rows.length
  }

  try {
    mysql = await new MySqlClient().connect({
      hostname: host, db, username: user, password, poolSize: 1, timeout: 20_000,
    })

    const q = async (sql: string): Promise<Row[]> => (await mysql!.query(sql)) as Row[]

    // ---- 1) Cadastros de apoio -------------------------------------------------
    // cliente.email/senha ficam de fora: são credenciais do sistema PHP.
    const staff = await q(`
      select id, titulo, tipo, status, telefone,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtCriacao,'%Y-%m-%dT%H:%i:%s')   cri,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from cliente`)
    await upsert('srg_staff', staff.map((r) => ({
      id: num(r.id), nome: str(r.titulo), tipo: str(r.tipo), status: str(r.status),
      telefone: str(r.telefone), deleted_at: ts(r.exc),
      source_created_at: ts(r.cri), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))
    const staffIds = new Set(staff.map((r) => Number(r.id)))
    const fkStaff = (v: unknown) => (v !== null && v !== undefined && staffIds.has(Number(v)) ? Number(v) : null)

    const areas = await q(`
      select id, titulo, ordem,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from area`)
    await upsert('srg_areas', areas.map((r) => ({
      id: num(r.id), titulo: str(r.titulo), ordem: num(r.ordem),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))
    const areaIds = new Set(areas.map((r) => Number(r.id)))

    const cats = await q(`
      select id, titulo, ordem, ativo,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from categoria`)
    await upsert('srg_categories', cats.map((r) => ({
      id: num(r.id), titulo: str(r.titulo), ordem: num(r.ordem), ativo: str(r.ativo) === 'S',
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))

    const plates = await q(`
      select id, nome, numero,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from placa`)
    await upsert('srg_plates', plates.map((r) => ({
      id: num(r.id), nome: str(r.nome), numero: num(r.numero),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))
    const plateIds = new Set(plates.map((r) => Number(r.id)))

    // ---- 2) Cirurgia -----------------------------------------------------------
    // anamnese/observacoes ficam de fora de propósito (texto clínico livre; nada
    // no app do paciente usa). Ver comentário na migration 20260810180000.
    const surgeries = await q(`
      select id, paciente, status, sala, idade, meta, medicoFK, anestesistaFK,
             date_format(dia,'%Y-%m-%d')                   dia,
             date_format(horaInicio,'%Y-%m-%dT%H:%i:%s')   ini,
             date_format(dtFim,'%Y-%m-%dT%H:%i:%s')        fim,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')     exc,
             date_format(dtCriacao,'%Y-%m-%dT%H:%i:%s')    cri,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s')  alt
        from cirurgia`)
    // Só as colunas do espelho: o vínculo paciente↔lead (lead_id, match_status…)
    // é nosso e não pode ser sobrescrito pelo sync a cada rodada.
    await upsert('srg_surgeries', surgeries.map((r) => ({
      id: num(r.id), paciente_nome: str(r.paciente),
      dia: str(r.dia), hora_inicio: ts(r.ini), dt_fim: ts(r.fim),
      status: str(r.status), sala: str(r.sala), idade: num(r.idade), meta: num(r.meta),
      medico_id: fkStaff(r.medicoFK), anestesista_id: fkStaff(r.anestesistaFK),
      deleted_at: ts(r.exc), source_created_at: ts(r.cri), source_updated_at: ts(r.alt),
      synced_at: new Date().toISOString(),
    })))
    const surgeryIds = new Set(surgeries.map((r) => Number(r.id)))
    const ofSurgery = (rows: Row[]) => rows.filter((r) => surgeryIds.has(Number(r.cirurgiaFK)))

    const sAreas = await q(`
      select id, cirurgiaFK, areaFK, meta, tipo,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from cirurgia_area`)
    await upsert('srg_surgery_areas', ofSurgery(sAreas).map((r) => ({
      id: num(r.id), surgery_id: num(r.cirurgiaFK),
      area_id: areaIds.has(Number(r.areaFK)) ? num(r.areaFK) : null,
      meta: num(r.meta), tipo: num(r.tipo),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))

    const stages = await q(`
      select id, cirurgiaFK, etapa, tipo, observacoes,
             date_format(horario,'%Y-%m-%dT%H:%i:%s')     hor,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from cirurgia_etapa`)
    await upsert('srg_stages', ofSurgery(stages).map((r) => ({
      id: num(r.id), surgery_id: num(r.cirurgiaFK), etapa: str(r.etapa), tipo: str(r.tipo),
      horario: ts(r.hor), observacoes: str(r.observacoes),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))

    const hours = await q(`
      select id, cirurgiaFK, hora, mamba, tipo, status,
             implantadorD, auxiliarD, auxiliarD2,
             implantadorE, auxiliarE, auxiliarE2,
             implantadorC, auxiliarC, auxiliarC2,
             date_format(inicioD,'%Y-%m-%dT%H:%i:%s')     iniD,
             date_format(inicioE,'%Y-%m-%dT%H:%i:%s')     iniE,
             date_format(inicioC,'%Y-%m-%dT%H:%i:%s')     iniC,
             -- dtCriacao do BLOCO é o início dele, não "criado em": a tela da sala
             -- grava e edita essa ponta em "salvar hora início", e é dela que sai a
             -- duração no relatório de horas (TIMESTAMPDIFF(dtCriacao, dtFim)).
             -- inicioD/E/C não serve: vem igual nas três e carimba quando a LINHA
             -- foi salva — nos blocos de implante, preenchidos no fim do dia, cai
             -- depois do fim e a janela fica negativa.
             date_format(dtCriacao,'%Y-%m-%dT%H:%i:%s')   ini,
             date_format(dtFim,'%Y-%m-%dT%H:%i:%s')       fim,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from cirurgia_hora`)
    await upsert('srg_hours', ofSurgery(hours).map((r) => ({
      id: num(r.id), surgery_id: num(r.cirurgiaFK), hora: num(r.hora), mamba: num(r.mamba),
      tipo: str(r.tipo), status: str(r.status),
      implantador_d: fkStaff(r.implantadorD), auxiliar_d: fkStaff(r.auxiliarD), auxiliar_d2: fkStaff(r.auxiliarD2),
      implantador_e: fkStaff(r.implantadorE), auxiliar_e: fkStaff(r.auxiliarE), auxiliar_e2: fkStaff(r.auxiliarE2),
      implantador_c: fkStaff(r.implantadorC), auxiliar_c: fkStaff(r.auxiliarC), auxiliar_c2: fkStaff(r.auxiliarC2),
      inicio: ts(r.ini),
      inicio_d: ts(r.iniD), inicio_e: ts(r.iniE), inicio_c: ts(r.iniC), dt_fim: ts(r.fim),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))

    const ext = await q(`
      select id, cirurgiaFK, placaFK, horaFK, quantidade1, quantidade2, lapidado, medicoFK, numero,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from cirurgia_foliculo_extraido`)
    await upsert('srg_follicles_extracted', ofSurgery(ext).map((r) => ({
      id: num(r.id), surgery_id: num(r.cirurgiaFK),
      plate_id: plateIds.has(Number(r.placaFK)) ? num(r.placaFK) : null,
      hour_id: num(r.horaFK),
      quantidade1: num(r.quantidade1), quantidade2: num(r.quantidade2),
      lapidado: str(r.lapidado) === 'S', medico_id: fkStaff(r.medicoFK), numero: num(r.numero),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))

    const imp = await q(`
      select id, cirurgiaFK, cirurgia_foliculo_extraidoFK, cirurgia_areaFK, cirurgia_horaFK,
             quantidade, regiao,
             date_format(excluido,'%Y-%m-%dT%H:%i:%s')    exc,
             date_format(dtAlteracao,'%Y-%m-%dT%H:%i:%s') alt
        from cirurgia_foliculo_implantado`)
    await upsert('srg_follicles_implanted', ofSurgery(imp).map((r) => ({
      id: num(r.id), surgery_id: num(r.cirurgiaFK),
      extracted_id: num(r.cirurgia_foliculo_extraidoFK),
      surgery_area_id: num(r.cirurgia_areaFK), hour_id: num(r.cirurgia_horaFK),
      quantidade: num(r.quantidade), regiao: str(r.regiao),
      deleted_at: ts(r.exc), source_updated_at: ts(r.alt), synced_at: new Date().toISOString(),
    })))

    // ---- 3) Agregados + vínculo paciente ---------------------------------------
    let totals = 0
    let match: Record<string, unknown> | null = null
    if (!dryRun) {
      const { data: t, error: tErr } = await supa.rpc('srg_refresh_totals')
      if (tErr) errors.totals = tErr.message; else totals = Number(t ?? 0)

      if (runMatch) {
        const { data: m, error: mErr } = await supa.rpc('srg_match_patients', { p_only_pending: true })
        if (mErr) errors.match = mErr.message
        else match = (Array.isArray(m) ? m[0] : m) as Record<string, unknown>
      }
    }

    if (!dryRun) {
      const now = new Date().toISOString()
      await supa.from('srg_sync_state').upsert(
        Object.entries(counts).map(([key, n]) => ({
          key, last_run_at: now, rows_upserted: n,
          ok: !errors[key], error: errors[key] ?? null,
        })),
        { onConflict: 'key' },
      )
    }

    return json({
      ok: Object.keys(errors).length === 0,
      dry_run: dryRun,
      ms: Date.now() - started,
      counts,
      totals_atualizados: totals,
      match,
      errors: Object.keys(errors).length ? errors : undefined,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // PostgrestBuilder é thenable mas não tem .catch — try/await, não .catch().
    if (!dryRun) {
      try {
        await supa.from('srg_sync_state').upsert(
          { key: '_run', last_run_at: new Date().toISOString(), ok: false, error: msg },
          { onConflict: 'key' },
        )
      } catch { /* falha ao registrar a falha não pode derrubar a resposta */ }
    }
    return json({ ok: false, error: msg, counts }, 500)
  } finally {
    try { await mysql?.close() } catch { /* ignore */ }
  }
})
