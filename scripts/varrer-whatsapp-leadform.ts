/**
 * Pergunta à W-API, um a um, se o telefone de cada lead de formulário Meta tem WhatsApp,
 * e guarda a resposta em `custom_fields.lead_form.whatsapp`.
 *
 * Para que serve: separar "não respondeu" de "não existe". Até 20/ago/2026 os dois casos
 * eram a mesma coluna vazia no quadro, e a equipe ligava para número morto sem saber.
 *
 * RITMO É PARTE DA FERRAMENTA, não enfeite. Consultar a agenda de contatos em rajada é o
 * mesmo padrão de lista comprada que a guarda anti-ban existe para evitar — varrer 800
 * números em dois minutos protege o dado e queima a linha. Por isso: uma consulta por vez,
 * pausa entre elas, teto por execução, e resultado gravado a cada resposta para poder parar
 * no meio sem perder nada.
 *
 * Não pergunta de quem JÁ respondeu no WhatsApp: esse número está provado, e a consulta
 * seria gasto puro de sinal.
 *
 * Uso:  deno run -A scripts/varrer-whatsapp-leadform.ts [--limite=60] [--pausa=2500] [--refazer]
 */
const LIMITE = Number(Deno.args.find((a) => a.startsWith('--limite='))?.split('=')[1] ?? 60)
const PAUSA_MS = Number(Deno.args.find((a) => a.startsWith('--pausa='))?.split('=')[1] ?? 2500)
const REFAZER = Deno.args.includes('--refazer')
const PROJECT = 'fgyfpmnvlkmyxtucbxbu'
const LINHA = 'wa-wapi-mpyi00su'

async function token(): Promise<string> {
  const { stdout } = await new Deno.Command('security', {
    args: ['find-generic-password', '-s', 'Supabase CLI', '-w'],
  }).output()
  return atob(new TextDecoder().decode(stdout).trim().replace(/^go-keyring-base64:/, '')).trim()
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
  if (!res.ok) throw new Error(`SQL ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return body
}
const lit = (s: unknown) => `'${String(s).replace(/'/g, "''")}'`
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

const alvos = await sql(`
  select l.id, l.patient_name, l.phone
  from leads l
  where l.deleted_at is null
    and l.custom_fields->'lead_form'->>'leadgen_id' is not null
    and length(l.phone) >= 10
    ${REFAZER ? '' : "and l.custom_fields->'lead_form'->'whatsapp'->>'existe' is null"}
    and not exists (
      select 1 from interactions i
      where i.lead_id = l.id and i.channel = 'whatsapp' and i.direction = 'in')
  order by l.created_at desc
  limit ${Math.max(1, Math.min(400, LIMITE))}
`)

if (!alvos.length) {
  console.log('\nNada a consultar: todos os leads de formulário já foram checados.\n')
  Deno.exit(0)
}

const minutos = Math.ceil((alvos.length * PAUSA_MS) / 60000)
console.log(`\n${alvos.length} números a consultar, ${PAUSA_MS}ms entre um e outro (~${minutos} min).\n`)

/** A consulta sai de dentro do banco para o token da linha não passar pelo terminal. */
async function temWhatsapp(numero: string): Promise<boolean | null> {
  const [row] = await sql(`
    set local statement_timeout = '30s';
    select extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','20000');
    with linha as (
      select wapi_instance_id as iid, wapi_token as tok,
             coalesce(nullif(wapi_base_url,''),'https://api.w-api.app/v1') as base
      from whatsapp_channel_instances where id = ${lit(LINHA)}
    )
    select (r).status as http, (r).content as corpo
    from linha l, lateral (select extensions.http((
      'GET',
      l.base || '/contacts/phone-exists?instanceId=' || l.iid
             || '&phoneNumber=' || ${lit(numero)} || '&phone=' || ${lit(numero)},
      ARRAY[extensions.http_header('Authorization','Bearer '||l.tok)],
      NULL, NULL)::extensions.http_request) as r) x
  `)
  if (!row || Number(row.http) !== 200) return null
  try {
    const v = JSON.parse(String(row.corpo))?.exists
    return typeof v === 'boolean' ? v : null
  } catch {
    return null
  }
}

/**
 * A W-API as vezes passa dos 5s padrao do `http` do Postgres, e ai a query INTEIRA volta
 * erro. Na primeira versao isso derrubava a varredura no meio (três vezes, no numero 227).
 * Um numero lento nao pode custar os outros 600: engole, conta e segue.
 */
async function temWhatsappSeguro(numero: string): Promise<boolean | null> {
  try {
    return await temWhatsapp(numero)
  } catch {
    return null
  }
}

let tem = 0, naoTem = 0, semResposta = 0
const mortos: Row[] = []
for (const [i, lead] of alvos.entries()) {
  if (i > 0) await dorme(PAUSA_MS)
  const existe = await temWhatsappSeguro(String(lead.phone))
  if (existe === true) tem++
  else if (existe === false) { naoTem++; mortos.push(lead) }
  else { semResposta++; continue } // sem resposta não se grava: silêncio não é veredicto

  await sql(`
    begin;
    set local request.jwt.claims = '{"role":"service_role"}';
    update leads set custom_fields = jsonb_set(
      coalesce(custom_fields,'{}'::jsonb), '{lead_form,whatsapp}',
      jsonb_build_object('existe', ${existe}, 'conferido_em', now()), true)
    where id = ${lit(lead.id)};
    commit;
  `)
  const marca = existe ? 'tem' : 'NÃO TEM'
  console.log(`  ${String(i + 1).padStart(3)}/${alvos.length}  ${String(lead.phone).padEnd(15)} ${marca.padEnd(8)} ${String(lead.patient_name).slice(0, 38)}`)
}

console.log(`\n── resultado desta volta ─────────────────────────────`)
console.log(`  ${tem} com WhatsApp`)
console.log(`  ${naoTem} SEM WhatsApp (${((naoTem / Math.max(1, tem + naoTem)) * 100).toFixed(1)}% dos que responderam)`)
console.log(`  ${semResposta} sem resposta da API (não gravados, entram na próxima volta)\n`)
