// Transferir conversa entre números e atendentes. Rode com:
//   deno test supabase/functions/_shared/transferenciaConversa.test.ts
//
// As linhas são as da clínica em 17/09/2026: a SDR (padrão, com IA) e o WhatsApp da Aline Muniz
// (particular, sem IA), mais a SDR antiga desligada.
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  type LinhaParaTransferir,
  notaDaTransferencia,
  type PlanoDeTransferencia,
  planejarTransferencia,
} from './transferenciaConversa.ts'

const SDR: LinhaParaTransferir = {
  id: 'wa-wapi-mpyi00su',
  label: 'SDR Instituto (W-API)',
  active: true,
  sortOrder: 0,
  privateOwnerId: null,
  aiAutoReply: true,
}
const MUNIZ: LinhaParaTransferir = {
  id: 'wa-wapi-mu4jwsjf',
  label: 'Aline Muniz (WhatsApp próprio)',
  active: true,
  sortOrder: 10,
  privateOwnerId: 'user-aline',
  aiAutoReply: false,
}
const SDR_ANTIGA: LinhaParaTransferir = {
  id: 'wa-molsxxx7',
  label: 'SDR',
  active: false,
  sortOrder: 0,
  privateOwnerId: null,
  aiAutoReply: true,
}
const LINHAS = [MUNIZ, SDR_ANTIGA, SDR]

function plano(r: ReturnType<typeof planejarTransferencia>): PlanoDeTransferencia {
  if ('erro' in r) throw new Error(`recusou: ${r.erro}`)
  return r
}

Deno.test('SDR → Muniz: amarra no número dela, vai para ela e segura a Sofia na SDR', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-atendimento', whatsappInstanceId: SDR.id },
      { paraLinhaId: MUNIZ.id, deLinhaId: SDR.id, responsavelId: 'user-atendimento' },
    ),
  )
  assertEquals(p.de?.id, SDR.id)
  assertEquals(p.gravaNumero, true)
  assertEquals(p.trocaNumero, true)
  // Particular: a dona, mesmo que a tela tenha mandado outra pessoa.
  assertEquals(p.responsavel, 'user-aline')
  assertEquals(p.trocaResponsavel, true)
  assertEquals(p.segurarIaNaOrigem, true)
})

Deno.test('SDR → Muniz com a Muniz já responsável: troca só o número', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-aline', whatsappInstanceId: SDR.id },
      { paraLinhaId: MUNIZ.id },
    ),
  )
  assertEquals(p.trocaNumero, true)
  assertEquals(p.trocaResponsavel, false)
  assertEquals(p.responsavel, 'user-aline')
})

Deno.test('contato sem número amarrado sai da linha padrão (SDR ativa, não a desligada)', () => {
  const p = plano(
    planejarTransferencia(LINHAS, { ownerId: 'user-aline', whatsappInstanceId: null }, { paraLinhaId: MUNIZ.id }),
  )
  assertEquals(p.de?.id, SDR.id)
  assertEquals(p.gravaNumero, true)
})

Deno.test('Muniz → SDR: mantém o responsável quando ninguém escolheu outro, sem IA para segurar', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-aline', whatsappInstanceId: MUNIZ.id },
      { paraLinhaId: SDR.id, deLinhaId: MUNIZ.id },
    ),
  )
  assertEquals(p.gravaNumero, true)
  assertEquals(p.responsavel, 'user-aline')
  assertEquals(p.trocaResponsavel, false)
  assertEquals(p.segurarIaNaOrigem, false)
})

Deno.test('Muniz → SDR passando para a SDR', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-aline', whatsappInstanceId: MUNIZ.id },
      { paraLinhaId: SDR.id, responsavelId: 'user-atendimento' },
    ),
  )
  assertEquals(p.responsavel, 'user-atendimento')
  assertEquals(p.trocaResponsavel, true)
})

Deno.test('conversa da Muniz aberta, contato amarrado na SDR, transferindo para a SDR: é troca de número', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-aline', whatsappInstanceId: SDR.id },
      { paraLinhaId: SDR.id, deLinhaId: MUNIZ.id },
    ),
  )
  assertEquals(p.gravaNumero, false)
  assertEquals(p.trocaNumero, true)
  assertEquals(p.de?.id, MUNIZ.id)
})

Deno.test('mesmo número, outra pessoa: só troca o responsável', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-atendimento', whatsappInstanceId: SDR.id },
      { paraLinhaId: SDR.id, responsavelId: 'user-gerencia' },
    ),
  )
  assertEquals(p.trocaNumero, false)
  assertEquals(p.gravaNumero, false)
  assertEquals(p.segurarIaNaOrigem, false)
  assertEquals(p.responsavel, 'user-gerencia')
})

Deno.test('nada mudou é recusado', () => {
  const r = planejarTransferencia(
    LINHAS,
    { ownerId: 'user-atendimento', whatsappInstanceId: SDR.id },
    { paraLinhaId: SDR.id, responsavelId: 'user-atendimento' },
  )
  assert('erro' in r)
  assertEquals(r.erro, 'nada_mudou')
})

Deno.test('número desligado ou de outro polo é recusado', () => {
  const r = planejarTransferencia(LINHAS, { ownerId: null, whatsappInstanceId: SDR.id }, { paraLinhaId: SDR_ANTIGA.id })
  assert('erro' in r)
  assertEquals(r.erro, 'linha_indisponivel')
  const r2 = planejarTransferencia(LINHAS, { ownerId: null, whatsappInstanceId: SDR.id }, { paraLinhaId: 'tricopill-wapi' })
  assert('erro' in r2)
})

Deno.test('nota diz quem, de onde, para onde e o recado, sem travessão', () => {
  const p = plano(
    planejarTransferencia(
      LINHAS,
      { ownerId: 'user-atendimento', whatsappInstanceId: SDR.id },
      { paraLinhaId: MUNIZ.id },
    ),
  )
  const nota = notaDaTransferencia({
    quem: 'Atendimento Comercial',
    plano: p,
    responsavelAnterior: 'Atendimento Comercial',
    responsavel: 'Aline',
    recado: '  Quer consulta em Londrina, prefere à tarde ',
  })
  assertEquals(
    nota,
    [
      'Conversa transferida por Atendimento Comercial.',
      'Número: SDR Instituto → Aline Muniz.',
      'Responsável: Atendimento Comercial → Aline.',
      'Recado: Quer consulta em Londrina, prefere à tarde',
    ].join('\n'),
  )
  assert(!nota.includes('—'))
})
