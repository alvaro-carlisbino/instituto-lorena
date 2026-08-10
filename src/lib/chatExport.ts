/**
 * Exportação do histórico de conversa de um lead (PDF e CSV).
 *
 * O PDF sai pelo próprio navegador: montamos um HTML de impressão numa aba nova e
 * chamamos `print()`. Sem biblioteca de PDF no bundle (jsPDF + html2canvas custam
 * ~600KB e renderizam emoji como quadradinho), e o resultado é texto selecionável.
 * O paciente escolhe "Salvar como PDF" no diálogo do sistema.
 */
import { resolveAuthorLabel } from '@/lib/chatAuthor'
import { downloadCsv } from '@/lib/csvExport'
import type { AppUser, Interaction, Lead } from '@/mocks/crmMock'

const DIAS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
]

const cf = (lead: Lead, grupo: string, campo: string): string => {
  const g = (lead.customFields ?? {})[grupo]
  if (!g || typeof g !== 'object') return ''
  const v = (g as Record<string, unknown>)[campo]
  return v == null ? '' : String(v)
}

/** Nome mais completo que temos: o do cadastro ganha do push name do WhatsApp. */
export const nomeParaExport = (lead: Lead): string =>
  cf(lead, 'cadastro', 'nomeCompleto') || lead.patientName || 'Sem nome'

const enderecoLinha = (lead: Lead): string => {
  const p = [
    [cf(lead, 'entrega', 'logradouro'), cf(lead, 'entrega', 'numero')].filter(Boolean).join(', '),
    cf(lead, 'entrega', 'complemento'),
    cf(lead, 'entrega', 'bairro'),
    [cf(lead, 'entrega', 'cidade'), cf(lead, 'entrega', 'uf')].filter(Boolean).join('/'),
    cf(lead, 'entrega', 'cep') ? `CEP ${cf(lead, 'entrega', 'cep')}` : '',
  ]
  return p.filter(Boolean).join(' — ')
}

const dtBR = (iso: string): Date => new Date(iso)
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dmy = (d: Date) => d.toLocaleDateString('pt-BR')

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** `*negrito*` do WhatsApp vira <b>; o resto é escapado. */
const formatarTexto = (raw: string): string => {
  let out = ''
  let aberto = false
  for (const ch of raw) {
    if (ch === '*') {
      out += aberto ? '</b>' : '<b>'
      aberto = !aberto
    } else {
      out += escapeHtml(ch)
    }
  }
  if (aberto) out += '</b>'
  return out.replace(/\n/g, '<br>')
}

/** Quem falou: paciente, IA (Sofia) ou equipe humana. Muda a cor da bolha. */
const papel = (
  msg: Interaction,
  nomePaciente: string,
  users: AppUser[],
): { cls: string; autor: string } => {
  if (msg.direction === 'system') return { cls: 'sys', autor: 'Sistema' }
  if (msg.direction === 'in') return { cls: 'in', autor: nomePaciente }
  const ia = /assistente ia|sofia|\(ia\)/i.test(msg.author)
  if (ia) return { cls: 'ia', autor: 'Sofia (IA)' }
  // E-mail cru ("gerencia@…") não serve num documento que sai da clínica: vira o nome
  // do usuário, com "(equipe)" quando a conta é compartilhada e não identifica a pessoa.
  const label = resolveAuthorLabel(msg.author, users)
  return { cls: 'eq', autor: label.compartilhada ? `${label.nome} (equipe)` : label.nome }
}

const descreveMidia = (msg: Interaction): string => {
  if (!msg.media?.length) return ''
  const rotulos: Record<string, string> = {
    audio: 'áudio',
    image: 'imagem',
    video: 'vídeo',
    document: 'documento',
    other: 'anexo',
  }
  return msg.media.map((m) => `[${rotulos[m.type] ?? 'anexo'}${m.caption ? `: ${m.caption}` : ''}]`).join(' ')
}

const CSS = `
@page { size: A4; margin: 14mm 12mm 16mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
       font-size: 10.5px; color: #1c1917; margin: 0;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -.2px; }
.sub { color: #78716c; font-size: 10px; margin-bottom: 12px; }
.capa { border-bottom: 2px solid #1c1917; padding-bottom: 10px; margin-bottom: 14px; }
.ficha { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 22px; margin-bottom: 16px;
         background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px; padding: 10px 12px; }
.ficha div { font-size: 10px; }
.ficha b { color: #78716c; font-weight: 600; display: inline-block; min-width: 92px; }
.wide { grid-column: 1 / -1; }
.dia { text-align: center; margin: 14px 0 9px; }
.dia span { background: #e7e5e4; color: #57534e; font-size: 9px; font-weight: 700;
            padding: 3px 10px; border-radius: 20px; text-transform: uppercase; letter-spacing: .4px; }
.linha { display: flex; margin-bottom: 7px; page-break-inside: avoid; }
.linha.in { justify-content: flex-start; }
.linha.eq, .linha.ia { justify-content: flex-end; }
.bolha { max-width: 76%; border-radius: 10px; padding: 7px 10px 5px; border: 1px solid; }
.in .bolha { background: #fff; border-color: #e7e5e4; border-bottom-left-radius: 2px; }
.eq .bolha { background: #dcf8c6; border-color: #c5e8ac; border-bottom-right-radius: 2px; }
.ia .bolha { background: #eef2ff; border-color: #d5dcfb; border-bottom-right-radius: 2px; }
.autor { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px;
         color: #78716c; margin-bottom: 2px; }
.txt { line-height: 1.45; word-wrap: break-word; overflow-wrap: anywhere; }
.midia { font-size: 9px; color: #57534e; font-style: italic; margin-top: 3px; }
.hora { font-size: 8px; color: #a8a29e; text-align: right; margin-top: 2px; }
.sys { text-align: center; font-size: 8.5px; color: #a8a29e; font-style: italic;
       margin: 7px 0; page-break-inside: avoid; }
.rodape { margin-top: 18px; border-top: 1px solid #e7e5e4; padding-top: 7px;
          font-size: 8.5px; color: #a8a29e; text-align: center; }
@media print { .aviso { display: none !important; } }
.aviso { position: fixed; top: 0; left: 0; right: 0; background: #1c1917; color: #fff;
         font-size: 12px; padding: 8px 12px; text-align: center; z-index: 9; }
`

export function buildChatExportHtml(
  lead: Lead,
  messages: Interaction[],
  opts?: { clinica?: string; users?: AppUser[] },
): string {
  const users = opts?.users ?? []
  const nome = nomeParaExport(lead)
  const ordenadas = [...messages].sort(
    (a, b) => dtBR(a.happenedAt).getTime() - dtBR(b.happenedAt).getTime(),
  )
  const recebidas = ordenadas.filter((m) => m.direction === 'in').length
  const enviadas = ordenadas.filter((m) => m.direction === 'out').length

  let diaAtual = ''
  const linhas: string[] = []
  for (const msg of ordenadas) {
    const d = dtBR(msg.happenedAt)
    const chave = d.toDateString()
    if (chave !== diaAtual) {
      diaAtual = chave
      linhas.push(`<div class="dia"><span>${DIAS[d.getDay()]}, ${dmy(d)}</span></div>`)
    }
    const { cls, autor } = papel(msg, nome, users)
    if (cls === 'sys') {
      linhas.push(`<div class="sys">${escapeHtml(msg.content)}</div>`)
      continue
    }
    const midia = descreveMidia(msg)
    linhas.push(
      `<div class="linha ${cls}"><div class="bolha">` +
        `<div class="autor">${escapeHtml(autor)}</div>` +
        `<div class="txt">${formatarTexto(msg.content ?? '')}</div>` +
        (midia ? `<div class="midia">${escapeHtml(midia)}</div>` : '') +
        `<div class="hora">${hhmm(d)}</div>` +
        `</div></div>`,
    )
  }

  const periodo = ordenadas.length
    ? `${dmy(dtBR(ordenadas[0]!.happenedAt))} ${hhmm(dtBR(ordenadas[0]!.happenedAt))} a ` +
      `${dmy(dtBR(ordenadas[ordenadas.length - 1]!.happenedAt))} ${hhmm(dtBR(ordenadas[ordenadas.length - 1]!.happenedAt))}`
    : '—'

  const campo = (rotulo: string, valor: string, wide = false) =>
    valor ? `<div${wide ? ' class="wide"' : ''}><b>${rotulo}</b> ${escapeHtml(valor)}</div>` : ''

  const clinica = opts?.clinica ?? 'Instituto Lorena Visentainer'
  const agora = new Date()

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Histórico de conversa — ${escapeHtml(nome)}</title>
<style>${CSS}</style></head><body>
<div class="aviso">Use “Salvar como PDF” no destino da impressão. Esta faixa não sai no arquivo.</div>
<div class="capa">
  <h1>Histórico de conversa — WhatsApp</h1>
  <div class="sub">${escapeHtml(clinica)} · exportado em ${dmy(agora)} às ${hhmm(agora)}</div>
</div>
<div class="ficha">
  ${campo('Paciente', nome)}
  ${campo('Telefone', lead.phone || '')}
  ${campo('CPF', cf(lead, 'cadastro', 'cpf'))}
  ${campo('Nascimento', cf(lead, 'cadastro', 'dataNascimento'))}
  ${campo('E-mail', cf(lead, 'cadastro', 'email'))}
  ${campo('Origem', lead.source || '')}
  ${campo('Endereço', enderecoLinha(lead), true)}
  <div class="wide"><b>Período</b> ${periodo} &nbsp;·&nbsp; ${ordenadas.length} mensagens (${recebidas} recebidas, ${enviadas} enviadas)</div>
  ${campo('ID no CRM', lead.id, true)}
</div>
${linhas.join('')}
<div class="rodape">Documento gerado pelo CRM do ${escapeHtml(clinica)} · uso interno · contém dados pessoais (LGPD)</div>
</body></html>`
}

/**
 * Abre o histórico numa aba nova e dispara o diálogo de impressão (→ Salvar como PDF).
 * Retorna false quando o navegador bloqueia o pop-up, para a tela avisar.
 */
export function exportChatToPdf(
  lead: Lead,
  messages: Interaction[],
  opts?: { clinica?: string; users?: AppUser[] },
): boolean {
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(buildChatExportHtml(lead, messages, opts))
  win.document.close()
  // `print()` antes das fontes carregarem sai com a página em branco no Safari.
  win.onload = () => {
    win.focus()
    setTimeout(() => win.print(), 250)
  }
  return true
}

const nomeArquivo = (lead: Lead, ext: string): string => {
  const base = nomeParaExport(lead)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  const hoje = new Date().toISOString().slice(0, 10)
  return `conversa-${base || 'lead'}-${hoje}.${ext}`
}

/** CSV (Excel pt-BR) com uma linha por mensagem — para auditoria/planilha. */
export function exportChatToCsv(lead: Lead, messages: Interaction[], users: AppUser[] = []): void {
  const nome = nomeParaExport(lead)
  const ordenadas = [...messages].sort(
    (a, b) => dtBR(a.happenedAt).getTime() - dtBR(b.happenedAt).getTime(),
  )
  const rows: string[][] = [['Data', 'Hora', 'Quem', 'Autor', 'Canal', 'Mensagem', 'Anexos']]
  for (const msg of ordenadas) {
    const d = dtBR(msg.happenedAt)
    const { cls, autor } = papel(msg, nome, users)
    const quem = cls === 'in' ? 'Paciente' : cls === 'ia' ? 'IA' : cls === 'eq' ? 'Equipe' : 'Sistema'
    rows.push([dmy(d), hhmm(d), quem, autor, msg.channel, msg.content ?? '', descreveMidia(msg)])
  }
  downloadCsv(nomeArquivo(lead, 'csv'), rows)
}

/** Texto puro no formato do "exportar conversa" do WhatsApp — cola em qualquer lugar. */
export function exportChatToTxt(lead: Lead, messages: Interaction[], users: AppUser[] = []): void {
  const nome = nomeParaExport(lead)
  const ordenadas = [...messages].sort(
    (a, b) => dtBR(a.happenedAt).getTime() - dtBR(b.happenedAt).getTime(),
  )
  const linhas = ordenadas.map((msg) => {
    const d = dtBR(msg.happenedAt)
    const { autor } = papel(msg, nome, users)
    const midia = descreveMidia(msg)
    const corpo = [msg.content ?? '', midia].filter(Boolean).join(' ')
    return `[${dmy(d)} ${hhmm(d)}] ${autor}: ${corpo}`
  })
  const cabecalho = [
    `Histórico de conversa — ${nome}`,
    lead.phone ? `Telefone: ${lead.phone}` : '',
    `Exportado em ${dmy(new Date())} às ${hhmm(new Date())} · ${ordenadas.length} mensagens`,
    '',
  ].filter(Boolean)
  const blob = new Blob(['﻿' + [...cabecalho, ...linhas].join('\r\n')], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo(lead, 'txt')
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
