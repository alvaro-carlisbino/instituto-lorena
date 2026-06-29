/**
 * Templates de e-mail (HTML) do Tricopill, enviados via Resend ([[resend.ts]]).
 * Sem libs — HTML inline simples. Cada builder devolve { subject, html }.
 *  - orderConfirmEmail: confirmação ao cliente (adaptativo: completo confere / faltando pede)
 *  - internalSaleEmail: aviso interno de venda nova (equipe)
 *  - trackingEmail: rastreio/envio ao cliente
 */

type Obj = Record<string, unknown>

export const TEAM_EMAIL = (Deno.env.get('TRICOPILL_TEAM_EMAIL') ?? '').trim() || 'contato.tricopill@gmail.com'

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function addrLine(ent: Obj): string {
  if (String(ent.delivery_mode ?? '').trim() === 'retirada_clinica') return 'Retirada na clínica (Maringá)'
  const cep = String(ent.cep ?? '').replace(/\D/g, ''), numero = String(ent.numero ?? '').trim()
  const rua = String(ent.logradouro ?? '').trim(), bairro = String(ent.bairro ?? '').trim()
  const cidade = String(ent.cidade ?? '').trim(), uf = String(ent.uf ?? '').trim(), compl = String(ent.complemento ?? '').trim()
  const parts = [`${rua}, ${numero}`.trim(), compl, bairro, [cidade, uf].filter(Boolean).join('/'), cep ? 'CEP ' + cep : '']
  return parts.filter((p) => p && p !== ',').join(' - ') || '—'
}
function shell(inner: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1e1e1e;line-height:1.5">${inner}<hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#999">Tricopill · e-mail automático</p></div>`
}

export function orderConfirmEmail(a: { nome?: string; cad: Obj; ent: Obj; cpfPayment?: string; pedidoDesc: string; valorBRL: string }): { subject: string; html: string } {
  const cad = a.cad || {}, ent = a.ent || {}
  const nomeCompleto = String(cad.nomeCompleto ?? a.nome ?? '').trim()
  const first = nomeCompleto.split(/\s+/).filter(Boolean)[0] || 'tudo bem'
  const cpf = String(cad.cpf ?? a.cpfPayment ?? '').replace(/\D/g, '')
  const isPickup = String(ent.delivery_mode ?? '').trim() === 'retirada_clinica'
  const cep = String(ent.cep ?? '').replace(/\D/g, ''), numero = String(ent.numero ?? '').trim()
  const hasNome = nomeCompleto.split(/\s+/).filter(Boolean).length >= 2
  const hasCpf = cpf.length === 11
  const hasEnd = isPickup || (cep.length === 8 && numero.length > 0)
  const top = `<h2 style="color:#14362E;margin:0 0 8px">Recebemos seu pagamento ✅</h2><p>Olá ${esc(first)}!</p><p><b>Pedido:</b> ${esc(a.pedidoDesc)}<br><b>Valor:</b> ${esc(a.valorBRL)}</p>`
  const faltam: string[] = []
  if (!hasNome) faltam.push('nome completo')
  if (!hasCpf) faltam.push('CPF')
  if (!hasEnd) faltam.push('endereço completo (CEP, rua, número, bairro e cidade)')
  if (faltam.length) {
    return { subject: 'Recebemos seu pagamento — faltam alguns dados', html: shell(top + `<p>Pra preparar seu envio e emitir a nota fiscal, precisamos confirmar: <b>${faltam.map(esc).join(', ')}</b>.</p><p>É só responder este e-mail ou nos chamar no WhatsApp. 💚</p>`) }
  }
  const cpfFmt = cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  return { subject: 'Confirmação do seu pedido Tricopill', html: shell(top + `<p><b>Confira seus dados de entrega:</b></p><p>👤 ${esc(nomeCompleto)}<br>📄 CPF ${esc(cpfFmt)}<br>📍 ${esc(addrLine(ent))}</p><p>Está tudo certo? Se algo estiver errado, é só responder. 💚</p>`) }
}

export function internalSaleEmail(a: { nome?: string; cad: Obj; ent: Obj; cpfPayment?: string; pedidoDesc: string; valorBRL: string; phone?: string; metodo?: string }): { subject: string; html: string } {
  const cad = a.cad || {}, ent = a.ent || {}
  const nome = String(cad.nomeCompleto ?? a.nome ?? '(sem nome)').trim()
  const cpf = String(cad.cpf ?? a.cpfPayment ?? '').replace(/\D/g, '')
  return { subject: `🛒 Nova venda: ${nome} — ${a.valorBRL}`, html: shell(`<h2 style="color:#14362E;margin:0 0 8px">Nova venda 🛒</h2><p><b>Cliente:</b> ${esc(nome)}<br><b>CPF:</b> ${esc(cpf || '—')}<br><b>WhatsApp:</b> ${esc(a.phone || '—')}<br><b>Pedido:</b> ${esc(a.pedidoDesc)}<br><b>Valor:</b> ${esc(a.valorBRL)}<br><b>Pagamento:</b> ${esc(a.metodo || '—')}<br><b>Entrega:</b> ${esc(addrLine(ent))}</p>`) }
}

export function trackingEmail(a: { nome?: string; pedidoDesc?: string; tracking: string; url?: string }): { subject: string; html: string } {
  const first = String(a.nome ?? '').split(/\s+/).filter(Boolean)[0] || 'tudo bem'
  return { subject: 'Seu pedido Tricopill foi enviado 📦', html: shell(`<h2 style="color:#14362E;margin:0 0 8px">Seu pedido saiu para entrega 📦</h2><p>Olá ${esc(first)}!</p><p>Seu pedido${a.pedidoDesc ? ` (${esc(a.pedidoDesc)})` : ''} foi despachado.</p><p><b>Código de rastreio:</b> ${esc(a.tracking)}</p>${a.url ? `<p><a href="${esc(a.url)}">Acompanhar entrega</a></p>` : ''}<p>Qualquer dúvida, é só responder. 💚</p>`) }
}
