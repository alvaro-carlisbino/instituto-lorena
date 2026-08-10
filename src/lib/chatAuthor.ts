/**
 * Nome de quem enviou a mensagem, do jeito que a equipe fala.
 *
 * O `author` da interação é gravado pelo edge `crm-send-message` com o e-mail de quem
 * estava logado — então a bolha do chat mostrava `gerencia@lorenavisentainer.com.br`.
 * Aqui trocamos pelo nome do usuário no CRM. Quando o e-mail é uma CAIXA COMPARTILHADA
 * (gerencia@, atendimento@, financeiro@), avisamos que é conta de equipe: quem digitou
 * pode ser qualquer pessoa do time, e o CRM não tem como saber quem foi.
 */
import type { AppUser } from '@/mocks/crmMock'

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Caixas usadas por mais de uma pessoa — o nome delas não identifica quem atendeu. */
const CAIXAS_COMPARTILHADAS = ['gerencia', 'atendimento', 'financeiro', 'contato', 'comercial']

export const isSharedMailbox = (author: string): boolean => {
  const local = (author ?? '').split('@')[0]?.toLowerCase().trim() ?? ''
  return EMAIL_RX.test(author ?? '') && CAIXAS_COMPARTILHADAS.includes(local)
}

export type AuthorLabel = {
  /** O que aparece na bolha. */
  nome: string
  /** Conta de equipe: não dá pra afirmar quem digitou. */
  compartilhada: boolean
  /** Texto do `title` — mostra o e-mail cru pra quem precisa auditar. */
  detalhe: string
}

export function resolveAuthorLabel(author: string, users: AppUser[]): AuthorLabel {
  const raw = (author ?? '').trim()
  if (!raw) return { nome: 'Equipe', compartilhada: false, detalhe: '' }
  if (!EMAIL_RX.test(raw)) return { nome: raw, compartilhada: false, detalhe: '' }

  const user = users.find((u) => u.email.toLowerCase() === raw.toLowerCase())
  const compartilhada = isSharedMailbox(raw)
  // Nome cadastrado igual ao e-mail (acontece quando o usuário é criado sem nome) não
  // ajuda ninguém: cai pro local-part capitalizado.
  const nomeDoUser = user && user.name && !EMAIL_RX.test(user.name) ? user.name : ''
  const local = raw.split('@')[0] ?? raw
  const nome = nomeDoUser || local.charAt(0).toUpperCase() + local.slice(1)

  return {
    nome,
    compartilhada,
    detalhe: compartilhada
      ? `${raw} — conta compartilhada da equipe: o CRM não registra qual atendente digitou.`
      : raw,
  }
}
