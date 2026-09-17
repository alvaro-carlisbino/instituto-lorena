import { describe, expect, it } from 'vitest'

import { proximoSeen, type SeenMap } from './useUnreadConversations'

/**
 * A tela do chat fecha um ciclo em volta desta função: marcar como lida muda `seen`, e
 * `seen` remonta a lista de conversas, que remonta a conversa aberta, que dispara o efeito
 * que marca como lida. Quem PARA o ciclo é a identidade do objeto devolvido aqui — se ele
 * for sempre novo, o React corta em 50 updates aninhados e a tela morre com o erro #185.
 */
describe('proximoSeen', () => {
  const AGORA = 1_758_130_000_000 // 17/set/2026
  const UMA_HORA = 3_600_000

  it('conversa já lida: devolve O MESMO objeto, sem render novo', () => {
    const prev: SeenMap = { 'lead-1': AGORA - UMA_HORA }
    const depois = proximoSeen(prev, 'lead-1', AGORA - 2 * UMA_HORA, AGORA)
    expect(depois).toBe(prev)
  })

  it('não para no relógio: chamar de novo, mais tarde, continua sem mexer', () => {
    // A guarda antiga era `>= Date.now()` e o relógio sempre anda: toda chamada devolvia
    // mapa novo, e era isso que não deixava o ciclo convergir.
    const prev: SeenMap = { 'lead-1': AGORA - UMA_HORA }
    expect(proximoSeen(prev, 'lead-1', AGORA - 2 * UMA_HORA, AGORA + 1)).toBe(prev)
    expect(proximoSeen(prev, 'lead-1', AGORA - 2 * UMA_HORA, AGORA + 5_000)).toBe(prev)
  })

  it('chegou mensagem nova: marca como lida agora', () => {
    const prev: SeenMap = { 'lead-1': AGORA - UMA_HORA }
    const depois = proximoSeen(prev, 'lead-1', AGORA - 60_000, AGORA)
    expect(depois).not.toBe(prev)
    expect(depois['lead-1']).toBe(AGORA)
  })

  it('conversa nunca aberta com mensagem do paciente: marca', () => {
    const depois = proximoSeen({}, 'lead-9', AGORA - 60_000, AGORA)
    expect(depois['lead-9']).toBe(AGORA)
  })

  it('conversa sem nenhuma mensagem recebida: nada a ver, mesmo objeto', () => {
    const prev: SeenMap = {}
    expect(proximoSeen(prev, 'lead-novo', 0, AGORA)).toBe(prev)
  })

  it('mensagem com data adiantada não deixa a conversa eternamente não lida', () => {
    // Relógio do celular do paciente à frente do nosso. Sem o `Math.max`, `seen` ficaria
    // atrás da mensagem para sempre e o ciclo voltava pela outra ponta.
    const futuro = AGORA + 10 * UMA_HORA
    const primeira = proximoSeen({}, 'lead-1', futuro, AGORA)
    expect(primeira['lead-1']).toBe(futuro)
    expect(proximoSeen(primeira, 'lead-1', futuro, AGORA + 1_000)).toBe(primeira)
  })

  it('cada número tem a sua conversa: marcar um não mexe no outro', () => {
    const prev: SeenMap = { 'lead-1': AGORA - UMA_HORA }
    const depois = proximoSeen(prev, 'lead-1::wa-wapi-mu4jwsjf', AGORA - 60_000, AGORA)
    expect(depois['lead-1']).toBe(AGORA - UMA_HORA)
    expect(depois['lead-1::wa-wapi-mu4jwsjf']).toBe(AGORA)
  })

  it('chave vazia não cria entrada', () => {
    const prev: SeenMap = {}
    expect(proximoSeen(prev, '', AGORA, AGORA)).toBe(prev)
  })
})
