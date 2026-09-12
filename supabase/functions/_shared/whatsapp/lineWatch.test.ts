// Vigia de linha muda. Rode com:
//   deno test --allow-env supabase/functions/_shared/whatsapp/lineWatch.test.ts
//
// Os casos vêm das duas quedas reais (11/09 e 03/09) e dos dois falsos positivos que o
// primeiro ensaio em produção mostrou (a madrugada somada de manhã e o buraco normal da
// linha de vendas no meio do dia). Se um destes quebrar, alguém trocou a pergunta do
// vigia — e a pergunta é a única coisa que ele tem: "por que ninguém escreve para uma
// linha que está mandando mensagem?".
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { avaliarLinha, precisaSondar, type SinalDaLinha } from './lineWatch.ts'

const base: SinalDaLinha = {
  minutosSemEntrada: 5,
  minutosDeSilencioNaJanela: 5,
  saidasNoSilencio: 1,
  dentroDaJanela: true,
  sonda: null,
  avisadoHaMinutos: null,
  marcadaMuda: false,
}

const sondaViva = { respondeu: true, connected: true, detalhe: 'http_200 {"connected":true}' }
const sondaMorta = { respondeu: false, connected: null, detalhe: 'Request timed out' }

Deno.test('linha recebendo não vira alarme', () => {
  assertEquals(avaliarLinha(base), { acao: 'ok', motivo: 'recebendo' })
})

Deno.test('fora da janela ninguém escreve mesmo', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 300, minutosDeSilencioNaJanela: 300, dentroDaJanela: false })
  assertEquals(v, { acao: 'ok', motivo: 'fora_da_janela' })
})

Deno.test('linha recém-pareada, sem histórico, não tem base de comparação', () => {
  assertEquals(avaliarLinha({ ...base, minutosSemEntrada: null }), { acao: 'ok', motivo: 'sem_historico' })
})

Deno.test('a madrugada não conta: às 8h30 a régua é a janela, não o relógio', () => {
  // Caso real de 12/09: última entrada 20:21 de ontem (780 min), janela aberta há 30.
  const v = avaliarLinha({ ...base, minutosSemEntrada: 780, minutosDeSilencioNaJanela: 25 })
  assertEquals(v, { acao: 'ok', motivo: 'recebendo' })
})

Deno.test('silêncio de meia hora na janela manda sondar antes de acusar', () => {
  assertEquals(avaliarLinha({ ...base, minutosSemEntrada: 35, minutosDeSilencioNaJanela: 35 }), { acao: 'sondar' })
  assertEquals(precisaSondar({ minutosDeSilencioNaJanela: 35, dentroDaJanela: true }), true)
  assertEquals(precisaSondar({ minutosDeSilencioNaJanela: 35, dentroDaJanela: false }), false)
  assertEquals(precisaSondar({ minutosDeSilencioNaJanela: 5, dentroDaJanela: true }), false)
})

Deno.test('11/09: sonda sem resposta é instância travada, e meia hora basta', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 32, minutosDeSilencioNaJanela: 32, saidasNoSilencio: 2, sonda: sondaMorta })
  assertEquals(v.acao, 'alertar')
  assertEquals(v.acao === 'alertar' && v.tipo, 'travada')
})

Deno.test('instância travada alerta mesmo sem nenhuma saída no período', () => {
  // A sonda é prova direta: não depende de o CRM ter tentado mandar alguma coisa.
  const v = avaliarLinha({ ...base, minutosSemEntrada: 45, minutosDeSilencioNaJanela: 45, saidasNoSilencio: 0, sonda: sondaMorta })
  assertEquals(v.acao, 'alertar')
})

Deno.test('connected=false conta como travada, não como gancho morto', () => {
  const v = avaliarLinha({
    ...base,
    minutosSemEntrada: 45,
    minutosDeSilencioNaJanela: 45,
    sonda: { respondeu: true, connected: false, detalhe: 'http_200 {"connected":false}' },
  })
  assertEquals(v.acao === 'alertar' && v.tipo, 'travada')
})

Deno.test('03/09: conectada, silêncio longo e o CRM insistindo — gancho morto', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 240, minutosDeSilencioNaJanela: 240, saidasNoSilencio: 6, sonda: sondaViva })
  assertEquals(v.acao, 'alertar')
  assertEquals(v.acao === 'alertar' && v.tipo, 'muda')
})

Deno.test('buraco normal da linha de vendas: 1h parada com uma saída não é queda', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 60, minutosDeSilencioNaJanela: 60, saidasNoSilencio: 1, sonda: sondaViva })
  assertEquals(v, { acao: 'ok', motivo: 'sem_evidencia' })
})

Deno.test('silêncio longo mas o CRM também não falou: falta insistência para acusar', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 200, minutosDeSilencioNaJanela: 200, saidasNoSilencio: 2, sonda: sondaViva })
  assertEquals(v, { acao: 'ok', motivo: 'sem_evidencia' })
})

Deno.test('um aviso por hora: dentro do cooldown o vigia cala', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 90, minutosDeSilencioNaJanela: 90, sonda: sondaMorta, avisadoHaMinutos: 20 })
  assertEquals(v, { acao: 'ok', motivo: 'ja_avisado' })
})

Deno.test('passado o cooldown, avisa de novo — linha muda segue muda', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 150, minutosDeSilencioNaJanela: 150, sonda: sondaMorta, avisadoHaMinutos: 75 })
  assertEquals(v.acao, 'alertar')
})

Deno.test('voltou a entrar mensagem: fecha o ciclo em vez de deixar a marca velha', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 2, minutosDeSilencioNaJanela: 2, marcadaMuda: true })
  assertEquals(v, { acao: 'voltou' })
})

Deno.test('linha marcada e ainda muda não "volta" só porque a janela reabriu', () => {
  // 8h05 do dia seguinte: a régua da janela zerou, o relógio não. Isto seria um "voltou"
  // mentiroso, e pior que não avisar é avisar que consertou sozinho.
  const v = avaliarLinha({ ...base, minutosSemEntrada: 900, minutosDeSilencioNaJanela: 5, marcadaMuda: true })
  assertEquals(v, { acao: 'ok', motivo: 'recebendo' })
})

Deno.test('a volta só vale dentro da janela — não acorda ninguém às 3h', () => {
  const v = avaliarLinha({ ...base, minutosSemEntrada: 2, minutosDeSilencioNaJanela: 2, marcadaMuda: true, dentroDaJanela: false })
  assertEquals(v, { acao: 'ok', motivo: 'fora_da_janela' })
})
