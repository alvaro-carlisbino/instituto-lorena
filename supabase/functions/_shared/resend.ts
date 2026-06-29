/**
 * Envio de e-mail via Resend (https://resend.com). Conta Tricopill, domínio verificado
 * tricopill.com.br (envio habilitado). A API key fica no SECRET do Supabase RESEND_API_KEY
 * (NUNCA no código/git). Remetente padrão configurável via RESEND_FROM.
 *
 * Uso: import { sendEmail } from '../_shared/resend.ts'
 *      await sendEmail({ to, subject, html })   // best-effort: devolve {ok,id|error}
 */

const RESEND_API = 'https://api.resend.com/emails'
const DEFAULT_FROM = (Deno.env.get('RESEND_FROM') ?? '').trim() || 'Tricopill <contato@tricopill.com.br>'

export function resendConfigured(): boolean {
  return !!(Deno.env.get('RESEND_API_KEY') ?? '').trim()
}

export async function sendEmail(args: {
  to: string | string[]
  subject: string
  html?: string
  text?: string
  from?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = (Deno.env.get('RESEND_API_KEY') ?? '').trim()
  if (!key) return { ok: false, error: 'resend_not_configured' }
  const to = (Array.isArray(args.to) ? args.to : [args.to]).map((e) => String(e).trim()).filter(Boolean)
  if (!to.length) return { ok: false, error: 'sem_destinatario' }
  if (!args.html && !args.text) return { ok: false, error: 'sem_conteudo' }
  try {
    const body: Record<string, unknown> = {
      from: args.from?.trim() || DEFAULT_FROM,
      to,
      subject: String(args.subject ?? '').slice(0, 200),
      ...(args.html ? { html: args.html } : {}),
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      ...(args.cc ? { cc: Array.isArray(args.cc) ? args.cc : [args.cc] } : {}),
      ...(args.bcc ? { bcc: Array.isArray(args.bcc) ? args.bcc : [args.bcc] } : {}),
    }
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const t = await res.text()
    let p: Record<string, unknown> = {}
    try { p = t ? JSON.parse(t) : {} } catch { p = {} }
    if (!res.ok) return { ok: false, error: `resend_${res.status}: ${t.slice(0, 200)}` }
    return { ok: true, id: typeof p.id === 'string' ? p.id : undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
