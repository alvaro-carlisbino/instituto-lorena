import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'
import { upsertLeadByPhone, insertInteraction } from '../_shared/crm.ts'
import type { LeadAttribution } from '../_shared/attribution.ts'
import { shospConfigured, shospGetAgenda } from '../_shared/shosp.ts'
import { resolveOutboundProviderForLead } from '../_shared/whatsapp/resolveProvider.ts'
import { enqueueOutreach } from '../_shared/whatsapp/outreach.ts'
import { WapiProvider } from '../_shared/whatsapp/wapi.ts'

/**
 * Porta de entrada da landing /consulta.
 *
 * A clínica fecha 0,4% dos leads porque todo mundo entra pela mesma porta e a
 * atendente descobre no WhatsApp, uma pergunta por vez, quem está pronto e quem
 * está passeando. Aqui a triagem acontece ANTES do humano: a pessoa responde
 * cinco coisas, escolhe um horário e cai na fila já pontuada.
 *
 * Regras que valem mais que o payload:
 *  - o score é calculado AQUI. O que o navegador manda é resposta, não nota.
 *  - a estimativa de folículos sai da RPC `clinica_estimativa_publica` (quartis das
 *    cirurgias reais), nunca do que o cliente enviou.
 *  - o horário precisa existir em `clinica_agenda_publica` na hora do POST: sem
 *    isso dava para reservar 03:00 de domingo mandando um JSON à mão.
 *  - quem diz "só pesquisando" NÃO ganha horário. Vira lead frio e pronto; a
 *    agenda da Dra. é o recurso escasso que esta função protege.
 *  - polo fixo `instituto-lorena`: esta landing é da clínica e nada aqui pode cair
 *    no Tricopill (ver crm_lembrete_cirurgia_linha_tricopill).
 */

const TENANT = 'instituto-lorena'
const PIPELINE = 'pipeline-clinica'
const STAGE_QUENTE = 'ligar-formulario'   // 📞 Ligar — Formulário
const STAGE_FRIO = 'novo'                 // Novo lead

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function texto(v: unknown, max = 200): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max)
}

function digits(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

/** Telefone BR normalizado para 55DDDNÚMERO. Devolve '' quando não dá para usar. */
function telefoneBr(raw: unknown): string {
  let d = digits(raw)
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') return `55${d}`
  if (d.length === 10) return `55${d}`
  return ''
}

/** Protocolo curto que a pessoa vê e repete no WhatsApp. Sem 0/O/1/I. */
function protocoloNovo(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  for (const b of bytes) s += alfabeto[b % alfabeto.length]
  return `PA-${s}`
}

// ── Triagem ──────────────────────────────────────────────────────────────────
// Os pesos são a política comercial da casa, não estatística: urgência pesa mais
// que grau porque paciente Norwood 6 que "só está pesquisando" não paga a hora da
// atendente, e Norwood 3 que quer resolver este mês paga.

const PESO_URGENCIA: Record<string, number> = {
  este_mes: 35,
  ate_3_meses: 25,
  esse_ano: 12,
  pesquisando: 0,
}

const PESO_OBJETIVO: Record<string, number> = {
  transplante_masculino: 15,
  transplante_feminino: 15,
  sobrancelha: 12,
  barba: 12,
  tratamento: 8,
  nao_sei: 6,
}

const PESO_GRAU: Record<string, number> = {
  '1': 3, '2': 8, '3': 12, '3v': 13, '4': 15, '5': 15, '6': 15, '7': 14,
  ludwig_1: 8, ludwig_2: 14, ludwig_3: 14,
}

const PESO_TEMPO: Record<string, number> = {
  menos_1_ano: 4,
  de_1_a_3_anos: 6,
  mais_3_anos: 8,
}

const PESO_UNIDADE: Record<string, number> = {
  maringa: 12,
  londrina: 8,
  online: 8,
}

const PESO_JA_FEZ: Record<string, number> = {
  nao: 6,
  sim_outro_lugar: 8,
  sim_aqui: 2,
}

type Triagem = {
  objetivo: string
  grau: string
  tempoQueda: string
  jaFez: string
  cidade: string
  urgencia: string
  unidade: string
  temHorario: boolean
}

function calcularScore(t: Triagem): number {
  const soma =
    (PESO_URGENCIA[t.urgencia] ?? 0) +
    (PESO_OBJETIVO[t.objetivo] ?? 0) +
    (PESO_GRAU[t.grau] ?? 0) +
    (PESO_TEMPO[t.tempoQueda] ?? 0) +
    (PESO_UNIDADE[t.unidade] ?? 5) +
    (PESO_JA_FEZ[t.jaFez] ?? 0) +
    (t.temHorario ? 15 : 0)
  return Math.max(0, Math.min(100, Math.round(soma)))
}

/**
 * Quente/morno/frio pela FRAÇÃO do que o lead podia somar, não pelo número cru.
 *
 * Sem agenda na landing (ago/2026) ninguém mais ganha os 15 pontos de "escolheu
 * horário", e com o corte fixo em 70 a fila inteira teria escorregado um degrau
 * para baixo — a mesma pessoa, mesma resposta, virava morna da noite para o dia.
 * O teto acompanha o que estava em jogo.
 */
function temperaturaDoScore(score: number, teto = 100): 'cold' | 'warm' | 'hot' {
  const fracao = score / Math.max(1, teto)
  if (fracao >= 0.7) return 'hot'
  if (fracao >= 0.45) return 'warm'
  return 'cold'
}

// ── Rótulos para o texto que a equipe lê no CRM ──────────────────────────────
const ROTULO: Record<string, string> = {
  transplante_masculino: 'Transplante capilar (masculino)',
  transplante_feminino: 'Transplante capilar (feminino)',
  sobrancelha: 'Transplante de sobrancelhas',
  barba: 'Transplante de barba',
  tratamento: 'Tratamento capilar (sem cirurgia)',
  nao_sei: 'Ainda não sabe o que precisa',
  este_mes: 'quer resolver ESTE MÊS',
  ate_3_meses: 'quer resolver em até 3 meses',
  esse_ano: 'quer resolver ainda este ano',
  pesquisando: 'só pesquisando',
  menos_1_ano: 'perde cabelo há menos de 1 ano',
  de_1_a_3_anos: 'perde cabelo há 1 a 3 anos',
  mais_3_anos: 'perde cabelo há mais de 3 anos',
  nao: 'nunca fez transplante',
  sim_outro_lugar: 'já fez transplante em outro lugar',
  sim_aqui: 'já fez transplante aqui',
  maringa: 'Maringá',
  londrina: 'Londrina',
  online: 'Consulta online',
}

/**
 * Os rótulos de `ROTULO` são escritos para a atendente ler no CRM ("quer resolver
 * ESTE MÊS", "perde cabelo há mais de 3 anos"). Mandar isso de volta para a própria
 * pessoa soa como ficha policial. Estes aqui falam com ela.
 */
const ALVO_PACIENTE: Record<string, string> = {
  transplante_masculino: 'transplante capilar',
  transplante_feminino: 'transplante capilar feminino',
  sobrancelha: 'transplante de sobrancelhas',
  barba: 'transplante de barba',
  tratamento: 'tratamento para a queda, sem cirurgia',
  nao_sei: 'entender o que o seu caso pede',
}

const INTENCAO_PACIENTE: Record<string, string> = {
  este_mes: 'quer resolver ainda este mês',
  ate_3_meses: 'quer resolver nos próximos 3 meses',
  esse_ano: 'quer resolver ainda este ano',
  pesquisando: 'está pesquisando por enquanto',
}

function grauLegivel(grau: string): string {
  if (grau.startsWith('ludwig_')) return `Ludwig ${grau.replace('ludwig_', '')}`
  if (!grau) return ''
  if (grau === '3v') return 'Norwood III vertex'
  return `Norwood ${grau}`
}

/**
 * O texto que cai no WhatsApp da pessoa segundos depois de ela clicar em enviar.
 *
 * Ele existe para uma coisa só: quando ela abrir a conversa (o botão seguinte na
 * página faz exatamente isso), a clínica JÁ TER FALADO. Chat vazio é onde o lead
 * pago morre — a pessoa não sabe o que escrever, fecha e some.
 *
 * Três decisões de texto:
 *  - devolve o que ela respondeu, com as palavras dela. Prova que alguém leu.
 *  - a estimativa entra aqui de novo, porque é a única informação que ela não
 *    consegue em nenhum outro lugar, e é o que faz valer a pena responder.
 *  - termina em PERGUNTA. Resposta dela transforma isto em conversa aberta, e
 *    conversa aberta não gasta cota nenhuma da guarda anti-ban.
 *
 * Sem link, de propósito: link na primeira mensagem de um contato novo é uma das
 * assinaturas que queimam sessão não-oficial (ver crm_wapi_guarda_antiban).
 */
function mensagemDaSofia(input: {
  nome: string
  protocolo: string
  triagem: Triagem
  estimativa: { esperado: number } | null
}): string {
  const primeiro = input.nome.trim().split(/\s+/)[0] || 'tudo bem'
  const alvo = ALVO_PACIENTE[input.triagem.objetivo] ?? ''
  const grau = grauLegivel(input.triagem.grau)
  const intencao = INTENCAO_PACIENTE[input.triagem.urgencia] ?? ''
  const pesquisando = input.triagem.urgencia === 'pesquisando'

  const resumo = [
    alvo ? `Você me contou que procura ${alvo}` : 'Você acabou de responder a avaliação',
    grau ? ` (marcou ${grau})` : '',
    intencao ? ` e que ${intencao}` : '',
    '.',
  ].join('')

  const numero = input.estimativa
    ? `\n\nPela nossa base de cirurgias, um caso parecido costuma pedir algo em torno de ` +
      `${input.estimativa.esperado.toLocaleString('pt-BR')} unidades foliculares. O número final quem define é a ` +
      `avaliação da Dra., olhando a sua área doadora de perto.`
    : ''

  const fecho = pesquisando
    ? '\n\nSem compromisso nenhum: quer que eu te explique como funciona o tratamento no seu caso?'
    : '\n\nPosso te explicar como funciona a avaliação e o que a Dra. analisa nela?'

  return (
    `Oi, ${primeiro}! Aqui é a Sofia, do Instituto Lorena Visentainer.` +
    `\n\nAcabei de receber a sua avaliação pelo site, protocolo ${input.protocolo}.` +
    `\n\n${resumo}${numero}${fecho}`
  )
}

function dataLegivel(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Dia e hora civis do horário, no fuso da clínica (é assim que a Shosp fala). */
function diaEHoraLocal(iso: string): { dia: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? ''
  return { dia: `${g('year')}-${g('month')}-${g('day')}`, hora: `${g('hour')}:${g('minute')}` }
}

/**
 * Pergunta à Shosp, no instante da reserva, se aquele horário ainda está livre.
 *
 * O espelho é atualizado de 30 em 30 minutos, e meia hora é tempo de sobra para a
 * recepção encaixar alguém por telefone. Esta é a última conferência antes de
 * prometer o horário para o paciente: 'ocupado' significa que a agenda da clínica
 * já tem alguém ali, e aí a landing manda escolher outro em vez de criar um
 * conflito que só apareceria na hora da consulta.
 *
 * Devolve 'livre' | 'ocupado' | 'desconhecido'. 'desconhecido' (Shosp fora do ar,
 * cota estourada) NÃO derruba a reserva: isto é PRÉ-agendamento e a equipe
 * confirma, então a resposta certa é gravar com um aviso, não perder o paciente.
 */
async function conferirNaShosp(
  codigoUnidade: string,
  codigoPrestador: string,
  slotIso: string,
): Promise<'livre' | 'ocupado' | 'desconhecido'> {
  if (!shospConfigured() || !codigoUnidade || !codigoPrestador) return 'desconhecido'
  const { dia, hora } = diaEHoraLocal(slotIso)
  try {
    const r = await shospGetAgenda({
      codigoUnidade,
      dataInicial: dia,
      diasMostrar: 1,
      codigoPrestador: Number(codigoPrestador),
    })
    if (!r.ok) return 'desconhecido'
    const blocos: Record<string, unknown>[] = []
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk)
      else if (x && typeof x === 'object') blocos.push(x as Record<string, unknown>)
    }
    walk((r.data as { dados?: unknown })?.dados ?? null)
    let achouLivre = false
    for (const bloco of blocos.filter((o) => 'horarios' in o)) {
      const horarios = (bloco.horarios ?? {}) as Record<string, { horario?: Record<string, unknown>[] }>
      for (const [d, info] of Object.entries(horarios)) {
        if (d !== dia) continue
        for (const h of info.horario ?? []) {
          if (String(h.horario ?? '').slice(0, 5) !== hora) continue
          if (h.codigoAgendamento) return 'ocupado'   // alguém já está nesse horário
          if (h.restricao) return 'ocupado'           // agenda fechada
          if (h.codigoHorario !== undefined && h.codigoHorario !== null) achouLivre = true
        }
      }
    }
    return achouLivre ? 'livre' : 'ocupado'
  } catch {
    return 'desconhecido'
  }
}

/** Atribuição da landing: gclid vira Google, fbclid vira Meta, o resto é utm/direto. */
function atribuicaoDaLanding(bruto: Record<string, unknown>): LeadAttribution | null {
  const gclid = texto(bruto.gclid, 120)
  const fbclid = texto(bruto.fbclid, 200)
  const utmSource = texto(bruto.utm_source, 60)
  const utmCampaign = texto(bruto.utm_campaign, 120)
  const utmContent = texto(bruto.utm_content, 120)
  const referrer = texto(bruto.referrer, 300)
  if (!gclid && !fbclid && !utmSource && !referrer) return null
  const channel = gclid
    ? 'landing_google_ads'
    : fbclid
      ? 'landing_meta_ads'
      : utmSource
        ? `landing_${utmSource.toLowerCase().replace(/[^a-z0-9_]+/g, '_')}`
        : 'landing_organico'
  return {
    channel,
    campaign: utmCampaign || undefined,
    adId: utmContent || undefined,
    sourceUrl: texto(bruto.landing_url, 300) || undefined,
    raw: { ...bruto, referrer },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) return json({ error: 'server_misconfigured' }, 500)
  const admin = createClient(supabaseUrl, serviceKey)

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  // ── Funil da landing ──────────────────────────────────────────────────────
  // storefront_events não aceita insert de anon (e não vai aceitar: é a tabela de
  // métrica do negócio). Então a própria landing manda os passos por aqui, com uma
  // lista fechada de tipos — sem isso não dá para saber se a página perde gente no
  // passo 2 ou no horário, que é a única pergunta que importa depois de publicar.
  if (texto(payload.action) === 'evento') {
    // `landing_horarios` continua na lista por causa do histórico gravado antes de a
    // agenda sair da página; o funil de hoje é view → triagem → contato → whatsapp.
    const tipos = new Set([
      'landing_view',
      'landing_triagem',
      'landing_contato',
      'landing_whatsapp',
      'landing_horarios',
      'landing_abandono',
    ])
    const tipo = texto(payload.tipo, 40)
    if (!tipos.has(tipo)) return json({ ok: true, ignorado: true })
    const atr = (payload.atribuicao ?? {}) as Record<string, unknown>
    try {
      await admin.from('storefront_events').insert({
        tenant_id: TENANT,
        type: tipo,
        session_id: texto(payload.sessionId, 60) || null,
        path: texto(atr.landing_path, 120) || '/consulta',
        referrer: texto(atr.referrer, 300) || null,
        attribution: atribuicaoDaLanding(atr) as unknown as Record<string, unknown> | null,
        meta: { passo: texto(payload.passo, 40) || null },
      })
    } catch {
      // métrica nunca derruba a página
    }
    return json({ ok: true })
  }

  // Armadilha de robô: campo escondido no formulário. Gente não preenche.
  if (texto(payload.sobrenome)) return json({ ok: true, protocolo: protocoloNovo(), ignorado: true })

  const nome = texto(payload.nome, 80)
  const telefone = telefoneBr(payload.telefone)
  if (nome.length < 2) return json({ error: 'nome_invalido', message: 'Escreva o seu nome completo.' }, 400)
  if (!telefone) {
    return json({ error: 'telefone_invalido', message: 'Confira o WhatsApp: precisa de DDD + número.' }, 400)
  }

  const respostas = (payload.respostas ?? {}) as Record<string, unknown>
  const unidade = texto(payload.unidade, 40) || 'maringa'
  const slotAt = texto(payload.slotAt, 40)
  const querHorario = Boolean(slotAt)

  const triagem: Triagem = {
    objetivo: texto(respostas.objetivo, 40),
    grau: texto(respostas.grau, 20),
    tempoQueda: texto(respostas.tempoQueda, 40),
    jaFez: texto(respostas.jaFez, 40),
    cidade: texto(respostas.cidade, 80),
    urgencia: texto(respostas.urgencia, 40),
    unidade,
    temHorario: querHorario,
  }

  const score = calcularScore(triagem)
  const temperatura = temperaturaDoScore(score, querHorario ? 100 : 85)

  // Estimativa pela referência da casa. Falha aqui não derruba o agendamento.
  let estimativa: { esperado: number; minimo: number; maximo: number; amostra: number } | null = null
  const escala = triagem.grau.startsWith('ludwig_') ? 'ludwig' : 'norwood'
  const grauRpc = triagem.grau.replace('ludwig_', '')
  if (grauRpc) {
    try {
      const { data } = await admin.rpc('clinica_estimativa_publica', { p_escala: escala, p_grau: grauRpc })
      const linha = Array.isArray(data) ? data[0] : data
      if (linha && Number(linha.esperado) > 0) {
        estimativa = {
          esperado: Number(linha.esperado),
          minimo: Number(linha.minimo),
          maximo: Number(linha.maximo),
          amostra: Number(linha.amostra),
        }
      }
    } catch {
      // referência indisponível: segue sem estimativa
    }
  }

  // Freio de repetição: três reservas do mesmo número em 24h já é ruído.
  if (querHorario) {
    const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { count } = await admin
      .from('clinic_prebookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', TENANT)
      .eq('telefone', telefone)
      .gte('created_at', desde)
    if ((count ?? 0) >= 3) {
      return json(
        { error: 'muitas_tentativas', message: 'Você já tem horários reservados. Fale com a equipe no WhatsApp.' },
        429,
      )
    }
  }

  // O horário tem de existir na agenda pública AGORA (Shosp + expediente +
  // antecedência + feriado). Sem esta conferência, um POST à mão marcava consulta
  // às 3 da manhã. E é daqui que sai o PROFISSIONAL: quem escolhe o médico é a
  // regra da casa, não o navegador do paciente.
  let codigoPrestador = ''
  let profissional = ''
  let avisoShosp = ''
  if (querHorario) {
    // O profissional escolhido na tela vem no payload, mas quem manda é a agenda:
    // se aquele horário não é dele, a reserva não acontece. Dois médicos podem estar
    // livres às 13:00, e marcar com o outro seria trocar o médico do paciente sem avisar.
    const preferido = texto(payload.codigoPrestador, 20)
    const { data: livres, error: erroAgenda } = await admin.rpc('clinica_agenda_publica', {
      p_unidade: unidade,
      p_dias: null,
      p_objetivo: triagem.objetivo || null,
      p_prestador: preferido || null,
    })
    if (erroAgenda) return json({ error: 'agenda_indisponivel', message: 'Não consegui ler a agenda agora.' }, 503)
    const alvo = new Date(slotAt).getTime()
    const achado = (livres ?? []).find(
      (l: { unidade_id: string; slot_at: string; codigo_prestador?: string }) =>
        l.unidade_id === unidade &&
        new Date(l.slot_at).getTime() === alvo &&
        (!preferido || String(l.codigo_prestador ?? '') === preferido),
    ) as { codigo_prestador?: string; profissional?: string } | undefined
    codigoPrestador = String(achado?.codigo_prestador ?? '')
    profissional = String(achado?.profissional ?? '')
    const existe = Boolean(achado)
    if (!existe) {
      // Ocupado e "não existe" são coisas diferentes: dizer "acabou de ser reservado"
      // para um horário que nunca existiu manda a pessoa esperar uma vaga que não vem.
      const { count: jaTem } = await admin
        .from('clinic_prebookings')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', TENANT)
        .eq('unidade_id', unidade)
        .eq('slot_at', slotAt)
        .in('status', ['pendente', 'confirmado'])
      return json(
        {
          error: 'horario_indisponivel',
          message: (jaTem ?? 0) > 0
            ? 'Esse horário acabou de ser reservado. Escolha outro, por favor.'
            : 'Esse horário não está mais na agenda. Escolha outro, por favor.',
        },
        409,
      )
    }

    // Última conferência antes de prometer: a agenda da clínica pode ter mudado
    // nos minutos desde o último espelho.
    const { data: uni } = await admin
      .from('clinic_booking_units')
      .select('shosp_codigo_unidade')
      .eq('id', unidade)
      .maybeSingle()
    const codigoUnidade = String(uni?.shosp_codigo_unidade ?? '')
    const naShosp = await conferirNaShosp(codigoUnidade, codigoPrestador, slotAt)
    if (naShosp === 'ocupado') {
      return json(
        {
          error: 'horario_indisponivel',
          message: 'Esse horário acabou de ser preenchido na agenda da clínica. Escolha outro, por favor.',
        },
        409,
      )
    }
    if (naShosp === 'desconhecido') {
      avisoShosp = 'A Shosp não respondeu na hora da reserva: conferir a agenda antes de confirmar.'
    }
  }

  const atribuicao = atribuicaoDaLanding((payload.atribuicao ?? {}) as Record<string, unknown>)

  // ── Resumo que a atendente lê antes de ligar ───────────────────────────────
  const linhas = [
    `Triagem da landing · score ${score}/100`,
    ROTULO[triagem.objetivo] ? `Objetivo: ${ROTULO[triagem.objetivo]}` : '',
    grauLegivel(triagem.grau) ? `Grau: ${grauLegivel(triagem.grau)}` : '',
    estimativa ? `Estimativa: ~${estimativa.esperado} unidades foliculares (referência da casa)` : '',
    ROTULO[triagem.tempoQueda] ? `Tempo: ${ROTULO[triagem.tempoQueda]}` : '',
    ROTULO[triagem.jaFez] ? `Histórico: ${ROTULO[triagem.jaFez]}` : '',
    ROTULO[triagem.urgencia] ? `Intenção: ${ROTULO[triagem.urgencia]}` : '',
    triagem.cidade ? `Cidade: ${triagem.cidade}` : '',
    `Unidade: ${ROTULO[unidade] ?? unidade}`,
    profissional ? `Profissional: ${profissional}` : '',
    avisoShosp,
  ].filter(Boolean)

  const customFields: Record<string, unknown> = {
    origem_landing: 'consulta',
    triagem_objetivo: triagem.objetivo,
    triagem_grau: triagem.grau,
    triagem_tempo: triagem.tempoQueda,
    triagem_ja_fez: triagem.jaFez,
    triagem_urgencia: triagem.urgencia,
    triagem_cidade: triagem.cidade,
    triagem_unidade: unidade,
    triagem_score: score,
    ...(estimativa ? { estimativa_foliculos: estimativa.esperado } : {}),
  }

  let leadId = ''
  try {
    const r = await upsertLeadByPhone(admin, {
      patientName: nome,
      phone: telefone,
      summary: linhas.slice(1).join(' · ').slice(0, 400),
      source: 'manual',
      tenantId: TENANT,
      pipelineId: PIPELINE,
      stageId: temperatura === 'cold' ? STAGE_FRIO : STAGE_QUENTE,
      score,
      temperature: temperatura,
      customFields,
      attribution: atribuicao,
    })
    leadId = r.leadId
  } catch (e) {
    return json({ error: 'lead_falhou', message: e instanceof Error ? e.message : String(e) }, 400)
  }

  // ── Reserva ────────────────────────────────────────────────────────────────
  const protocolo = protocoloNovo()
  let prebookingId = ''
  if (querHorario) {
    const { data, error } = await admin
      .from('clinic_prebookings')
      .insert({
        tenant_id: TENANT,
        protocolo,
        lead_id: leadId,
        nome,
        telefone,
        unidade_id: unidade,
        slot_at: slotAt,
        codigo_prestador: codigoPrestador || null,
        prestador: profissional,
        objetivo: triagem.objetivo,
        grau: triagem.grau,
        urgencia: triagem.urgencia,
        cidade: triagem.cidade,
        score,
        temperatura,
        estimativa_min: estimativa ? Math.min(estimativa.minimo, estimativa.esperado) : null,
        estimativa_max: estimativa ? Math.max(estimativa.maximo, estimativa.esperado) : null,
        respostas: { ...respostas, estimativa },
        atribuicao: atribuicao ? (atribuicao as unknown as Record<string, unknown>) : null,
        user_agent: texto(req.headers.get('user-agent'), 300),
        observacao: avisoShosp,
      })
      .select('id')
      .single()
    if (error) {
      // 23505 = o índice único do slot. Duas pessoas no mesmo horário: a segunda escolhe outro.
      const conflito = String(error.code) === '23505'
      return json(
        {
          error: conflito ? 'horario_indisponivel' : 'reserva_falhou',
          message: conflito
            ? 'Esse horário acabou de ser reservado. Escolha outro, por favor.'
            : 'Não consegui gravar a reserva. Tente de novo.',
          leadId,
        },
        conflito ? 409 : 400,
      )
    }
    prebookingId = String(data?.id ?? '')
  }

  // ── Rastro no CRM: interação + tarefa ─────────────────────────────────────
  const cabecalho = querHorario
    ? `Pré-agendou consulta ${protocolo} · ${dataLegivel(slotAt)} · ${ROTULO[unidade] ?? unidade}${profissional ? ` · ${profissional}` : ''}`
    : 'Preencheu a triagem da landing e NÃO escolheu horário'
  try {
    await insertInteraction(admin, {
      leadId,
      patientName: nome,
      channel: 'system',
      direction: 'system',
      author: 'Landing /consulta',
      content: [cabecalho, ...linhas].join('\n'),
      tenantId: TENANT,
    })
  } catch {
    // rastro é desejável, não obrigatório
  }

  try {
    const vence = querHorario
      ? new Date(Math.min(Date.now() + 2 * 3600 * 1000, new Date(slotAt).getTime() - 12 * 3600 * 1000))
      : new Date(Date.now() + 4 * 3600 * 1000)
    await admin.from('lead_tasks').insert({
      id: `task-${crypto.randomUUID().slice(0, 12)}`,
      tenant_id: TENANT,
      lead_id: leadId,
      title: querHorario
        ? `Confirmar consulta ${protocolo} · ${dataLegivel(slotAt)}`
        : `Ligar para ${nome} (triagem da landing, sem horário)`,
      task_type: 'follow_up',
      due_at: vence.toISOString(),
      metadata: { origem: 'landing_consulta', protocolo, score, temperatura, prebooking_id: prebookingId || null },
    })
  } catch {
    // sem tarefa a fila ainda aparece na tela de pré-agendamentos
  }

  try {
    await admin.from('storefront_events').insert({
      tenant_id: TENANT,
      type: querHorario ? 'prebooking' : 'landing_lead',
      session_id: texto(payload.sessionId, 60) || null,
      lead_id: leadId,
      path: texto((payload.atribuicao as Record<string, unknown>)?.landing_path, 120) || '/consulta',
      referrer: texto((payload.atribuicao as Record<string, unknown>)?.referrer, 300) || null,
      attribution: atribuicao ? (atribuicao as unknown as Record<string, unknown>) : null,
      meta: { score, temperatura, unidade, protocolo, slot_at: slotAt || null },
    })
  } catch {
    // métrica não bloqueia venda
  }

  // ── A clínica fala PRIMEIRO ────────────────────────────────────────────────
  //
  // Sai agora, direto, e não pela fila de primeiro contato. A pessoa está PARADA na
  // página, acabou de digitar o próprio número e o botão seguinte abre a conversa: se
  // a mensagem viesse pela fila (ritmo de 45-90s, teto do dia, janela 08h-20h), ela
  // abriria um chat vazio e teria de puxar assunto sozinha. É exatamente o atrito que
  // esta landing existe para tirar.
  //
  // Classificada como `transactional` de propósito: é a confirmação de um ato que a
  // pessoa acabou de praticar, como o código que se pede na tela — não é abordagem que
  // ninguém pediu. O que a guarda protegeria aqui, bater em número morto, é feito à mão
  // logo abaixo com o `phone-exists`, porque `transactional` não confere isso.
  //
  // Se qualquer coisa falhar (linha caída, número sem WhatsApp, erro de rede), o lead
  // cai na FILA em vez de sumir: ninguém fica sem contato por causa de um envio ruim.
  const textoSofia = mensagemDaSofia({ nome, protocolo, triagem, estimativa })

  // Mesma pessoa preenchendo de novo (recarregou, mandou duas vezes, voltou no dia
  // seguinte): a conversa já está aberta e mandar a apresentação por cima é o robô se
  // repetindo. `transactional` não tem teto nenhum, então esta é a única trava daqui.
  const { data: jaFalou } = await admin
    .from('interactions')
    .select('id')
    .eq('lead_id', leadId)
    .eq('channel', 'whatsapp')
    .eq('direction', 'out')
    .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle()

  let mensagemEnviada = Boolean(jaFalou)
  if (!mensagemEnviada) {
    try {
      const { provider, lineTenantId } = await resolveOutboundProviderForLead(admin, {
        id: leadId,
        whatsapp_instance_id: null,
        tenant_id: TENANT,
      })

      // Número torto é o maior risco desta porta: a pessoa DIGITA o telefone, e ninguém
      // valida contra o WhatsApp antes daqui.
      const existe = provider instanceof WapiProvider ? await provider.phoneExists(telefone) : true
      if (existe !== true) throw new Error(existe === false ? 'numero_sem_whatsapp' : 'numero_nao_verificado')

      const enviado = await provider.sendMessage({
        to: telefone,
        text: textoSofia,
        leadId,
        metadata: { antiBanKind: 'transactional', antiBanSource: 'landing_consulta' },
      })
      mensagemEnviada = true

      await insertInteraction(admin, {
        leadId,
        patientName: nome,
        channel: 'whatsapp',
        direction: 'out',
        author: 'Sofia (IA)',
        content: textoSofia,
        externalMessageId: enviado.externalMessageId,
        tenantId: lineTenantId ?? TENANT,
      }).catch(() => {})
    } catch {
      // A fila tem trava única por (lead, kind): mesmo se o lead voltar por outro
      // caminho, ele não recebe a mesma apresentação duas vezes.
      await enqueueOutreach(admin, {
        tenantId: TENANT,
        leadId,
        phone: telefone,
        message: textoSofia,
        kind: 'optin',
        source: 'landing_consulta',
        ignorarConversaAberta: true,
      })
    }
  }

  // ── Resposta ──────────────────────────────────────────────────────────────
  const { data: cfg } = await admin
    .from('clinic_booking_settings')
    .select('whatsapp_e164')
    .eq('tenant_id', TENANT)
    .maybeSingle()
  const whats = digits(cfg?.whatsapp_e164 ?? '5544991493656')
  const msg = querHorario
    ? `Olá! Sou ${nome}. Reservei a avaliação ${protocolo} para ${dataLegivel(slotAt)} (${ROTULO[unidade] ?? unidade}) pelo site.`
    : `Olá! Sou ${nome}. Fiz a triagem no site e quero falar sobre a minha avaliação.`

  return json({
    ok: true,
    leadId,
    prebookingId: prebookingId || null,
    protocolo,
    score,
    temperatura,
    estimativa,
    slotAt: slotAt || null,
    profissional: profissional || null,
    mensagemEnviada,
    // Com a mensagem já entregue, o link abre a conversa LIMPA: a pessoa lê o que a
    // Sofia escreveu e responde. Texto pronto ali em cima faria ela mandar um "Olá,
    // sou fulano" por cima de uma mensagem que já a chamou pelo nome.
    whatsappUrl: mensagemEnviada
      ? `https://wa.me/${whats}`
      : `https://wa.me/${whats}?text=${encodeURIComponent(msg)}`,
  })
})
