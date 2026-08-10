import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { Client as MySqlClient } from 'https://deno.land/x/mysql@v2.12.1/mod.ts'

// ─────────────────────────────────────────────────────────────────────────────
// Empurra a cirurgia vendida na Central de Vendas para a agenda do centro
// cirúrgico (MySQL c7lorenaap, o sistema PHP/CI4 que a Edna usa lá embaixo).
//
// É o único ponto do CRM que ESCREVE nesse banco. O espelho crm-cirurgia-sync
// continua mão única na direção contrária, e as duas coisas não se cruzam: aqui
// só nasce linha nova, nunca se altera linha que o centro cirúrgico já tocou.
//
// O que escreve, e por quê exatamente isso: uma cirurgia futura, no sistema
// deles, é uma linha em `cirurgia` com status AGUARDANDO, `dia` preenchido e
// `horaInicio` NULO (validado na linha id 237, agendada para 2027). Quem carimba
// hora, sala e meta é a equipe no dia, apertando o start. Então o CRM entrega o
// que o CRM sabe (paciente, dia, médico, anestesista) e não inventa o resto.
//
// Campos conforme CirurgiaModel::$allowedFields do repo deles:
//   paciente, dia, horaInicio, dtFim, medicoFK, anestesistaFK, anamnese,
//   observacoes, status, sala, idade, meta
// Timestamps do model: dtCriacao / dtAlteracao. Soft delete: excluido.
//
// FUSO: igual ao sync. Os datetime do MySQL não têm timezone e o servidor roda
// em UTC-3. Montamos a string de data já no fuso de São Paulo em vez de deixar
// o driver converter, senão a cirurgia das 7h vira 4h.
//
// SEGURANÇA: só escreve de verdade com CIRURGIA_PUSH_ENABLED='true'. Sem isso
// devolve exatamente o INSERT que faria, sem tocar no banco deles.
//
// Secrets: CIRURGIA_DB_HOST, CIRURGIA_DB_NAME, CIRURGIA_DB_USER,
//          CIRURGIA_DB_PASSWORD, CIRURGIA_PUSH_ENABLED
// ─────────────────────────────────────────────────────────────────────────────

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

const ENABLED = (Deno.env.get('CIRURGIA_PUSH_ENABLED') ?? '').trim().toLowerCase() === 'true'

/** 'YYYY-MM-DD HH:MM:SS' no fuso da clínica, que é como o MySQL deles guarda. */
function saoPaulo(iso: string): { dia: string; hora: string } {
  const d = new Date(iso)
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(d)
  const [dia, hora] = partes.split(' ')
  return { dia, hora }
}

const agoraSaoPaulo = () => {
  const { dia, hora } = saoPaulo(new Date().toISOString())
  return `${dia} ${hora}`
}

type Venda = {
  id: string
  patient_name: string
  scheduled_at: string
  performing_doctor: string | null
  anesthetist: string | null
  procedure_label: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRole) return json({ ok: false, error: 'server_misconfigured' }, 500)
  const admin = createClient(url, serviceRole)

  const host = Deno.env.get('CIRURGIA_DB_HOST')
  const db = Deno.env.get('CIRURGIA_DB_NAME')
  const user = Deno.env.get('CIRURGIA_DB_USER')
  const password = Deno.env.get('CIRURGIA_DB_PASSWORD')
  if (!host || !db || !user || !password) {
    return json({ ok: false, error: 'missing_secrets' }, 500)
  }

  // Só cirurgia futura, vendida aqui, que ainda não existe lá.
  const { data, error } = await admin
    .from('clinic_sales')
    .select('id, patient_name, scheduled_at, performing_doctor, anesthetist, procedure_label')
    .eq('kind', 'cirurgia')
    .in('status', ['vendida', 'agendada'])
    .is('srg_surgery_id', null)
    .not('scheduled_at', 'is', null)
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(50)
  if (error) return json({ ok: false, error: error.message }, 500)
  const vendas = (data ?? []) as Venda[]

  // medicoFK e anestesistaFK apontam para `cliente` no banco deles; o espelho
  // srg_staff guarda o id de lá, então é ele que traduz nome em id.
  // Chave é (tipo, nome), não só nome: a Dra Lorena Visentainer está cadastrada
  // duas vezes lá, como ADMIN (id 189) e como MEDICO (id 172). Indexando só pelo
  // nome, o ADMIN sobrescrevia o médico e as cirurgias dela eram todas puladas.
  const { data: equipe } = await admin.from('srg_staff').select('id, nome, tipo')
  const porTipoNome = new Map<string, number>()
  for (const s of equipe ?? []) {
    const row = s as { id: number; nome: string; tipo: string }
    porTipoNome.set(`${row.tipo}|${String(row.nome).trim().toLowerCase()}`, Number(row.id))
  }
  const idDe = (nome: string | null, tipo: string): number | null => {
    if (!nome) return null
    return porTipoNome.get(`${tipo}|${nome.trim().toLowerCase()}`) ?? null
  }

  const planejado: Array<Record<string, unknown>> = []
  const puladas: Array<Record<string, unknown>> = []
  for (const v of vendas) {
    const medicoFK = idDe(v.performing_doctor, 'MEDICO')
    if (!medicoFK) {
      // Sem médico não dá para criar: medicoFK é o join do sistema deles com a
      // equipe, e linha sem médico quebra a listagem de cirurgias.
      puladas.push({ venda: v.id, paciente: v.patient_name, motivo: 'médico não encontrado na equipe do centro cirúrgico' })
      continue
    }
    const { dia } = saoPaulo(v.scheduled_at)
    planejado.push({
      venda: v.id,
      paciente: v.patient_name,
      dia,
      medicoFK,
      anestesistaFK: idDe(v.anesthetist, 'ANESTESISTA'),
      status: 'AGUARDANDO',
      observacoes: `${v.procedure_label} · lançado pela Central de Vendas do CRM`,
    })
  }

  if (!ENABLED) {
    return json({ ok: true, dryRun: true, criaria: planejado.length, planejado, puladas })
  }

  const cliente = await new MySqlClient().connect({
    hostname: host, db, username: user, password, poolSize: 1,
  })
  const criadas: Array<Record<string, unknown>> = []
  try {
    for (const p of planejado) {
      // Idempotência do lado deles: mesmo paciente no mesmo dia não entra duas
      // vezes. Sem isso, uma segunda rodada duplicaria a cirurgia na agenda.
      const jaTem = await cliente.query(
        'select id from cirurgia where paciente = ? and dia = ? and excluido is null limit 1',
        [p.paciente, p.dia],
      )
      let idLa: number
      if (Array.isArray(jaTem) && jaTem.length > 0) {
        idLa = Number(jaTem[0].id)
      } else {
        const agora = agoraSaoPaulo()
        const res = await cliente.execute(
          'insert into cirurgia (paciente, dia, medicoFK, anestesistaFK, status, observacoes, dtCriacao, dtAlteracao) values (?, ?, ?, ?, ?, ?, ?, ?)',
          [p.paciente, p.dia, p.medicoFK, p.anestesistaFK, p.status, p.observacoes, agora, agora],
        )
        idLa = Number(res.lastInsertId)
      }
      await admin.from('clinic_sales').update({ srg_surgery_id: idLa }).eq('id', String(p.venda))
      criadas.push({ venda: p.venda, paciente: p.paciente, dia: p.dia, cirurgia_id: idLa })
    }
  } finally {
    await cliente.close()
  }

  return json({ ok: true, dryRun: false, criadas: criadas.length, criadas, puladas })
})
