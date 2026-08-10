// Helpers de leitura de PLANILHA (xlsx/csv). Nasceram dentro de gastosControle.ts;
// viraram lib quando a conciliação Shosp × banco passou a precisar dos mesmos parsers.
// Uma cópia só — o tratamento de data de Excel abaixo tem uma pegadinha que não pode divergir.

/**
 * NÃO trocar por `diaLocal` daqui.
 *
 * Isto normaliza valor vindo de PLANILHA, e o serial do Excel converte para meia-noite
 * UTC (`(value - 25569) * 86400 * 1000`). Uma data sem hora já em meia-noite UTC fatiada
 * como UTC dá o dia certo; convertida para America/Sao_Paulo daria o dia ANTERIOR, porque
 * meia-noite UTC é 21h do dia anterior em Brasília. Aqui UTC é o correto.
 */
export function toISODate(value: unknown): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date
    const utc = Math.round((value - 25569) * 86400 * 1000)
    const d = new Date(utc)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  }
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (br) {
    const dd = br[1].padStart(2, '0')
    const mm = br[2].padStart(2, '0')
    return `${br[3]}-${mm}-${dd}`
  }
  const d = new Date(s)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

export function toCents(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100)
  const s = String(value).trim().replace(/R\$\s?/i, '').replace(/\s/g, '')
  if (!s) return null
  // "1.200" é mil e duzentos, não um e vinte: ponto separando grupos de 3 sem decimal
  // é separador de milhar. Sem essa guarda, R$ 1.200 virava R$ 1,20.
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Math.round(Number(s.replace(/\./g, '')) * 100)
  // 1.234,56 ou 1234.56
  const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s
  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/** Tira acento, caixa e espaço dobrado — para comparar cabeçalho com apelido. */
export function normHeader(h: unknown): string {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Acha a coluna pelo primeiro apelido que casar (igual ou contido). -1 se não achar.
 *
 * Apelido curto só casa IGUAL. Com `includes` solto, apelido de 2 ou 3 letras pega palavra
 * do meio de outro cabeçalho: 'id' casava com "Unidade" ("un-ID-ade") e roubava a coluna do
 * documento no export do Shosp. O piso de 4 letras corta esse tipo de falso positivo sem
 * mexer na ordem dos apelidos, que é o que decide a prioridade.
 */
export function pickCol(headers: string[], ...aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.findIndex((h) => (a.length >= 4 ? h === a || h.includes(a) : h === a))
    if (i >= 0) return i
  }
  return -1
}

/** Diferença absoluta em dias entre duas datas 'yyyy-mm-dd'. */
export function difDias(a: string, b: string): number {
  return Math.abs(Math.round((new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86400000))
}

/** Dias de `a` até `b` COM sinal: positivo quando b é depois de a. */
export function difDiasComSinal(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000)
}
