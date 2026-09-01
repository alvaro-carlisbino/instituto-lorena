import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { detectAiReasoningLeak, sanitizeCrmAiPatientReply } from './crmAiAutoReply.ts'

/**
 * Amostras REAIS que chegaram ao WhatsApp do paciente/cliente (tabela `interactions`).
 * Cada uma é um caso que a rede antiga deixou passar. Se algum dia voltarem a passar,
 * é aqui que quebra.
 */
const VAZAMENTOS_REAIS: Array<[string, string]> = [
  [
    'NETO 01/09 — plano interno em português, com as regras do prompt citadas',
    `1.  **Analisar o Contexto:**
    *   **Paciente:** NETO.
    *   **Histórico:**
        *   Paciente mandou "Boa tarde".
        *   Sofia (eu) mandou a saudação e o menu (1 a 5).
        *   Sofia (eu/assistente anterior) **errou** e perguntou "Com qual profissional você gostaria de realizar sua consulta?". (Isso viola a regra "NUNCA pergunta com qual médico ele quer").
    *   **Regra Atual:** Eu preciso corrigir o fluxo.`,
  ],
  [
    'João Carlos 31/08 — mesmo formato, culpando "o modelo anterior"',
    `1.  **Análise do Contexto:**
    *   **Paciente:** João Carlos Ponchon.
    *   **Histórico:**
        *   **Erro anterior na conversa:** Na resposta anterior (gerada por um modelo anterior ou estado diferente), a IA perguntou "Com qual profissional...".`,
  ],
  [
    'Alessandro 25/08 — narra o cliente em terceira pessoa, para o próprio cliente',
    `O cliente Alessandro enviou uma mensagem dizendo: "Eu recebi a indicação de um amigo".

Analisando o contexto:
1.  **Histórico recente:** Ele já conversou antes sobre o Tricopill para pós-transplante.`,
  ],
  [
    'Neli 18/08 — despeja campo interno do snapshot',
    `1.  **Análise do Usuário:**
    *   **Intenção:** O cliente quer comprar 4 frascos e precisa de entrega urgente.
    *   O snapshot mostra \`leadFocus.cadastro_conhecido.endereco\` vazio, então não tenho CEP.`,
  ],
  [
    'Claudia 18/08 — cita o prompt e o humano da conversa',
    `O cliente Claudia disse "Um de cada" em resposta à mensagem da Ingrid.
Analisando o contexto:
Problema: O prompt diz que o Shampoo Dry Confort está na tabela de preços, mas a Ingrid já respondeu o preço.`,
  ],
  [
    'Janaine 24/07 — o caso em inglês que a rede antiga já pegava',
    `*   **Correction on History Analysis:**
    *   The prompt's \`recent_conversation\` shows: 1. In: "Oi, boa tarde" 2. Out: Sofia greeting + Menu.`,
  ],
  [
    'Eliane 21/07 — rascunho rotulado em inglês',
    `2.  **Determine the Intent:**
    *   Eliane is likely following up on the invoice request from June 25th.
    *   **Draft:** "Olá Eliane, tudo bem?"`,
  ],
  [
    'Lafaieti 20/07 — relatório com rótulos de análise',
    `1.  **Análise da Solicitação do Cliente:**
    *   **Cliente:** Lafaieti.
    *   **Contexto Histórico:**
        *   A atendente humana (Ingrid) disse que o valor total fica R$ 283,00.`,
  ],
]

for (const [nome, texto] of VAZAMENTOS_REAIS) {
  Deno.test(`vazamento real barrado: ${nome}`, () => {
    const motivo = detectAiReasoningLeak(texto)
    assertEquals(motivo === null, false, `passou batido: ${texto.slice(0, 60)}`)
    assertEquals(sanitizeCrmAiPatientReply(texto).clean, '')
  })
}

/**
 * O outro lado: nenhuma destas pode ser barrada. Amostras reais de respostas BOAS,
 * incluindo as mais longas da base (a maior legítima tem 1.382 caracteres).
 */
const RESPOSTAS_BOAS: string[] = [
  `Olá, NETO! 😊
Seja muito bem-vindo(a) ao Instituto Lorena Visentainer.

Eu sou a *Sofia*, assistente do Instituto.

Para começarmos, por favor escolha uma das opções abaixo:

1️⃣ Transplante Capilar Masculino
2️⃣ Transplante Capilar Feminino`,
  `Haha, desculpa a confusão aí! 😅 Vamos organizar.

Como o seu foco é Transplante Capilar Masculino, já deixo encaminhado com a *Dra. Lorena Visentainer*, especialista em restauração capilar.

Só pra já deixar tudo certinho com a Aline: você é de Maringá, de Londrina ou de outra cidade?`,
  `Entendi, Lurdes. Cabelos ralos e finos com oleosidade no couro cabeludo necessitam de nutrição interna. O Tricopill oferece aminoácidos, vitaminas e minerais.

*Kit 3+1:* R$ 597,00
*Frete:* grátis em agosto
*Prazo:* 5 a 8 dias úteis`,
  `Bom dia! Boa tarde Roberta! Muito obrigada por compartilhar comigo como se sentiu. Agradeço pela sinceridade e entendo perfeitamente a sua insegurança.`,
  `Angélica, vou explicar para a Sra. como é o planejamento cirúrgico. Como a Sra. é de Curitiba, o ideal é que venha para Maringá um dia antes do procedimento, para que possa descansar.`,
  // Limite: 1.700 caracteres ainda passa (a maior resposta legítima da base tem 1.382).
  `Boa tarde! Segue a explicação completa do tratamento. ${'O Tricopill nutre o fio de dentro para fora. '.repeat(35)}`,
]

for (const [i, texto] of RESPOSTAS_BOAS.entries()) {
  Deno.test(`resposta boa passa intacta #${i + 1}`, () => {
    assertEquals(detectAiReasoningLeak(texto), null)
    assertEquals(sanitizeCrmAiPatientReply(texto).clean.length > 0, true)
  })
}

Deno.test('teto de tamanho: acima de 1800 é rascunho, não resposta', () => {
  const gigante = `Olá! Tudo bem? ${'Segue a informação solicitada sobre o tratamento. '.repeat(50)}`
  assertEquals(gigante.length > 1800, true)
  assertEquals(detectAiReasoningLeak(gigante), 'tamanho_impossivel')
})

Deno.test('o motivo sobe junto para o log', () => {
  assertEquals(sanitizeCrmAiPatientReply(VAZAMENTOS_REAIS[0][1]).leakReason, 'marcador_pt')
  assertEquals(sanitizeCrmAiPatientReply(VAZAMENTOS_REAIS[2][1]).leakReason, 'narra_cliente_em_terceira_pessoa')
})
