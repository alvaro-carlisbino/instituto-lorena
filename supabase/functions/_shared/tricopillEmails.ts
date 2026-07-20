/**
 * E-mails transacionais do Tricopill (via Resend). Primeira vez que o e-mail entra no
 * jogo: o Resend estava conectado desde 29/jun e plugado em ZERO eventos, enquanto todo
 * cliente entrega o e-mail no checkout.
 *
 * Dois e-mails, os dois com trabalho de venda:
 *  • Pós-compra: confirma o pedido + convida pro Clube (grupo) + cupom pra próxima.
 *  • Carrinho abandonado: backup do WhatsApp (custo zero, sem risco de ban), com o
 *    link de pagamento e, do 2º toque em diante, o cupom.
 *
 * Estilo: texto direto, sem travessão (regra da casa), botão único por e-mail.
 */
import { sendEmail } from './resend.ts'

const CLUBE_LINK = 'https://chat.whatsapp.com/GlRBbbwhjELGZ4u93VGviT'
const GOLD = '#b8975a'
const INK = '#241e18'

function shell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1ece3;">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:Arial,Helvetica,sans-serif;color:${INK};">
    <div style="text-align:center;padding:18px 0 22px;">
      <div style="font-size:22px;letter-spacing:4px;font-weight:bold;">TRICOPILL</div>
      <div style="font-size:10px;letter-spacing:3px;color:#8a7547;">COMPOSTO CAPILAR</div>
    </div>
    <div style="background:#ffffff;border-radius:14px;padding:28px 24px;">
      ${inner}
    </div>
    <p style="text-align:center;font-size:11px;color:#9a8f80;margin-top:18px;line-height:1.6;">
      Tricopill · Maringá/PR · WhatsApp (44) 99906-7665<br>
      Você recebe este e-mail porque comprou ou iniciou uma compra em tricopill.com.br.
    </p>
  </div></body></html>`
}

const btn = (href: string, label: string) =>
  `<div style="text-align:center;margin:22px 0;"><a href="${href}" style="background:${GOLD};color:#241e18;text-decoration:none;font-weight:bold;padding:13px 30px;border-radius:999px;display:inline-block;font-size:15px;">${label}</a></div>`

export async function sendPostPurchaseEmail(args: {
  to: string
  firstName: string
  amountFmt: string
  description?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const inner = `
    <h1 style="font-size:21px;margin:0 0 14px;">Pedido confirmado, ${args.firstName}! 💚</h1>
    <p style="font-size:15px;line-height:1.65;margin:0 0 12px;">
      Recebemos o seu pagamento de <strong>${args.amountFmt}</strong>${args.description ? ` (${args.description})` : ''}.
      O envio já está sendo preparado e o código de rastreio chega no seu WhatsApp.
    </p>
    <div style="background:#f5f9f6;border:1px solid #cfe5d8;border-radius:10px;padding:16px 18px;margin:18px 0;">
      <p style="font-size:14px;line-height:1.6;margin:0;">
        <strong>Enquanto o pedido chega:</strong> entra no <strong>Clube Tricopill</strong>, nosso grupo
        de ofertas no WhatsApp. Quem está lá ganha <strong>10% em qualquer pedido</strong> (cupom CLUBE10)
        e vê as promoções relâmpago antes de todo mundo.
      </p>
      ${btn(CLUBE_LINK, 'Entrar no Clube')}
    </div>
    <p style="font-size:13px;line-height:1.6;color:#6b6156;margin:0;">
      Qualquer dúvida sobre o pedido, é só responder este e-mail ou chamar no WhatsApp (44) 99906-7665.
    </p>`
  return sendEmail({ to: args.to, subject: `Pedido confirmado · ${args.amountFmt} · Tricopill`, html: shell(inner) })
}

export async function sendCartRecoveryEmail(args: {
  to: string
  firstName: string
  payLink: string
  step: 1 | 2
  couponCode?: string
  couponPct?: number
}): Promise<{ ok: boolean; error?: string }> {
  const inner = args.step === 1
    ? `
    <h1 style="font-size:21px;margin:0 0 14px;">${args.firstName}, seu pedido ficou esperando 💚</h1>
    <p style="font-size:15px;line-height:1.65;margin:0 0 8px;">
      Vimos que você estava finalizando sua compra na Tricopill e o pagamento não foi concluído.
      Aconteceu alguma coisa? Se foi dúvida de pagamento ou frete, responde este e-mail que a gente resolve junto.
    </p>
    <p style="font-size:15px;line-height:1.65;margin:0;">Seu link continua ativo:</p>
    ${btn(args.payLink, 'Finalizar meu pedido')}`
    : `
    <h1 style="font-size:21px;margin:0 0 14px;">${args.firstName}, ainda dá tempo 🌿</h1>
    <p style="font-size:15px;line-height:1.65;margin:0 0 8px;">
      Seu pedido na Tricopill segue reservado.${args.couponCode ? ` E pra te ajudar a fechar hoje, o cupom <strong>${args.couponCode}</strong> dá <strong>${args.couponPct ?? 10}% de desconto</strong> em qualquer pedido no site.` : ''}
    </p>
    ${btn(args.payLink, 'Concluir com o link original')}
    ${args.couponCode ? `<p style="font-size:13px;line-height:1.6;color:#6b6156;text-align:center;margin:0;">Prefere usar o cupom? Monte o pedido de novo em tricopill.com.br e aplique <strong>${args.couponCode}</strong> no carrinho.</p>` : ''}`
  return sendEmail({
    to: args.to,
    subject: args.step === 1 ? 'Seu pedido Tricopill ficou esperando' : 'Ainda dá tempo de garantir seu Tricopill',
    html: shell(inner),
  })
}

// Follow-up de quem pegou o cupom no popup do site (lead magnet) e não comprou.
// Relembra o CLUBE10, mostra o kit mais escolhido e leva de volta pra loja.
export async function sendLeadMagnetFollowupEmail(args: {
  to: string
  firstName?: string
  couponCode?: string
  couponPct?: number
}): Promise<{ ok: boolean; error?: string }> {
  const nome = (args.firstName && args.firstName.trim()) ? args.firstName.trim() : 'oi'
  const cupom = args.couponCode || 'CLUBE10'
  const pct = args.couponPct ?? 10
  const inner = `
    <h1 style="font-size:21px;margin:0 0 14px;">${nome}, seu cupom de ${pct}% ainda está de pé 🌿</h1>
    <p style="font-size:15px;line-height:1.65;margin:0 0 12px;">
      Você pegou o cupom <strong>${cupom}</strong> no nosso site, mas não chegou a fazer o pedido.
      Ele continua valendo em <strong>qualquer produto</strong> da Tricopill, é só aplicar no carrinho.
    </p>
    <div style="background:#faf6ef;border:1px solid #e7dcc7;border-radius:10px;padding:16px 18px;margin:16px 0;">
      <p style="font-size:14px;line-height:1.6;margin:0 0 4px;"><strong>Mais escolhido:</strong> Kit Fortalecimento (3 meses)</p>
      <p style="font-size:13px;line-height:1.6;color:#6b6156;margin:0;">4 frascos pelo preço de 3 · equivale a R$149/frasco · Pix com 5% off.</p>
    </div>
    ${btn('https://tricopill.com.br/produto/tricopill-fortalecimento', `Usar meu cupom ${cupom}`)}
    <p style="font-size:13px;line-height:1.6;color:#6b6156;text-align:center;margin:0;">
      Prefere tirar uma dúvida antes? Chama no WhatsApp (44) 99906-7665, a gente te ajuda a escolher.
    </p>`
  return sendEmail({
    to: args.to,
    subject: `${nome}, seu cupom ${cupom} de ${pct}% ainda está ativo`,
    html: shell(inner),
  })
}
