/**
 * Casa o `@lid` do WhatsApp com o telefone de verdade, e junta os cadastros gêmeos.
 *
 * O `@lid` é o identificador que o WhatsApp passou a usar no lugar do número quando a pessoa
 * liga a privacidade. São 14-15 dígitos com cara de telefone internacional. Até 08/set/2026 o
 * CRM gravava aquilo em `leads.phone`: 122 cadastros com um "telefone" que ninguém consegue
 * discar, e a mesma pessoa nascendo DUAS vezes — uma pelo número, outra pelo lid.
 *
 * O webhook já foi corrigido e passou a guardar o par em `custom_fields.wa_lid` (ele vem de
 * graça: a mensagem normal traz número em `sender.id` e lid em `sender.senderLid`). Este
 * script conserta o que ficou para trás, e faz isso pela ÚNICA fonte que prova a ligação:
 * `GET /contacts/phone-exists` da W-API, que devolve o lid do número consultado.
 *
 * Duas travas, pelo mesmo motivo da correção de telefone do leadform:
 *  1) nada de adivinhar por nome. Nome igual não é prova — "Recepção" tinha DOIS candidatos
 *     com número real e só um deles bate com o lid (`554491828888`; o outro tem lid próprio).
 *     Quem decide é a W-API.
 *  2) a linha que fica é a do TELEFONE, e o lid vira `wa_lid` nela. O contrário perderia o
 *     único número discável da pessoa.
 *
 * Roda no Deno para usar o mesmo `mergeLeadDropIntoKeep` da edge function, sem uma segunda
 * cópia da regra de mesclagem para divergir depois.
 *
 * Uso:  deno run -A scripts/casar-lid-com-telefone.ts             (só mostra o plano)
 *       deno run -A scripts/casar-lid-com-telefone.ts --aplicar
 *       deno run -A scripts/casar-lid-com-telefone.ts --limite=300 (corta a varredura)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { mergeLeadDropIntoKeep } from '../supabase/functions/_shared/crm.ts'

const PROJECT = 'fgyfpmnvlkmyxtucbxbu'
const APLICAR = Deno.args.includes('--aplicar')
const LIMITE = Number(Deno.args.find((a) => a.startsWith('--limite='))?.split('=')[1] ?? '4000')

/** Intervalo entre chamadas à W-API. Consulta de contato não é mensagem, mas a sessão é a
 *  mesma que atende paciente — varrer 3 mil números a toda velocidade é ruído à toa. */
const PAUSA_MS = 350

async function keychain(servico: string): Promise<string> {
  const { stdout } = await new Deno.Command('security', {
    args: ['find-generic-password', '-s', servico, '-w'],
  }).output()
  const raw = new TextDecoder().decode(stdout).trim()
  return atob(raw.replace(/^go-keyring-base64:/, '')).trim()
}
const TOKEN = await keychain('Supabase CLI')

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
const digitos = (s: unknown) => String(s ?? '').replace(/\D/g, '')

// ── 0. credenciais das linhas ───────────────────────────────────────────────
const linhas = await sql(`
  select id, tenant_id, wapi_token, wapi_instance_id,
         coalesce(nullif(btrim(wapi_base_url),''),'https://api.w-api.app/v1') as base
  from whatsapp_channel_instances
  where channel_provider = 'wapi' and active is true
`)
if (!linhas.length) throw new Error('nenhuma linha W-API ativa')

/** O lid de um número, segundo a W-API. `null` = ela não respondeu (não é "não existe"). */
async function lidDoNumero(linha: Row, fone: string): Promise<string | null> {
  const qs = new URLSearchParams({ instanceId: linha.wapi_instance_id, phoneNumber: fone, phone: fone })
  try {
    const res = await fetch(`${linha.base}/contacts/phone-exists?${qs}`, {
      headers: { Authorization: `Bearer ${linha.wapi_token}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const body = await res.json() as { lid?: unknown }
    const lid = digitos(body?.lid)
    return lid.length >= 10 ? lid : null
  } catch {
    return null
  }
}

// ── 1. os cadastros que hoje têm um lid no lugar do telefone ────────────────
const órfãos = await sql(`
  select id, patient_name, phone, tenant_id, whatsapp_instance_id
  from leads
  where deleted_at is null
    and length(regexp_replace(phone,'\\D','','g')) between 14 and 15
    and regexp_replace(phone,'\\D','','g') not like '888%'
`)
const porLid = new Map<string, Row>()
for (const o of órfãos) porLid.set(digitos(o.phone), o)
console.log(`cadastros presos a um lid: ${porLid.size}`)

// ── 2. varre quem tem telefone de verdade e pergunta o lid à W-API ──────────
const comFone = await sql(`
  select id, patient_name, phone, tenant_id, whatsapp_instance_id
  from leads
  where deleted_at is null
    and (custom_fields->>'wa_lid') is null
    and regexp_replace(phone,'\\D','','g') like '55%'
    and length(regexp_replace(phone,'\\D','','g')) between 12 and 13
  order by last_interaction_at desc nulls last
  limit ${LIMITE}
`)
console.log(`números a consultar: ${comFone.length} (pausa de ${PAUSA_MS}ms entre eles)`)

const aprender: Array<{ id: string; lid: string }> = []
const casar: Array<{ keep: string; drop: string; lid: string; nome: string; fone: string }> = []
let consultados = 0
let semResposta = 0

for (const lead of comFone) {
  const linha = linhas.find((l) => l.id === lead.whatsapp_instance_id) ??
    linhas.find((l) => l.tenant_id === lead.tenant_id) ?? linhas[0]
  const lid = await lidDoNumero(linha, digitos(lead.phone))
  consultados++
  if (!lid) {
    semResposta++
  } else {
    aprender.push({ id: lead.id, lid })
    const gêmeo = porLid.get(lid)
    if (gêmeo && gêmeo.id !== lead.id) {
      casar.push({ keep: lead.id, drop: gêmeo.id, lid, nome: String(lead.patient_name ?? ''), fone: digitos(lead.phone) })
      porLid.delete(lid)
    }
  }
  if (consultados % 100 === 0) {
    console.log(`  ${consultados}/${comFone.length} · lid aprendido: ${aprender.length} · gêmeo achado: ${casar.length}`)
  }
  await new Promise((r) => setTimeout(r, PAUSA_MS))
}

console.log(`\nconsultados: ${consultados} · sem resposta: ${semResposta}`)
console.log(`lid aprendido (vai para custom_fields.wa_lid): ${aprender.length}`)
console.log(`cadastros gêmeos a juntar: ${casar.length}`)
for (const c of casar) console.log(`  ${c.nome || '(sem nome)'} · ${c.fone} ← lid ${c.lid} (${c.drop})`)
console.log(`sobram presos a um lid, sem número conhecido: ${porLid.size}`)

if (!APLICAR) {
  console.log('\n(ensaio — rode com --aplicar para gravar)')
  Deno.exit(0)
}

// ── 3. grava ────────────────────────────────────────────────────────────────
// O índice primeiro: mesmo sem gêmeo nenhum, ele é o que faz a PRÓXIMA mensagem por lid
// cair no cadastro certo em vez de abrir um novo.
for (let i = 0; i < aprender.length; i += 200) {
  const lote = aprender.slice(i, i + 200)
  await sql(`
    update leads as l set custom_fields = coalesce(l.custom_fields,'{}'::jsonb) || jsonb_build_object('wa_lid', v.lid)
    from (values ${lote.map((a) => `(${lit(a.id)}, ${lit(a.lid)})`).join(',')}) as v(id, lid)
    where l.id = v.id
  `)
}
console.log(`wa_lid gravado em ${aprender.length} cadastros.`)

const admin = createClient(
  `https://${PROJECT}.supabase.co`,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? await keychain('instituto-lorena service_role'),
)
for (const c of casar) {
  await mergeLeadDropIntoKeep(admin, c.keep, c.drop)
  console.log(`  juntado: ${c.nome} · ${c.drop} → ${c.keep}`)
}
console.log(`\npronto. ${casar.length} cadastros gêmeos viraram um só.`)
