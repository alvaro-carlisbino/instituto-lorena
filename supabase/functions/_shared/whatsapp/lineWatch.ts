/**
 * Vigia de LINHA MUDA — a linha que continua "conectada" e parou de receber.
 *
 * 11/09/2026: a linha da clínica travou DENTRO da W-API às 14:36 e voltou sozinha às 16:03.
 * Durante 1h30 o CRM continuou enviando (a W-API ainda devolvia `messageId`), o painel
 * mostrava "conectada" e NADA avisou ninguém — quem percebeu foi a atendente, porque o
 * paciente respondeu no celular dela. `whatsapp_line_health` estava parada no evento de
 * 20/08: o provedor não manda evento de queda quando quem trava é a própria instância.
 *
 * A pergunta daqui não é "o provedor disse que caiu?" e sim **"por que ninguém escreve para
 * uma linha que está mandando mensagem?"**. As duas quedas conhecidas têm a mesma cara e
 * conserto diferente, e é por isso que a sonda não decide sozinha, só separa os casos:
 *  - 11/09: `status-instance` NÃO RESPONDE (timeout) → instância travada no provedor.
 *  - 03/09: `status-instance` responde `connected: true` e mesmo assim nada entra por 24h →
 *    o gancho de entrada morreu no despachante (conserto: `PUT update-webhook-received`).
 *
 * **DUAS RÉGUAS, porque as provas são de qualidade diferente** (medido no primeiro ensaio,
 * 12/09): sonda morta é prova direta e basta meia hora de silêncio. Sonda viva é só
 * suspeita, e linha de vendas tem buraco de uma hora no meio do dia por conta própria —
 * o Tricopill passou 10/09 inteiro com horas vazias e estava perfeito. Para acusar sem
 * prova direta exigimos silêncio LONGO e o CRM insistindo do lado de cá.
 *
 * Nada aqui pausa linha nem fala com paciente. Pausar bloqueia também a atendente
 * (11/09) e é decisão de operação, não de vigia.
 */

/** Silêncio que justifica gastar uma sonda no provedor. */
export const MIN_SILENCIO_SONDA = 30

/** Com a sonda viva, silêncio abaixo disto é só um período parado. */
export const MIN_SILENCIO_MUDA = 90

/** ...e ainda exigimos que o CRM tenha tentado falar tantas vezes no silêncio. */
export const MIN_SAIDAS_MUDA = 3

/** Um aviso por hora por linha. Linha muda segue muda; repetir de 5 em 5 min é ruído. */
export const COOLDOWN_MIN = 60

/**
 * A sonda é curta de propósito. Em 11/09 a instância travada ficou 5s, 20s e 30s sem
 * devolver byte nenhum enquanto a linha saudável respondia em menos de 1s: demora JÁ É a
 * resposta. 10s dá folga para lentidão normal sem transformar o cron em refém.
 */
export const SONDA_TIMEOUT_MS = 10_000

export type SondaDaLinha = {
  /** A W-API respondeu alguma coisa dentro do timeout? */
  respondeu: boolean
  /** `null` quando ela respondeu algo que não sabemos ler — aí não afirmamos que está no ar. */
  connected: boolean | null
  detalhe: string
}

export type SinalDaLinha = {
  /**
   * Minutos desde a última mensagem RECEBIDA, no relógio. `null` = nunca recebeu nada.
   * Serve para dizer que VOLTOU — e só para isso: de manhã ele carrega a noite inteira.
   */
  minutosSemEntrada: number | null
  /**
   * Minutos de silêncio DENTRO da janela de atendimento: conta a partir da abertura da
   * janela de hoje, nunca de antes dela. Sem isto toda linha amanhece "muda há 12 horas"
   * e o alarme morre de tanto mentir.
   */
  minutosDeSilencioNaJanela: number
  /** Mensagens que o CRM mandou DURANTE esse silêncio: a prova de que insistimos e ninguém voltou. */
  saidasNoSilencio: number
  /** Janela de atendimento da linha (`whatsapp_line_policy`), inclusive a regra de domingo. */
  dentroDaJanela: boolean
  /** `null` enquanto não sondamos — o veredito então é "sondar". */
  sonda: SondaDaLinha | null
  /** Minutos desde o último aviso desta linha. `null` = nunca avisamos. */
  avisadoHaMinutos: number | null
  /** A linha já está marcada como muda na `whatsapp_line_health`? */
  marcadaMuda: boolean
}

export type VereditoDaLinha =
  | { acao: 'ok'; motivo: string }
  | { acao: 'sondar' }
  | { acao: 'alertar'; tipo: 'travada' | 'muda'; motivo: string }
  | { acao: 'voltou' }

/** Só vale sondar quando o silêncio da janela passou do limite e a linha devia estar de pé. */
export function precisaSondar(
  s: Pick<SinalDaLinha, 'minutosDeSilencioNaJanela' | 'dentroDaJanela'>,
): boolean {
  return s.dentroDaJanela && s.minutosDeSilencioNaJanela >= MIN_SILENCIO_SONDA
}

export function avaliarLinha(s: SinalDaLinha): VereditoDaLinha {
  // Fora da janela ninguém escreve mesmo; silêncio às 3h da manhã não é sintoma.
  if (!s.dentroDaJanela) return { acao: 'ok', motivo: 'fora_da_janela' }

  // Linha que nunca recebeu nada (recém-pareada) não tem linha de base para comparar.
  if (s.minutosSemEntrada === null) return { acao: 'ok', motivo: 'sem_historico' }

  // A VOLTA olha o relógio de verdade, não o silêncio da janela: senão, toda manhã, a
  // linha que continua muda desde ontem "voltaria" às 8h só porque a régua zerou.
  if (s.marcadaMuda && s.minutosSemEntrada < MIN_SILENCIO_SONDA) return { acao: 'voltou' }

  if (s.minutosDeSilencioNaJanela < MIN_SILENCIO_SONDA) return { acao: 'ok', motivo: 'recebendo' }

  if (s.sonda === null) return { acao: 'sondar' }

  const travada = !s.sonda.respondeu || s.sonda.connected === false

  // Sonda viva é só suspeita: exige silêncio longo E o CRM tendo insistido no meio dele.
  if (!travada) {
    const evidencia =
      s.minutosDeSilencioNaJanela >= MIN_SILENCIO_MUDA && s.saidasNoSilencio >= MIN_SAIDAS_MUDA
    if (!evidencia) return { acao: 'ok', motivo: 'sem_evidencia' }
  }

  if (s.avisadoHaMinutos !== null && s.avisadoHaMinutos < COOLDOWN_MIN) {
    return { acao: 'ok', motivo: 'ja_avisado' }
  }

  return travada
    ? { acao: 'alertar', tipo: 'travada', motivo: s.sonda.detalhe || 'sonda_sem_resposta' }
    : { acao: 'alertar', tipo: 'muda', motivo: 'entrada_parada_com_saida_fluindo' }
}
