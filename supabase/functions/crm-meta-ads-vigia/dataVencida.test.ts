const MESES: Record<string, number> = {jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12}
function dataVencida(texto: string, hoje: Date): string | null {
  const t = (texto ?? '').toLowerCase()
  const re = /\b(0?[1-9]|[12]\d|3[01])\s*(?:\/|\s+de\s+)\s*(0?[1-9]|1[0-2]|jan\w*|fev\w*|mar\w*|abr\w*|mai\w*|jun\w*|jul\w*|ago\w*|set\w*|out\w*|nov\w*|dez\w*)\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    const dia = Number(m[1]); const bruto = m[2]
    const mes = /^\d+$/.test(bruto) ? Number(bruto) : MESES[bruto.slice(0,3)]
    if (!mes || mes < 1 || mes > 12) continue
    const quando = new Date(Date.UTC(hoje.getUTCFullYear(), mes-1, dia))
    const limite = new Date(hoje.getTime() - 3*86400000)
    if (quando < limite) return `${dia}/${String(mes).padStart(2,'0')}`
  }
  return null
}
const hoje = new Date(Date.UTC(2026,7,25))
const casos: Array<[string,string,string|null]> = [
  ['o caso real, texto do anuncio Jaque',
   'Londrina | Atenção à saúde do seu cabelo. Percebeu queda? No dia 7 de agosto, a Dra estará na cidade', '7/08'],
  ['o caso real, nome do anuncio', '03 - [REEL] - Jaque 07/08', '7/08'],
  ['LORENA 07 DE AGOSTO', '02 - [VID] LORENA - 07 DE AGOSTO', '7/08'],
  ['data futura, campanha legitima', 'Consulta presencial em Maringá no dia 20 de setembro', null],
  ['ontem, dentro da tolerancia de 3 dias', 'evento em 24 de agosto', null],
  ['sem data nenhuma', 'Antes e depois de transplante capilar, cada caso tem uma história', null],
  ['CRM e RQE nao sao data', 'DRA. LORENA VISENTAINER (CRM 33717 | RQE 29798)', null],
  ['mes escrito por extenso', 'atendimento dia 3 de julho, vagas limitadas', '3/07'],
]
let ok=0, falhou=0
for (const [nome, txt, esperado] of casos) {
  const r = dataVencida(txt, hoje)
  const passou = r === esperado
  passou ? ok++ : falhou++
  console.log(`  ${passou ? 'OK  ' : 'FALHOU'} ${nome}\n        esperado=${esperado}  obtido=${r}`)
}
console.log(`\n  ${ok} passaram, ${falhou} falharam`)
