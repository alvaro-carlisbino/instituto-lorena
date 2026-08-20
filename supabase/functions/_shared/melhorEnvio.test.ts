import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { freeShippingKits, isFreeShippingKit, PROMO_FRETE_KIT3_ATE } from './melhorEnvio.ts'

/**
 * O que estes testes protegem: a promoção do kit 3+1 com frete grátis morava num env setado na
 * mão, e env não conhece data. Enquanto isso durou, a IA parava de anunciar no dia certo (o
 * texto do prompt e o gancho do reengajamento têm trava de data) e o servidor continuaria
 * zerando o frete do 3+1 calado, dando frete de graça sem ninguém ver.
 *
 * A promo foi encerrada em 20/08/2026 (PROMO_FRETE_KIT3_ATE = 19/08), antes do fim de agosto:
 * o envio externo do 3+1 saía com etiqueta de ~R$ 29 tirada da margem. Os testes seguem
 * cobrindo a mecânica, agora com a janela real.
 *
 * A virada é pela data LOCAL de São Paulo, não pela UTC: às 23h do último dia em Maringá o
 * relógio UTC já está no dia seguinte, e a promo ainda tinha que valer.
 */

const semEnv = (fn: () => void) => {
  const antes = Deno.env.get('FRETE_GRATIS_KITS')
  Deno.env.delete('FRETE_GRATIS_KITS')
  try {
    fn()
  } finally {
    if (antes !== undefined) Deno.env.set('FRETE_GRATIS_KITS', antes)
  }
}

Deno.test('durante a promo, 3+1 e 5 meses têm frete grátis', () => {
  const kits = freeShippingKits(new Date('2026-08-18T15:00:00Z'))
  assertEquals(kits.has('5_meses'), true)
  assertEquals(kits.has('3_meses'), true)
  assertEquals(kits.has('1_mes'), false)
})

Deno.test('depois da promo, só o kit de 5 meses continua grátis', () => {
  const kits = freeShippingKits(new Date('2026-08-20T15:00:00Z'))
  assertEquals(kits.has('5_meses'), true)
  assertEquals(kits.has('3_meses'), false)
})

Deno.test('a virada é pela data de São Paulo, não pela UTC', () => {
  // 20/08 02:00 UTC = 19/08 23:00 em São Paulo: a promo AINDA vale.
  assertEquals(freeShippingKits(new Date('2026-08-20T02:00:00Z')).has('3_meses'), true)
  // 21/08 02:00 UTC = 20/08 23:00 em São Paulo: acabou.
  assertEquals(freeShippingKits(new Date('2026-08-21T02:00:00Z')).has('3_meses'), false)
})

Deno.test('a promo do 3+1 está encerrada (último dia 19/08/2026)', () => {
  assertEquals(PROMO_FRETE_KIT3_ATE, '2026-08-19')
  // Hoje, seja lá que dia for, o 3+1 paga frete: a data já passou.
  assertEquals(freeShippingKits().has('3_meses'), false)
  assertEquals(freeShippingKits().has('5_meses'), true)
})

Deno.test('sem env, isFreeShippingKit segue a data', () => {
  semEnv(() => {
    const durante = new Date('2026-08-18T15:00:00Z')
    const depois = new Date('2026-08-20T15:00:00Z')
    assertEquals(isFreeShippingKit('3_meses', durante), true)
    assertEquals(isFreeShippingKit('3_meses', depois), false)
    // O kit de 5 meses é permanente: não depende da promo.
    assertEquals(isFreeShippingKit('5_meses', depois), true)
    // Variações que a IA manda ('kit3', '3 meses') caem na mesma chave.
    assertEquals(isFreeShippingKit('kit 3 meses', depois), false)
    assertEquals(isFreeShippingKit('5 meses', depois), true)
    assertEquals(isFreeShippingKit('1_mes', durante), false)
    assertEquals(isFreeShippingKit('', durante), false)
  })
})

Deno.test('o env continua sendo override manual e desliga a regra de data', () => {
  const antes = Deno.env.get('FRETE_GRATIS_KITS')
  try {
    const depois = new Date('2026-08-20T15:00:00Z')
    // Override explícito ressuscita o 3+1 mesmo fora da janela: quem seta assume o controle.
    Deno.env.set('FRETE_GRATIS_KITS', '5_meses,3_meses')
    assertEquals(isFreeShippingKit('3_meses', depois), true)
    // "none" desliga tudo, inclusive o kit permanente.
    Deno.env.set('FRETE_GRATIS_KITS', 'none')
    assertEquals(isFreeShippingKit('5_meses', new Date('2026-08-18T15:00:00Z')), false)
  } finally {
    if (antes === undefined) Deno.env.delete('FRETE_GRATIS_KITS')
    else Deno.env.set('FRETE_GRATIS_KITS', antes)
  }
})
