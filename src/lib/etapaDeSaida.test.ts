import { describe, expect, it } from 'vitest'

import type { Pipeline } from '@/mocks/crmMock'
import { ehEtapaDeSaida, saidasDeOutroFunil } from './etapaDeSaida'

const funil = (id: string, tenantId: string | undefined, stages: [string, string][]): Pipeline => ({
  id,
  name: id,
  tenantId,
  boardConfig: {},
  stages: stages.map(([sid, name]) => ({ id: sid, name })),
})

const clinica = funil('pipeline-clinica', 'instituto-lorena', [
  ['contato', 'Contato'],
  ['fechado', 'Encerrado'],
  ['nao-se-aplica', '🚫 Fornecedor / não se aplica'],
])
const transplante = funil('pipeline-tratamento-capilar', 'instituto-lorena', [
  ['tc-triagem', 'Triagem e primeiros dados'],
  ['tc-avaliacao', 'Avaliação capilar'],
  ['tc-concluido', 'Tratamento concluído (pré-cirúrgico)'],
])
const cirurgico = funil('pipeline-processo-cirurgico', 'instituto-lorena', [
  ['cir-realizada', 'Realizada'],
  ['cir-nao-fechou', 'Não fechou'],
  ['cir-cancelou', 'Cancelou'],
])
const vendas = funil('tricopill__pipeline-vendas', 'tricopill', [
  ['tricopill__vd-pago', 'Pago'],
  ['tricopill__vd-perdido', 'Perdido'],
])
const catalogo = [clinica, transplante, cirurgico, vendas]

describe('etapaDeSaida', () => {
  it('reconhece Encerrado, Perdido e Fornecedor / não se aplica', () => {
    expect(ehEtapaDeSaida({ id: 'fechado', name: 'Encerrado' })).toBe(true)
    expect(ehEtapaDeSaida({ id: 'x', name: 'Perdido' })).toBe(true)
    expect(ehEtapaDeSaida({ id: 'nao-se-aplica', name: '🚫 Fornecedor / não se aplica' })).toBe(true)
  })

  // "Fechado" no funil de protocolos é VENDA. Pelo id, "fechado" também é o Encerrado da
  // clínica: por isso a regra olha o nome.
  it('não confunde venda fechada nem desfecho de proposta com saída', () => {
    expect(ehEtapaDeSaida({ id: 'pro-fechado', name: 'Fechado' })).toBe(false)
    expect(ehEtapaDeSaida({ id: 'cir-nao-fechou', name: 'Não fechou' })).toBe(false)
    expect(ehEtapaDeSaida({ id: 'cir-cancelou', name: 'Cancelou' })).toBe(false)
  })

  // O caso do Stone, 14/set/2026: card no funil do transplante, paciente disse "Não obrigado".
  it('funil sem saída recebe as saídas da clínica, do mesmo polo', () => {
    const saidas = saidasDeOutroFunil(catalogo, transplante)
    expect(saidas.map((s) => `${s.pipeline.id}/${s.stage.id}`)).toEqual([
      'pipeline-clinica/fechado',
      'pipeline-clinica/nao-se-aplica',
    ])
  })

  it('funil que já tem saída não ganha opção extra', () => {
    expect(saidasDeOutroFunil(catalogo, clinica)).toEqual([])
    expect(saidasDeOutroFunil(catalogo, vendas)).toEqual([])
  })

  it('não oferece saída de outro polo nem quando o polo do funil é desconhecido', () => {
    const semPolo = { ...transplante, tenantId: undefined }
    expect(saidasDeOutroFunil(catalogo, semPolo)).toEqual([])
    const doTricopill = funil('tricopill__outro', 'tricopill', [['t-novo', 'Novo']])
    expect(saidasDeOutroFunil(catalogo, doTricopill).map((s) => s.stage.id)).toEqual(['tricopill__vd-perdido'])
  })
})
