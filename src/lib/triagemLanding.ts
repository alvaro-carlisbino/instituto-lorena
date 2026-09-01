/**
 * As respostas que a pessoa deu na landing `/consulta`, prontas para a ficha do lead.
 *
 * A edge function `crm-agendar-publico` grava tudo isso em `custom_fields` e escreve
 * um resumo de uma linha no `summary` do lead. O resumo cabe em 400 caracteres e é
 * cortado na lista; quem vai ATENDER precisa das respostas separadas, com o score.
 * Até 31/ago/2026 nenhuma tela lia esses campos: `triagem_score` e `origem_landing`
 * não apareciam em nenhum `.tsx`.
 *
 * Os rótulos são os mesmos do resumo ("quer resolver ESTE MÊS") porque são escritos
 * para a atendente ler antes de ligar. Existe um segundo conjunto, mais gentil, que a
 * edge function usa para falar com a própria pessoa no WhatsApp — esse não vem para cá.
 */

const ROTULO: Record<string, string> = {
  transplante_masculino: 'Transplante capilar (masculino)',
  transplante_feminino: 'Transplante capilar (feminino)',
  sobrancelha: 'Transplante de sobrancelhas',
  barba: 'Transplante de barba',
  tratamento: 'Tratamento capilar (sem cirurgia)',
  nao_sei: 'Ainda não sabe o que precisa',
  este_mes: 'Quer resolver ESTE MÊS',
  ate_3_meses: 'Quer resolver em até 3 meses',
  esse_ano: 'Quer resolver ainda este ano',
  pesquisando: 'Só pesquisando',
  menos_1_ano: 'Perde cabelo há menos de 1 ano',
  de_1_a_3_anos: 'Perde cabelo há 1 a 3 anos',
  mais_3_anos: 'Perde cabelo há mais de 3 anos',
  nao: 'Nunca fez transplante',
  sim_outro_lugar: 'Já fez transplante em outro lugar',
  sim_aqui: 'Já fez transplante aqui',
  maringa: 'Maringá',
  londrina: 'Londrina',
  online: 'Consulta online',
}

/** "3v" → "Norwood III vertex"; "ludwig_2" → "Ludwig 2". */
export function grauLegivel(grau: string): string {
  if (!grau) return ''
  if (grau.startsWith('ludwig_')) return `Ludwig ${grau.replace('ludwig_', '')}`
  if (grau === '3v') return 'Norwood III vertex'
  return `Norwood ${grau}`
}

export type TriagemLanding = {
  /** Qual landing carimbou o lead (hoje só existe 'consulta'). */
  landing: string
  objetivo: string
  grau: string
  tempo: string
  jaFez: string
  urgencia: string
  cidade: string
  unidade: string
  score: number | null
  /** O máximo que ESTA triagem podia somar — ver `tetoDaTriagem`. */
  teto: number
  /** `score / teto` em %, ou null sem score. É isso que define quente/morno/frio. */
  fracaoPct: number | null
  temperatura: 'cold' | 'warm' | 'hot' | null
  estimativaFoliculos: number | null
}

/**
 * O teto do score deste lead, somando só o que FOI perguntado a ele.
 *
 * A landing encolheu de 5 perguntas para 3 em ago/2026, e antes disso perdeu o passo
 * de escolher horário. Com um corte fixo em 70 sobre 100, cada pergunta removida
 * rebaixaria a fila inteira um degrau sem ninguém ter mudado de resposta — por isso a
 * edge function pontua por FRAÇÃO do teto, e a ficha precisa mostrar a mesma conta.
 *
 * Esta função é o FALLBACK para os leads gravados antes de 31/ago/2026. A partir dali a
 * edge function grava `triagem_teto` junto com o score, e `lerTriagemLanding` prefere o
 * valor gravado: teto recalculado na tela é teto da régua de HOJE aplicado a quem
 * respondeu ONTEM, e a landing já mudou de tamanho duas vezes.
 *
 * O termo `temHorario` fecha a armadilha antiga: os 15 pontos de "escolheu horário"
 * entram no score, mas a escolha só existia em `clinic_prebookings`, então quem reservou
 * slot aparecia com o teto 15 pontos MENOR que o real, ou seja, com a fração inflada.
 * Agora o carimbo vem no próprio `custom_fields` (`triagem_tem_horario`).
 */
export function tetoDaTriagem(t: {
  grau: string
  tempo: string
  jaFez: string
  temHorario?: boolean
}): number {
  return (
    35 + // urgência
    15 + // objetivo
    12 + // unidade
    (t.grau ? 15 : 0) +
    (t.tempo ? 8 : 0) +
    (t.jaFez ? 8 : 0) +
    (t.temHorario ? 15 : 0)
  )
}

/** Mesmos cortes da edge function: 70% do teto é quente, 45% é morno. */
export function temperaturaDaFracao(fracao: number): 'cold' | 'warm' | 'hot' {
  if (fracao >= 0.7) return 'hot'
  if (fracao >= 0.45) return 'warm'
  return 'cold'
}

const str = (v: unknown): string => (v == null ? '' : String(v))

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Devolve a triagem pronta para a tela, ou `null` se o lead não veio da landing.
 *
 * Não exige `triagem_score`: lead antigo com carimbo e sem score ainda mostra as
 * respostas, que é o que a atendente usa. Só a linha do score some.
 */
export function lerTriagemLanding(customFields: Record<string, unknown> | null | undefined): TriagemLanding | null {
  const cf = customFields ?? {}
  if (cf.origem_landing == null) return null

  const grauCru = str(cf.triagem_grau)
  const tempoCru = str(cf.triagem_tempo)
  const jaFezCru = str(cf.triagem_ja_fez)

  const score = num(cf.triagem_score)
  // Teto GRAVADO manda; a conta local só cobre o que entrou antes de 31/ago/2026.
  const tetoGravado = num(cf.triagem_teto)
  const teto = tetoGravado != null && tetoGravado > 0
    ? tetoGravado
    : tetoDaTriagem({
        grau: grauCru,
        tempo: tempoCru,
        jaFez: jaFezCru,
        temHorario: cf.triagem_tem_horario === true,
      })
  const fracao = score == null ? null : score / Math.max(1, teto)

  return {
    landing: str(cf.origem_landing),
    objetivo: ROTULO[str(cf.triagem_objetivo)] ?? str(cf.triagem_objetivo),
    grau: grauLegivel(grauCru),
    tempo: ROTULO[tempoCru] ?? tempoCru,
    jaFez: ROTULO[jaFezCru] ?? jaFezCru,
    urgencia: ROTULO[str(cf.triagem_urgencia)] ?? str(cf.triagem_urgencia),
    cidade: str(cf.triagem_cidade),
    unidade: ROTULO[str(cf.triagem_unidade)] ?? str(cf.triagem_unidade),
    score,
    teto,
    fracaoPct: fracao == null ? null : Math.round(fracao * 100),
    temperatura: fracao == null ? null : temperaturaDaFracao(fracao),
    estimativaFoliculos: num(cf.estimativa_foliculos),
  }
}
