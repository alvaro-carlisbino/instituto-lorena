// O Pix copia e cola precisa chegar SOZINHO numa mensagem.
//
// No WhatsApp, tocar e segurar copia a mensagem INTEIRA. Com o código no meio do texto, o cliente
// colava "Claro, Eloísa. Segue a chave Pix... 000201... Assim que o pagamento cair..." no app do
// banco, e o banco recusava. Isadora (14/09/2026): "Tem apenas o copia e cola / Sem as mensagens";
// Eloísa (16/09/2026): "Manda somente a chave pix favor", e depois "com essa chave não tô
// conseguindo acessar". A IA respondia gerando OUTRO Pix, de novo colado no texto.
//
// O crm-ai-assistant continua montando a resposta com o código dentro (quem só lê a resposta,
// como o painel, não perde o Pix). Quem ENVIA pelo WhatsApp separa: texto numa mensagem, código
// sozinho na seguinte.

const PIX_LABEL_JUNTO = '💸 *Pix copia e cola* (toque e segure no código, copie e cole na área Pix do app do seu banco):'
const PIX_LABEL_SEPARADO =
  '💸 Seu *Pix copia e cola* vai na mensagem logo abaixo, só com o código. Toque e segure nela, copie e cole na área Pix do app do seu banco.'

/** Resposta com o código dentro, do jeito que o crm-ai-assistant devolve. */
export function juntarPixNaResposta(reply: string, codigo: string, nota?: string | null): string {
  const note = nota ? `\n${nota}` : ''
  return `${reply.trim()}\n\n${PIX_LABEL_JUNTO}\n${codigo}${note}\n\nAssim que o pagamento cair eu confirmo aqui, viu? 💚`
}

/**
 * Tira o código do texto para ele ir numa mensagem própria. `null` quando o código não está no
 * texto (quem chamou manda a resposta como veio, sem arriscar perder o Pix).
 */
export function separarPixDaResposta(reply: string, codigo: string): { texto: string; codigo: string } | null {
  const code = codigo.trim()
  if (code.length < 20 || !reply.includes(code)) return null
  const comLabel = `${PIX_LABEL_JUNTO}\n${code}`
  let texto = reply.includes(comLabel)
    ? reply.split(comLabel).join(PIX_LABEL_SEPARADO)
    : `${reply.split(code).join('').trim()}\n\n${PIX_LABEL_SEPARADO}`
  texto = texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { texto, codigo: code }
}
