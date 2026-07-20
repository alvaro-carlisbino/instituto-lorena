#!/usr/bin/env node
/**
 * Gera um refresh token do Google com os escopos adwords + datamanager e já seta
 * o secret GOOGLE_ADS_REFRESH_TOKEN no Supabase (projeto tricopill/instituto).
 *
 * Por que: a Data Manager API (upload de conversão server-side pro Google Ads)
 * exige o escopo https://www.googleapis.com/auth/datamanager; o refresh token
 * antigo só tinha o escopo adwords e dá ACCESS_TOKEN_SCOPE_INSUFFICIENT.
 *
 * Antes de rodar, no Google Cloud Console (mesmo projeto do OAuth client):
 *   1. APIs & Services > Library > "Data Manager API" > Enable
 *   2. Tenha em mãos o Client ID e Client Secret do OAuth client
 *      (APIs & Services > Credentials). Se o client for tipo "Web application",
 *      adicione http://localhost:53682 nas "Authorized redirect URIs";
 *      se for "Desktop app", não precisa mexer em nada.
 *
 * Uso:  node scripts/gads-refresh-token.mjs
 *       (pede client id/secret, abre o navegador, você aprova com a conta Google
 *        que acessa o Google Ads do Tricopill, e ele finaliza sozinho)
 */
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import readline from 'node:readline/promises'

const PORT = 53682
const REDIRECT = `http://localhost:${PORT}`
const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/datamanager',
].join(' ')
const PROJECT_REF = 'fgyfpmnvlkmyxtucbxbu'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const clientId = (await rl.question('Client ID: ')).trim()
const clientSecret = (await rl.question('Client Secret: ')).trim()
rl.close()
if (!clientId || !clientSecret) {
  console.error('Client ID e Secret são obrigatórios.')
  process.exit(1)
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPES,
  access_type: 'offline',
  prompt: 'consent', // força emitir refresh token novo mesmo já tendo consentido antes
}).toString()

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT)
    const c = url.searchParams.get('code')
    const err = url.searchParams.get('error')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(c ? '<h2>Pronto! Pode fechar esta aba e voltar pro terminal.</h2>' : `<h2>Erro: ${err}</h2>`)
    if (c || err) {
      server.close()
      c ? resolve(c) : reject(new Error(err))
    }
  })
  server.listen(PORT, () => {
    console.log('\nAbrindo o navegador pra você aprovar o acesso...')
    console.log('(se não abrir, cole na mão: ' + authUrl + ')\n')
    spawnSync('open', [authUrl])
  })
})

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: REDIRECT, grant_type: 'authorization_code',
  }),
})
const tok = await tokenRes.json()
if (!tok.refresh_token) {
  console.error('Não veio refresh_token. Resposta:', JSON.stringify(tok, null, 2))
  process.exit(1)
}
console.log('Refresh token obtido. Setando secrets no Supabase...')

const args = [
  'secrets', 'set',
  `GOOGLE_ADS_REFRESH_TOKEN=${tok.refresh_token}`,
  `GOOGLE_ADS_CLIENT_ID=${clientId}`,
  `GOOGLE_ADS_CLIENT_SECRET=${clientSecret}`,
  '--project-ref', PROJECT_REF,
]
const out = spawnSync('supabase', args, { stdio: 'inherit' })
if (out.status !== 0) {
  console.error('\nFalhou setar via supabase CLI. Rode na mão:')
  console.error(`  supabase secrets set GOOGLE_ADS_REFRESH_TOKEN=<token> --project-ref ${PROJECT_REF}`)
  console.error('\nRefresh token (guarde com cuidado):', tok.refresh_token)
  process.exit(1)
}
console.log('\nFeito! Agora peça pro Claude rodar o backfill de novo (crm-gads-backfill).')
