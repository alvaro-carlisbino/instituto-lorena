/**
 * Reprocessa o telefone dos leads que entraram por formulário Meta (Lead Ads).
 *
 * Por quê: até 20/ago/2026 o webhook só sabia tirar zero à esquerda e pôr o `55`. Celular
 * escrito com 8 dígitos, zero do DDD depois do DDI e número estrangeiro passavam direto e
 * viravam `leads.phone` impossível — 11% dos leads pagos com telefone que não existe.
 * O webhook já foi corrigido (`_shared/brPhone.ts`); isto conserta o que ficou gravado.
 *
 * DUAS TRAVAS, e as duas custaram caro para descobrir:
 *  1) lead que JÁ RECEBEU mensagem de entrada no WhatsApp não se toca. O telefone dele foi
 *     reescrito pelo JID do provedor, que para conta antiga vem SEM o 9º dígito — e funciona.
 *     Seis leads do reprocessamento de 20/ago eram exatamente isso: "consertar" para 13
 *     dígitos quebraria conversa viva.
 *  2) se o número corrigido já é de OUTRO lead, não escreve. Isso é mesclagem, e o 9º dígito
 *     é palpite de identidade, não prova (ver memória crm-identidade-telefone-nono-digito).
 *     Sai na lista para decisão humana.
 *
 * Roda no Deno de propósito: assim importa o MESMO `brPhone.ts` que a edge function usa,
 * sem cópia paralela da regra para sair do lugar depois.
 *
 * Uso:  deno run -A scripts/corrigir-telefones-leadform.ts            (só mostra o plano)
 *       deno run -A scripts/corrigir-telefones-leadform.ts --aplicar
 */
import { normalizeBrPhone } from '../supabase/functions/_shared/brPhone.ts'

const PROJECT = 'fgyfpmnvlkmyxtucbxbu'
const APLICAR = Deno.args.includes('--aplicar')

/** Token da CLI do Supabase, guardado no keychain do macOS. */
async function token(): Promise<string> {
  const cmd = new Deno.Command('security', {
    args: ['find-generic-password', '-s', 'Supabase CLI', '-w'],
  })
  const { stdout } = await cmd.output()
  const raw = new TextDecoder().decode(stdout).trim()
  return atob(raw.replace(/^go-keyring-base64:/, '')).trim()
}
const TOKEN = await token()

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

async function sql(query: string): Promise<Row[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`SQL ${res.status}: ${JSON.stringify(body).slice(0, 400)}`)
  return body
}
const lit = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`

// ── 1. candidatos ───────────────────────────────────────────────────────────
const linhas = await sql(`
  select l.id, l.patient_name, l.phone, l.stage_id, l.created_at,
         l.custom_fields->'lead_form'->'respostas'->>'whatsapp_number' as raw,
         (select count(*) from interactions i
           where i.lead_id = l.id and i.channel = 'whatsapp' and i.direction = 'in') as respondeu
  from leads l
  where l.deleted_at is null
    and l.custom_fields->'lead_form'->>'leadgen_id' is not null
    and coalesce(l.custom_fields->'lead_form'->'respostas'->>'whatsapp_number','') <> ''
  order by l.created_at desc
`)

const planos: Record<string, Row[]> = { igual: [], corrigir: [], invalido: [], protegido: [], colisao: [] }
for (const l of linhas) {
  const tel = normalizeBrPhone(l.raw)
  if (Number(l.respondeu) > 0) {
    if (tel.ok && tel.phone !== l.phone) planos.protegido.push({ ...l, novo: tel.phone })
    continue
  }
  if (!tel.ok) { planos.invalido.push({ ...l, motivo: tel.motivo }); continue }
  if (tel.phone === l.phone) { planos.igual.push(l); continue }
  planos.corrigir.push({ ...l, novo: tel.phone, estrangeiro: tel.estrangeiro })
}

// ── 2. colisão: o número corrigido já é de outro lead? ──────────────────────
if (planos.corrigir.length) {
  const alvos = [...new Set(planos.corrigir.map((p) => p.novo))]
  const donos = await sql(`
    select id, phone, patient_name from leads
    where deleted_at is null and phone in (${alvos.map(lit).join(',')})
  `)
  const porFone = new Map<string, Row[]>()
  for (const d of donos) { if (!porFone.has(d.phone)) porFone.set(d.phone, []) ; porFone.get(d.phone)!.push(d) }
  const restantes: Row[] = []
  for (const p of planos.corrigir) {
    const outros = (porFone.get(p.novo) ?? []).filter((d) => d.id !== p.id)
    if (outros.length) planos.colisao.push({ ...p, conflito: outros.map((o) => `${o.patient_name} (${o.id})`).join(', ') })
    else restantes.push(p)
  }
  planos.corrigir = restantes
}

// ── 3. relatório ────────────────────────────────────────────────────────────
const n = (k: string) => String(planos[k].length).padStart(4)
console.log(`\nLeads de formulário analisados: ${linhas.length}\n`)
console.log(`${n('igual')}  já corretos, nada a fazer`)
console.log(`${n('corrigir')}  telefone RECUPERÁVEL → vai ser corrigido`)
console.log(`${n('invalido')}  irrecuperável → carimbado como inválido, telefone mantido`)
console.log(`${n('colisao')}  o número corrigido já é de outro lead → DECISÃO HUMANA, não mexo`)
console.log(`${n('protegido')}  já responderam no WhatsApp → intocáveis (o número atual funciona)\n`)

for (const [titulo, chave, campo] of ([
  ['CORRIGIR', 'corrigir', (p: Row) => `${p.phone} → ${p.novo}${p.estrangeiro ? '  (estrangeiro, fica como veio)' : ''}`],
  ['IRRECUPERÁVEIS', 'invalido', (p: Row) => `${p.phone}  (${p.motivo})`],
  ['COLISÃO', 'colisao', (p: Row) => `${p.phone} → ${p.novo}  já é de ${p.conflito}`],
  ['PROTEGIDOS', 'protegido', (p: Row) => `${p.phone}  (recalculado daria ${p.novo}, mas a pessoa respondeu daqui)`],
] as const)) {
  const lista = planos[chave]
  if (!lista.length) continue
  console.log(`── ${titulo} (${lista.length}) ${'─'.repeat(Math.max(0, 60 - titulo.length))}`)
  for (const p of lista) {
    console.log(`  ${String(p.patient_name).slice(0, 34).padEnd(35)} ${String(p.raw).padEnd(19)} ${campo(p)}`)
  }
  console.log('')
}

if (!APLICAR) {
  console.log('Simulação. Nada foi escrito. Para aplicar: deno run -A scripts/corrigir-telefones-leadform.ts --aplicar\n')
  Deno.exit(0)
}

// ── 4. aplicação ────────────────────────────────────────────────────────────
const agora = new Date().toISOString()
if (planos.corrigir.length) {
  const vals = planos.corrigir.map((p) => `(${lit(p.id)},${lit(p.novo)},${lit(p.phone)})`).join(',')
  await sql(`
    begin;
    set local request.jwt.claims = '{"role":"service_role"}';
    update leads set
      phone = v.novo,
      custom_fields = jsonb_set(
        coalesce(custom_fields,'{}'::jsonb), '{lead_form,telefone_corrigido}',
        jsonb_build_object('de', v.antigo, 'para', v.novo, 'em', ${lit(agora)}), true)
    from (values ${vals}) as v(id, novo, antigo)
    where leads.id = v.id;
    commit;
  `)
  console.log(`✅ ${planos.corrigir.length} telefones corrigidos.`)
}
if (planos.invalido.length) {
  const vals = planos.invalido.map((p) => `(${lit(p.id)},${lit(p.motivo)})`).join(',')
  await sql(`
    begin;
    set local request.jwt.claims = '{"role":"service_role"}';
    update leads set custom_fields = jsonb_set(
      coalesce(custom_fields,'{}'::jsonb), '{lead_form,telefone_invalido}', to_jsonb(v.motivo::text), true)
    from (values ${vals}) as v(id, motivo)
    where leads.id = v.id;
    commit;
  `)
  console.log(`✅ ${planos.invalido.length} leads carimbados como telefone inválido.`)
}
console.log('')
