import logoLorena from '@/assets/marca/lorena-logo.svg?raw'
import { agruparMatMed } from '@/components/kits/kitUi'
import { escaparHtml } from '@/lib/exportar'

// Conta do paciente a partir do kit, para imprimir ou salvar em PDF.
//
// A versão anterior só tinha a coluna "Cobrança", e nenhuma linha de kit tem cobrança lançada
// (0 de 91 em 17/09): o PDF saía com "-" em tudo e total R$ 0,00. O valor que a clínica quer ver
// é o dos materiais usados, pelo custo real da baixa; a cobrança aparece quando existe.

export type LinhaDaConta = {
  id: string
  itemId: string
  nome: string
  qty: number
  returnedQty: number
  avulso: boolean
  controlado: boolean
  /** Categoria do cadastro: separa MAT (material) de MED (medicação). */
  categoria: string | null
  consumoSetor: boolean
  cobrancaCents: number
}

/** Movimento do kit como vem do banco: saída negativa, devolução positiva, custo por unidade. */
export type MovimentoDoKit = { itemId: string; qtyDelta: number; custoCents: number | null }

export type LinhaValorada = LinhaDaConta & {
  usado: number
  /** null = item sem custo de compra conhecido. */
  unitarioCents: number | null
  totalCents: number | null
}

/**
 * Valor de cada linha: custo líquido do produto no kit (saídas menos devoluções, a custo da
 * baixa) dividido pelo que foi usado dele, e rateado entre as linhas do mesmo produto. Produto
 * com baixa sem custo usa o último custo de compra, se houver.
 */
export function valorarLinhas(
  linhas: LinhaDaConta[],
  movimentos: MovimentoDoKit[],
  ultimoCusto: Map<string, number>,
): LinhaValorada[] {
  const liquido = new Map<string, { cents: number; semCusto: boolean }>()
  for (const m of movimentos) {
    const atual = liquido.get(m.itemId) ?? { cents: 0, semCusto: false }
    if (m.custoCents == null) atual.semCusto = true
    else atual.cents += -m.qtyDelta * m.custoCents
    liquido.set(m.itemId, atual)
  }
  const usadoPorItem = new Map<string, number>()
  for (const l of linhas) usadoPorItem.set(l.itemId, (usadoPorItem.get(l.itemId) ?? 0) + Math.max(0, l.qty - l.returnedQty))

  return linhas.map((l) => {
    const usado = Math.max(0, l.qty - l.returnedQty)
    const doItem = liquido.get(l.itemId)
    const usadoItem = usadoPorItem.get(l.itemId) ?? 0
    const ultimo = ultimoCusto.get(l.itemId)
    const unitario =
      doItem && !doItem.semCusto && usadoItem > 0
        ? Math.round(doItem.cents / usadoItem)
        : ultimo && ultimo > 0
          ? ultimo
          : null
    return { ...l, usado, unitarioCents: unitario, totalCents: unitario == null ? null : Math.round(unitario * usado) }
  })
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const dataBrDe = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR') : null)
const logoSemCabecalho = () => logoLorena.replace(/<\?xml[^>]*>|<!--[\s\S]*?-->/g, '')

// Papel da clínica: grafite #252A33 e areia #DCDBD1, A4, cabeçalho repetido nas páginas.
const ESTILO_BASE = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  html { color-scheme: light; background: #fff; }
  html, body { margin: 0; }
  @media screen { body { max-width: 794px; margin: 24px auto; padding: 0 28px; } }
  body { background: #fff; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #252A33; font-size: 10.5px; line-height: 1.35;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .topo { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 2px solid #252A33; }
  .logo svg { height: 46px; width: auto; display: block; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 19px; letter-spacing: .01em; }
  .doc p { margin: 3px 0 0; color: #6b6f76; font-size: 9.5px; }
  .info { display: grid; grid-template-columns: 1.5fr 1.2fr .8fr 1.2fr; margin: 14px 0 10px; border: 1px solid #DCDBD1; border-radius: 8px; overflow: hidden; }
  .info div { padding: 8px 10px; border-right: 1px solid #DCDBD1; }
  .info div:last-child { border-right: 0; }
  .info span { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: .09em; color: #8a8d93; margin-bottom: 2px; }
  .info strong { font-size: 11.5px; }
  .info.em-branco div { padding-bottom: 16px; }
  .aviso { margin: 0 0 10px; padding: 7px 10px; border-radius: 6px; background: #f6efd9; color: #6b5412; font-size: 9.5px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { background: #252A33; color: #fff; font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; padding: 6px 8px; text-align: left; }
  td { padding: 6px 8px; border-bottom: 1px solid #ecebe5; vertical-align: top; }
  tr { page-break-inside: avoid; }
  tr.grupo td { background: #DCDBD1; font-weight: 700; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; padding: 5px 8px; }
  tr.grupo .sigla { display: inline-block; min-width: 30px; margin-right: 6px; padding: 0 5px; border-radius: 4px; background: #252A33; color: #fff; text-align: center; }
  tr.grupo.med .sigla { background: #8a5a00; }
  tr.grupo .soma { float: right; letter-spacing: 0; text-transform: none; }
  .i { color: #a3a6ab; width: 22px; font-variant-numeric: tabular-nums; }
  .n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  th.n { text-align: right; }
  .forte { font-weight: 600; }
  .nome { font-weight: 500; }
  .sub { color: #8a8d93; font-size: 8.5px; margin-top: 1px; }
  .tag { display: inline-block; margin-left: 5px; padding: 0 5px; border-radius: 8px; background: #ecebe5; color: #252A33; font-size: 7.5px; text-transform: uppercase; letter-spacing: .05em; vertical-align: 1px; }
  .tag.ctl { background: #f6efd9; color: #6b5412; }
  .assinaturas { display: flex; gap: 32px; margin-top: 46px; page-break-inside: avoid; }
  .assinaturas div { flex: 1; border-top: 1px solid #252A33; padding-top: 5px; text-align: center; color: #6b6f76; font-size: 9px; }
  .rodape { margin-top: 22px; padding-top: 8px; border-top: 1px solid #DCDBD1; display: flex; justify-content: space-between; color: #8a8d93; font-size: 8.5px; }
`

function cabecalho(
  titulo: string,
  subtitulo: string,
  dados: { paciente: string | null; procedimento: string | null; data: string | null; kitNome: string },
  emBranco = false,
) {
  // Folha do modelo: sem kit montado ainda, paciente/procedimento/data ficam para escrever à mão.
  const campo = (valor: string) => (emBranco ? '&nbsp;' : escaparHtml(valor))
  return `
  <header class="topo">
    <div class="logo" aria-label="Instituto Lorena Visentainer">${logoSemCabecalho()}</div>
    <div class="doc"><h1>${escaparHtml(titulo)}</h1><p>${escaparHtml(subtitulo)}</p></div>
  </header>
  <section class="info${emBranco ? ' em-branco' : ''}">
    <div><span>Paciente</span><strong>${campo(dados.paciente || 'Não informado')}</strong></div>
    <div><span>Procedimento</span><strong>${campo(dados.procedimento || '-')}</strong></div>
    <div><span>Data</span><strong>${emBranco ? '&nbsp;' : (dataBrDe(dados.data) ?? '-')}</strong></div>
    <div><span>Kit</span><strong>${escaparHtml(dados.kitNome)}</strong></div>
  </section>`
}

function rodape(emitido: Date) {
  return `<footer class="rodape">
    <span>Instituto Lorena Visentainer · (44) 99149-3656</span>
    <span>Emitido em ${emitido.toLocaleDateString('pt-BR')} às ${emitido.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
  </footer>`
}

const marcasDaLinha = (l: { avulso: boolean; controlado: boolean; consumoSetor?: boolean }) =>
  [
    l.avulso ? '<span class="tag">avulso</span>' : '',
    l.consumoSetor ? '<span class="tag">consumo do setor</span>' : '',
    l.controlado ? '<span class="tag ctl">controlado</span>' : '',
  ].join('')

export function htmlContaDoKit(dados: {
  paciente: string | null
  procedimento: string | null
  /** yyyy-mm-dd */
  data: string | null
  kitNome: string
  status: 'montado' | 'consumido' | 'cancelado'
  linhas: LinhaValorada[]
  emitidoEm?: Date
}): { titulo: string; html: string } {
  const emitido = dados.emitidoEm ?? new Date()
  const dataBr = dataBrDe(dados.data)
  const titulo = ['Conta', dados.paciente ?? 'paciente', dados.kitNome, dataBr?.replace(/\//g, '-')].filter(Boolean).join(' - ')

  const naConta = dados.linhas.filter((l) => l.usado > 0 || l.cobrancaCents > 0)
  const voltaramInteiros = dados.linhas.length - naConta.length
  const temCobranca = naConta.some((l) => l.cobrancaCents > 0)
  const materiais = naConta.reduce((s, l) => s + (l.totalCents ?? 0), 0)
  const semCusto = naConta.filter((l) => l.usado > 0 && l.totalCents == null).length
  const cobrado = naConta.reduce((s, l) => s + Math.max(0, l.cobrancaCents), 0)
  const unidades = naConta.reduce((s, l) => s + l.usado, 0)
  const colunas = temCobranca ? 6 : 5

  let n = 0
  const linhasHtml = agruparMatMed(naConta, (l) => l.nome, (l) => l.categoria)
    .map((g) => {
      const soma = g.linhas.reduce((s, l) => s + (l.totalCents ?? 0), 0)
      const cabeca = `<tr class="grupo ${g.grupo.toLowerCase()}"><td colspan="${colunas}"><span class="sigla">${g.grupo}</span>${g.rotulo} · ${g.linhas.length} ${g.linhas.length === 1 ? 'item' : 'itens'}<span class="soma">${brl(soma)}</span></td></tr>`
      const itens = g.linhas
        .map((l) => {
          n += 1
          const detalhe = l.returnedQty > 0 ? `<div class="sub">saíram ${qtd(l.qty)}, voltaram ${qtd(l.returnedQty)}</div>` : ''
          return `<tr>
            <td class="i">${n}</td>
            <td><div class="nome">${escaparHtml(l.nome)}${marcasDaLinha(l)}</div>${detalhe}</td>
            <td class="n">${qtd(l.usado)}</td>
            <td class="n">${l.unitarioCents == null ? '<span class="sc">sem custo*</span>' : brl(l.unitarioCents)}</td>
            <td class="n forte">${l.totalCents == null ? '-' : brl(l.totalCents)}</td>
            ${temCobranca ? `<td class="n">${l.cobrancaCents > 0 ? brl(l.cobrancaCents) : '-'}</td>` : ''}
          </tr>`
        })
        .join('')
      return cabeca + itens
    })
    .join('')

  const aviso =
    dados.status === 'montado'
      ? '<div class="aviso">Prévia: o uso deste kit ainda não foi registrado. A conta mostra tudo que saiu na montagem.</div>'
      : dados.status === 'cancelado'
        ? '<div class="aviso">Kit cancelado: o material voltou ao estoque.</div>'
        : ''

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escaparHtml(titulo)}</title>
<style>${ESTILO_BASE}
  .sc { color: #a3a6ab; font-size: 9px; }
  .resumo { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 14px; page-break-inside: avoid; }
  .notas { color: #8a8d93; font-size: 9px; max-width: 55%; }
  .notas p { margin: 0 0 3px; }
  .totais { min-width: 250px; }
  .totais div { display: flex; justify-content: space-between; gap: 16px; padding: 5px 0; border-bottom: 1px solid #ecebe5; }
  .totais .grande { padding-top: 8px; border-bottom: 2px solid #252A33; font-size: 14px; font-weight: 700; }
</style></head><body>
  ${cabecalho('Conta do paciente', 'Materiais e medicações do procedimento', dados)}
  ${aviso}
  <table>
    <thead><tr>
      <th>#</th><th>Item</th><th class="n">Qtd usada</th><th class="n">Valor unit.</th><th class="n">Valor</th>${temCobranca ? '<th class="n">Cobrança</th>' : ''}
    </tr></thead>
    <tbody>${linhasHtml || `<tr><td colspan="${colunas}" style="text-align:center;color:#8a8d93;padding:18px">Nenhum item usado neste kit.</td></tr>`}</tbody>
  </table>

  <section class="resumo">
    <div class="notas">
      <p>${naConta.length} ${naConta.length === 1 ? 'item' : 'itens'} · ${qtd(unidades)} ${unidades === 1 ? 'unidade usada' : 'unidades usadas'}</p>
      ${voltaramInteiros > 0 ? `<p>${voltaramInteiros} ${voltaramInteiros === 1 ? 'item voltou inteiro' : 'itens voltaram inteiros'} ao estoque e não ${voltaramInteiros === 1 ? 'entra' : 'entram'} na conta.</p>` : ''}
      ${semCusto > 0 ? `<p>* ${semCusto} ${semCusto === 1 ? 'item sem custo de compra cadastrado' : 'itens sem custo de compra cadastrado'}: o valor dos materiais fica parcial.</p>` : ''}
    </div>
    <div class="totais">
      <div class="${temCobranca ? '' : 'grande'}"><span>Valor total${semCusto > 0 ? '*' : ''}</span><span>${brl(materiais)}</span></div>
      ${temCobranca ? `<div class="grande"><span>Cobrado do paciente</span><span>${brl(cobrado)}</span></div>` : ''}
    </div>
  </section>

  <section class="assinaturas">
    <div>Responsável pelo kit</div>
    <div>Conferido por</div>
  </section>
  ${rodape(emitido)}
</body></html>`
  return { titulo, html }
}

/**
 * Folha para ticar durante a cirurgia: cada item do kit com a caixinha, quanto saiu e espaço em
 * branco para usado e voltou, em MAT/MED. Embaixo o consumo do setor em branco. Depois é só passar
 * para o "Registrar uso".
 */
export function htmlFolhaDoKit(dados: {
  paciente: string | null
  procedimento: string | null
  data: string | null
  kitNome: string
  linhas: Array<{ nome: string; qty: number; categoria: string | null; controlado: boolean; avulso: boolean; consumoSetor: boolean }>
  consumo: Array<{ rotulo: string; unidade: string }>
  /** Folha tirada do modelo, sem paciente: cabeçalho em branco para preencher à mão. */
  emBranco?: boolean
  emitidoEm?: Date
}): { titulo: string; html: string } {
  const emitido = dados.emitidoEm ?? new Date()
  const dataBr = dataBrDe(dados.data)
  const titulo = dados.emBranco
    ? `Folha do kit - ${dados.kitNome}`
    : ['Folha do kit', dados.paciente ?? 'paciente', dados.kitNome, dataBr?.replace(/\//g, '-')].filter(Boolean).join(' - ')

  let n = 0
  const linhasHtml = agruparMatMed(dados.linhas, (l) => l.nome, (l) => l.categoria)
    .map((g) => {
      const cabeca = `<tr class="grupo ${g.grupo.toLowerCase()}"><td colspan="6"><span class="sigla">${g.grupo}</span>${g.rotulo} · ${g.linhas.length} ${g.linhas.length === 1 ? 'item' : 'itens'}</td></tr>`
      const itens = g.linhas
        .map((l) => {
          n += 1
          return `<tr>
            <td class="caixa"><span></span></td>
            <td class="i">${n}</td>
            <td><div class="nome">${escaparHtml(l.nome)}${marcasDaLinha(l)}</div></td>
            <td class="n forte">${qtd(l.qty)}</td>
            <td class="branco"></td>
            <td class="branco"></td>
          </tr>`
        })
        .join('')
      return cabeca + itens
    })
    .join('')

  const consumoHtml = dados.consumo.length
    ? `<h2>Consumo do setor</h2>
      <table class="consumo">
        <thead><tr><th class="caixa-th"></th><th>Item</th><th class="n">Unidade</th><th>Quantidade</th></tr></thead>
        <tbody>${dados.consumo
          .map((c) => `<tr><td class="caixa"><span></span></td><td class="nome">${escaparHtml(c.rotulo)}</td><td class="n">${escaparHtml(c.unidade)}</td><td class="branco"></td></tr>`)
          .join('')}</tbody>
      </table>`
    : ''

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${escaparHtml(titulo)}</title>
<style>${ESTILO_BASE}
  td { padding: 7px 8px; vertical-align: middle; }
  .caixa { width: 26px; padding-right: 0; }
  .caixa span { display: block; width: 13px; height: 13px; border: 1.4px solid #252A33; border-radius: 3px; }
  .caixa-th { width: 26px; }
  th.branco-th { width: 80px; text-align: center; }
  .branco { width: 80px; border-left: 1px solid #ecebe5; }
  td.branco { background: #fff; }
  h2 { margin: 20px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
  .consumo .branco { width: 160px; }
  .instrucao { margin: 0 0 10px; color: #6b6f76; font-size: 9.5px; }
  .obs { margin-top: 16px; border: 1px solid #DCDBD1; border-radius: 8px; padding: 8px 10px; height: 70px; color: #8a8d93; font-size: 9px; page-break-inside: avoid; }
</style></head><body>
  ${cabecalho('Folha do kit', dados.emBranco ? 'Montagem e conferência da bandeja' : 'Marque durante o procedimento', dados, dados.emBranco)}
  <p class="instrucao">Ticar o que foi aberto. Anotar quanto foi usado e quanto voltou; depois lançar em "Registrar uso" no CRM.</p>
  <table>
    <thead><tr><th class="caixa-th"></th><th>#</th><th>Item</th><th class="n">Saiu</th><th class="branco-th">Usado</th><th class="branco-th">Voltou</th></tr></thead>
    <tbody>${linhasHtml || '<tr><td colspan="6" style="text-align:center;color:#8a8d93;padding:18px">Kit sem itens.</td></tr>'}</tbody>
  </table>
  ${consumoHtml}
  <div class="obs">Observações</div>
  <section class="assinaturas">
    <div>Circulante</div>
    <div>Instrumentação</div>
    <div>Conferido por</div>
  </section>
  ${rodape(emitido)}
</body></html>`
  return { titulo, html }
}
