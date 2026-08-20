import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8'

/**
 * Guarda anti-ban das linhas de WhatsApp NÃO-oficiais (W-API, Evolution).
 *
 * A regra que o Álvaro deu em 20/08/2026, quando o WhatsApp da SDR da clínica saiu do
 * ManyChat e passou a viver numa sessão W-API: **responder como sempre respondemos; para
 * contato novo, todo o cuidado do mundo.** Este arquivo é essa frase em código.
 *
 * O que a plataforma lê como robô (e por isso é o que a guarda limita):
 *   1. volume de mensagem que a pessoa NÃO pediu, num dia só;
 *   2. rajada — várias saídas em segundos, sem intervalo humano;
 *   3. texto idêntico para muita gente diferente na mesma hora;
 *   4. insistir com quem nunca respondeu (é isso que vira denúncia, e denúncia é o que bane);
 *   5. mandar para número que nem WhatsApp tem (a sessão fica "batendo em porta fechada");
 *   6. link logo na primeira mensagem para um desconhecido;
 *   7. madrugada.
 *
 * O que NÃO é limitado, de propósito: responder dentro da conversa. Se a pessoa escreveu
 * nas últimas 24h, a resposta sai — a qualquer hora, sem teto, sem fila. Conversa aberta é
 * o tráfego mais seguro que existe nesse canal, e travar isso quebraria o atendimento sem
 * comprar segurança nenhuma.
 *
 * Quem chama: `guardWhatsappOutbound` ANTES de mandar, `recordWhatsappOutbound` DEPOIS
 * (ou logo após o bloqueio). O livro-caixa em `whatsapp_outbound_log` é a fonte dos
 * contadores — contar por `interactions` misturaria eco do aparelho e ManyChat, e não
 * guardaria o que foi recusado.
 */

/**
 * `optin` é o primeiro contato com quem PEDIU contato (formulário do Meta, site). Não é
 * resposta — a pessoa não escreveu para o número — mas também não é abordagem a
 * desconhecido: ela deixou o telefone minutos atrás esperando ser chamada. O risco de ban
 * mora na taxa de denúncia, e quem preencheu o formulário não denuncia. Por isso tem teto
 * próprio, mais folgado que o de contato frio, e continua sujeito a horário, ritmo e à
 * confirmação de que o número existe no WhatsApp.
 */
export type OutboundKind = 'reply' | 'proactive' | 'cold' | 'optin' | 'transactional'

export type GuardInput = {
  /** id da row em whatsapp_channel_instances (a LINHA), não o instanceId do painel. */
  instanceId: string | null
  tenantId?: string | null
  leadId?: string | null
  phone: string
  text: string
  /** Quem pediu o envio: 'crm-send-message', 'ai_auto_reply', 'reengage_reativacao'… */
  source: string
  /**
   * Força a classificação. 'transactional' é para código de acesso/confirmação que a
   * própria pessoa acabou de pedir — não passa por teto, mas continua no livro-caixa.
   */
  kind?: OutboundKind
  /**
   * Envio humano pela tela, com a pessoa vendo a conversa. Não fura opt-out, linha pausada
   * nem sessão caída; fura apenas os TETOS de volume (a atendente sabe o que está fazendo).
   * NÃO fura as regras de CONTATO NOVO — é justamente ali que o cuidado tem de existir,
   * inclusive para quem digita à mão.
   */
  humanOverride?: boolean
  /**
   * Libera também as regras de contato novo. Só para o caso em que alguém confirmou na tela
   * ("assumo o risco"): fica no livro-caixa com o motivo, e é raro por definição.
   */
  coldOverride?: boolean
}

export type GuardDecision = {
  allow: boolean
  kind: OutboundKind
  /** Código curto do motivo, para o log e para a tela: 'cap_frio_dia', 'fora_da_janela'… */
  reason?: string
  /** Frase pronta para o toast / log da rotina. */
  message?: string
  /** Segundos para tentar de novo, quando o bloqueio é de ritmo (gap/hora). */
  retryAfterSeconds?: number
  /** Atraso humano sugerido para o envio (digitando…), em segundos. */
  typingDelaySeconds: number
  /** true quando a linha é oficial/ManyChat: a guarda não se aplica. */
  bypassed?: boolean
  policy?: LinePolicy
}

export type LinePolicy = {
  instance_id: string
  tenant_id: string | null
  enabled: boolean
  janela_inicio: number
  janela_fim: number
  permite_domingo: boolean
  cap_frio_dia: number
  cap_optin_dia: number
  optin_max_idade_horas: number
  cap_proativo_dia: number
  cap_proativo_hora: number
  gap_min_segundos: number
  gap_jitter_segundos: number
  cap_proativo_semana_por_lead: number
  frio_max_tentativas: number
  frio_espera_dias: number
  aquecimento_inicio: string | null
  aquecimento_dias: number
  aquecimento_cap_inicial: number
  bloqueia_link_primeiro_contato: boolean
  cap_texto_repetido_hora: number
  pausado_ate: string | null
  pausa_motivo: string | null
}

export const DEFAULT_LINE_POLICY: Omit<LinePolicy, 'instance_id' | 'tenant_id'> = {
  enabled: true,
  janela_inicio: 8,
  janela_fim: 20,
  permite_domingo: false,
  cap_frio_dia: 20,
  cap_optin_dia: 40,
  optin_max_idade_horas: 48,
  cap_proativo_dia: 60,
  cap_proativo_hora: 12,
  gap_min_segundos: 45,
  gap_jitter_segundos: 45,
  cap_proativo_semana_por_lead: 2,
  frio_max_tentativas: 2,
  frio_espera_dias: 30,
  aquecimento_inicio: null,
  aquecimento_dias: 14,
  aquecimento_cap_inicial: 5,
  bloqueia_link_primeiro_contato: true,
  cap_texto_repetido_hora: 8,
  pausado_ate: null,
  pausa_motivo: null,
}

/** Provedores em que a guarda vale: os que rodam numa sessão do aplicativo, não na API da Meta. */
const GUARDED_PROVIDERS = new Set(['wapi', 'evolution'])

/**
 * Os três tipos de mensagem que a pessoa não pediu AGORA. Somam no mesmo teto de dia e de
 * hora, e no mesmo intervalo entre envios — para a plataforma, o que conta é quanta saída
 * partiu do número, não o nome que damos a ela.
 */
const NAO_PEDIDO = ['proactive', 'cold', 'optin']

const SP_TZ = 'America/Sao_Paulo'

/** Hora e dia da semana em São Paulo, sem depender do fuso do runtime da Edge (que é UTC). */
export function horaLocal(at: Date = new Date()): { hora: number; diaSemana: number; diaIso: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SP_TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
  })
  const parts = fmt.formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const hora = Number(get('hour')) || 0
  const diaIso = `${get('year')}-${get('month')}-${get('day')}`
  const semana = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { hora, diaSemana: semana < 0 ? new Date(at).getUTCDay() : semana, diaIso }
}

/** Início do dia LOCAL em ISO/UTC — é assim que "hoje" é contado no livro-caixa. */
export function inicioDoDiaLocalIso(at: Date = new Date()): string {
  const { diaIso } = horaLocal(at)
  // -03:00 fixo: o Brasil não tem horário de verão desde 2019.
  return new Date(`${diaIso}T00:00:00-03:00`).toISOString()
}

export function hashTexto(text: string): string {
  const norm = String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  // FNV-1a: barato e suficiente para "é o mesmo texto?".
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const LINK_RE = /(https?:\/\/|www\.|wa\.me\/|bit\.ly|\b[a-z0-9-]+\.(com|br|net|app|io|me)\b)/i

/**
 * Tempo de "digitando…" proporcional ao tamanho do texto, com piso e teto humanos.
 * Sai como `delayMessage` da W-API (o servidor deles segura e mostra o digitando), então
 * NÃO custa tempo de execução da função.
 */
export function typingDelaySeconds(text: string, kind: OutboundKind): number {
  const len = String(text ?? '').length
  if (kind === 'transactional') return 0
  const base = Math.round(len / 22) // ~22 caracteres por segundo, alguém apressado
  const jitter = Math.random() * 1.5
  return Math.max(1, Math.min(12, base + jitter))
}

export async function loadLinePolicy(
  admin: SupabaseClient,
  instanceId: string,
  tenantId?: string | null,
): Promise<LinePolicy> {
  const fallback: LinePolicy = {
    ...DEFAULT_LINE_POLICY,
    instance_id: instanceId,
    tenant_id: tenantId ?? null,
  }
  try {
    const { data } = await admin
      .from('whatsapp_line_policy')
      .select('*')
      .eq('instance_id', instanceId)
      .maybeSingle()
    if (!data) return fallback
    return { ...fallback, ...(data as Partial<LinePolicy>) } as LinePolicy
  } catch {
    return fallback
  }
}

/** Rampa de aquecimento: sai de `capInicial` e chega ao `teto` ao longo de `dias`. */
function rampa(teto: number, capInicial: number, dias: number, inicioIso: string | null, agora: Date): number {
  const alvo = Math.max(0, teto)
  if (!inicioIso) return alvo
  const inicio = new Date(inicioIso).getTime()
  if (!Number.isFinite(inicio)) return alvo
  const passados = Math.floor((agora.getTime() - inicio) / 86_400_000)
  if (passados < 0) return Math.min(alvo, capInicial)
  if (passados >= Math.max(1, dias)) return alvo
  const passo = (alvo - capInicial) / Math.max(1, dias)
  return Math.max(1, Math.min(alvo, Math.floor(capInicial + passo * passados)))
}

/** Teto de frios de hoje considerando a rampa de aquecimento da linha. */
export function capFrioComAquecimento(policy: LinePolicy, agora: Date = new Date()): number {
  return rampa(
    policy.cap_frio_dia,
    policy.aquecimento_cap_inicial,
    policy.aquecimento_dias,
    policy.aquecimento_inicio,
    agora,
  )
}

/**
 * Teto de primeiros contatos de hoje. A rampa parte do DOBRO do cap inicial de contato
 * frio: quem preencheu o formulário está à espera da mensagem, e segurar demais aqui é
 * perder o lead — que é o outro jeito de o número não servir para nada.
 */
export function capOptinComAquecimento(policy: LinePolicy, agora: Date = new Date()): number {
  return rampa(
    policy.cap_optin_dia,
    Math.max(policy.aquecimento_cap_inicial * 2, 10),
    policy.aquecimento_dias,
    policy.aquecimento_inicio,
    agora,
  )
}

type InstanceRow = {
  id: string
  tenant_id: string | null
  channel_provider: string | null
  label: string | null
}

/**
 * Decide se este envio pode sair AGORA por esta linha. Nunca lança: em qualquer erro
 * inesperado devolve `allow: true` com motivo 'guarda_indisponivel' — a guarda existe para
 * proteger o número, não para derrubar o atendimento se uma consulta falhar.
 */
export async function guardWhatsappOutbound(
  admin: SupabaseClient,
  input: GuardInput,
): Promise<GuardDecision> {
  const agora = new Date()
  const texto = String(input.text ?? '')
  const kindForcado = input.kind

  try {
    if (!input.instanceId) {
      return { allow: true, kind: kindForcado ?? 'proactive', bypassed: true, typingDelaySeconds: 0 }
    }

    const { data: instData } = await admin
      .from('whatsapp_channel_instances')
      .select('id, tenant_id, channel_provider, label')
      .eq('id', input.instanceId)
      .maybeSingle()
    const inst = (instData as InstanceRow | null) ?? null
    const provider = String(inst?.channel_provider ?? '').toLowerCase()

    // Linha oficial (Cloud API) ou ManyChat: quem policia volume é a Meta, com regra própria
    // (janela de 24h e template aprovado). Aqui não há número para banir.
    if (!GUARDED_PROVIDERS.has(provider)) {
      return { allow: true, kind: kindForcado ?? 'proactive', bypassed: true, typingDelaySeconds: 0 }
    }

    const tenantId = input.tenantId ?? inst?.tenant_id ?? null
    const policy = await loadLinePolicy(admin, input.instanceId, tenantId)

    // ── 1. Linha pausada / sessão caída ────────────────────────────────────────
    if (policy.pausado_ate && new Date(policy.pausado_ate).getTime() > agora.getTime()) {
      return {
        allow: false,
        kind: kindForcado ?? 'proactive',
        reason: 'linha_pausada',
        message: `Linha pausada até ${new Date(policy.pausado_ate).toLocaleString('pt-BR')}${
          policy.pausa_motivo ? ` (${policy.pausa_motivo})` : ''
        }. Nada sai por ela enquanto isso.`,
        typingDelaySeconds: 0,
        policy,
      }
    }

    const { data: healthData } = await admin
      .from('whatsapp_line_health')
      .select('status, connected, last_disconnected_at')
      .eq('instance_id', input.instanceId)
      .maybeSingle()
    const health = (healthData as { status?: string; connected?: boolean | null } | null) ?? null
    const healthStatus = String(health?.status ?? 'unknown').toLowerCase()

    if (healthStatus === 'banned') {
      return {
        allow: false,
        kind: kindForcado ?? 'proactive',
        reason: 'linha_banida',
        message: 'Esta linha está marcada como BANIDA. Nenhum envio sai até alguém reconectar o número.',
        typingDelaySeconds: 0,
        policy,
      }
    }

    // ── 2. Classificação: resposta, proativo ou contato novo ───────────────────
    const kind = kindForcado ?? (await classifyOutbound(admin, input.leadId, input.instanceId))

    // Resposta dentro da conversa e transacional (código que a pessoa pediu) passam sempre —
    // inclusive de quem um dia pediu para parar: se a pessoa voltou a escrever, ficar mudo
    // seria pior do que responder. Opt-out cala PROATIVO, não conversa.
    if (kind === 'reply' || kind === 'transactional') {
      return {
        allow: true,
        kind,
        typingDelaySeconds: typingDelaySeconds(texto, kind),
        policy,
      }
    }

    // ── 3. Opt-out: quem pediu para parar, parou ───────────────────────────────
    if (input.leadId && !input.coldOverride) {
      const { data: leadOpt } = await admin
        .from('leads')
        .select('opted_out_at')
        .eq('id', input.leadId)
        .maybeSingle()
      if ((leadOpt as { opted_out_at?: string | null } | null)?.opted_out_at) {
        return {
          allow: false,
          kind,
          reason: 'opt_out',
          message: 'Este contato pediu para não receber mais mensagens.',
          typingDelaySeconds: 0,
          policy,
        }
      }
    }

    // Daqui para baixo é mensagem que a pessoa NÃO pediu agora.
    if (healthStatus === 'disconnected' || health?.connected === false) {
      return {
        allow: false,
        kind,
        reason: 'sessao_caida',
        message: 'A sessão desta linha está desconectada no provedor. Proativo não sai enquanto o número não voltar.',
        typingDelaySeconds: 0,
        policy,
      }
    }

    if (!policy.enabled && !input.humanOverride) {
      return {
        allow: false,
        kind,
        reason: 'guarda_desligada',
        message: 'A guarda desta linha está desligada: por segurança, ela só entrega resposta dentro da conversa.',
        typingDelaySeconds: 0,
        policy,
      }
    }

    // ── 4. Janela de horário e dia ─────────────────────────────────────────────
    const { hora, diaSemana } = horaLocal(agora)
    if (!input.humanOverride) {
      if (hora < policy.janela_inicio || hora >= policy.janela_fim) {
        const faltaHoras = hora < policy.janela_inicio
          ? policy.janela_inicio - hora
          : 24 - hora + policy.janela_inicio
        return {
          allow: false,
          kind,
          reason: 'fora_da_janela',
          message: `Fora da janela de envio (${policy.janela_inicio}h–${policy.janela_fim}h). Mensagem de madrugada é o jeito mais rápido de virar denúncia.`,
          retryAfterSeconds: faltaHoras * 3600,
          typingDelaySeconds: 0,
          policy,
        }
      }
      if (diaSemana === 0 && !policy.permite_domingo) {
        return {
          allow: false,
          kind,
          reason: 'domingo',
          message: 'Domingo está fora da janela de proativos desta linha.',
          retryAfterSeconds: (24 - hora) * 3600,
          typingDelaySeconds: 0,
          policy,
        }
      }
    }

    const desdeInicioDoDia = inicioDoDiaLocalIso(agora)
    const umaHoraAtras = new Date(agora.getTime() - 3_600_000).toISOString()

    // ── 5. Tetos da linha ──────────────────────────────────────────────────────
    if (!input.humanOverride) {
      const { count: proativosHoje } = await admin
        .from('whatsapp_outbound_log')
        .select('id', { count: 'exact', head: true })
        .eq('instance_id', input.instanceId)
        .eq('decision', 'allowed')
        .in('kind', NAO_PEDIDO)
        .gte('created_at', desdeInicioDoDia)
      if ((proativosHoje ?? 0) >= policy.cap_proativo_dia) {
        return {
          allow: false,
          kind,
          reason: 'cap_proativo_dia',
          message: `Teto diário de proativos desta linha atingido (${policy.cap_proativo_dia}). O resto fica para amanhã.`,
          retryAfterSeconds: 3600,
          typingDelaySeconds: 0,
          policy,
        }
      }

      const { count: proativos1h } = await admin
        .from('whatsapp_outbound_log')
        .select('id', { count: 'exact', head: true })
        .eq('instance_id', input.instanceId)
        .eq('decision', 'allowed')
        .in('kind', NAO_PEDIDO)
        .gte('created_at', umaHoraAtras)
      if ((proativos1h ?? 0) >= policy.cap_proativo_hora) {
        return {
          allow: false,
          kind,
          reason: 'cap_proativo_hora',
          message: `Teto por hora atingido (${policy.cap_proativo_hora}). Rajada é o que a plataforma lê como robô.`,
          retryAfterSeconds: 600,
          typingDelaySeconds: 0,
          policy,
        }
      }

      // Ritmo: distância mínima entre dois proativos da mesma linha, com sorteio.
      const { data: ultimo } = await admin
        .from('whatsapp_outbound_log')
        .select('created_at')
        .eq('instance_id', input.instanceId)
        .eq('decision', 'allowed')
        .in('kind', NAO_PEDIDO)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const ultimoAt = (ultimo as { created_at?: string } | null)?.created_at
      if (ultimoAt) {
        const gapExigido =
          policy.gap_min_segundos + Math.floor(Math.random() * Math.max(0, policy.gap_jitter_segundos))
        const decorrido = (agora.getTime() - new Date(ultimoAt).getTime()) / 1000
        if (decorrido < gapExigido) {
          return {
            allow: false,
            kind,
            reason: 'ritmo',
            message: `Muito perto do envio anterior (${Math.round(decorrido)}s). O intervalo desta linha é de ~${gapExigido}s.`,
            retryAfterSeconds: Math.ceil(gapExigido - decorrido),
            typingDelaySeconds: 0,
            policy,
          }
        }
      }

      // Texto idêntico para muita gente na mesma hora: assinatura de disparo em massa.
      const hash = hashTexto(texto)
      if (policy.cap_texto_repetido_hora > 0 && texto.trim().length > 12) {
        const { data: iguais } = await admin
          .from('whatsapp_outbound_log')
          .select('lead_id')
          .eq('instance_id', input.instanceId)
          .eq('decision', 'allowed')
          .eq('text_hash', hash)
          .gte('created_at', umaHoraAtras)
          .limit(200)
        const pessoas = new Set(
          ((iguais as Array<{ lead_id: string | null }> | null) ?? [])
            .map((r) => r.lead_id ?? '')
            .filter(Boolean),
        )
        if (pessoas.size >= policy.cap_texto_repetido_hora) {
          return {
            allow: false,
            kind,
            reason: 'texto_repetido',
            message: `Este mesmo texto já foi para ${pessoas.size} pessoas na última hora. Varie a mensagem antes de continuar.`,
            retryAfterSeconds: 1800,
            typingDelaySeconds: 0,
            policy,
          }
        }
      }
    }

    // ── 6. Frequência com a MESMA pessoa ───────────────────────────────────────
    // Não vale para `optin`: ali é a PRIMEIRA mensagem, e quem preencheu o formulário está
    // à espera dela. Quem evita mandar duas vezes é a trava única da fila, não este teto.
    if (kind !== 'optin' && input.leadId && !input.humanOverride && policy.cap_proativo_semana_por_lead > 0) {
      const semanaAtras = new Date(agora.getTime() - 7 * 86_400_000).toISOString()
      const { count: proativosLead } = await admin
        .from('whatsapp_outbound_log')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', input.leadId)
        .eq('decision', 'allowed')
        .in('kind', NAO_PEDIDO)
        .gte('created_at', semanaAtras)
      if ((proativosLead ?? 0) >= policy.cap_proativo_semana_por_lead) {
        return {
          allow: false,
          kind,
          reason: 'cap_semana_por_lead',
          message: `Esta pessoa já recebeu ${proativosLead} mensagens não solicitadas nos últimos 7 dias. Insistir é o caminho da denúncia.`,
          retryAfterSeconds: 86_400,
          typingDelaySeconds: 0,
          policy,
        }
      }
    }

    // ── 7. PRIMEIRO CONTATO de quem pediu contato (formulário, site) ───────────
    if (kind === 'optin') {
      const capOptin = capOptinComAquecimento(policy, agora)
      if (!input.coldOverride) {
        const { count: optinHoje } = await admin
          .from('whatsapp_outbound_log')
          .select('id', { count: 'exact', head: true })
          .eq('instance_id', input.instanceId)
          .eq('decision', 'allowed')
          .eq('kind', 'optin')
          .gte('created_at', desdeInicioDoDia)
        if ((optinHoje ?? 0) >= capOptin) {
          const emAquecimento = capOptin < policy.cap_optin_dia
          return {
            allow: false,
            kind,
            reason: 'cap_optin_dia',
            message: emAquecimento
              ? `Teto de primeiros contatos de hoje atingido (${capOptin}, linha em aquecimento). Quem ficou na fila sai amanhã.`
              : `Teto de primeiros contatos de hoje atingido (${capOptin}). Quem ficou na fila sai amanhã.`,
            retryAfterSeconds: 3600,
            typingDelaySeconds: 0,
            policy,
          }
        }
      }

      // Link na mensagem de apresentação vale a mesma regra do contato frio: a pessoa
      // pediu contato, não pediu um link de alguém que ela ainda não sabe quem é.
      if (!input.coldOverride && policy.bloqueia_link_primeiro_contato && LINK_RE.test(texto)) {
        return {
          allow: false,
          kind,
          reason: 'link_primeiro_contato',
          message: 'A mensagem de apresentação não leva link. Mande o link depois que a pessoa responder.',
          typingDelaySeconds: 0,
          policy,
        }
      }
    }

    // ── 8. Regras exclusivas de CONTATO NOVO (ninguém pediu nada) ──────────────
    if (kind === 'cold') {
      const capFrio = capFrioComAquecimento(policy, agora)
      // Contato novo não abre exceção por ser humano a clicar: só o "assumo o risco" explícito.
      const coldBypass = input.coldOverride === true
      if (!coldBypass) {
        const { count: friosHoje } = await admin
          .from('whatsapp_outbound_log')
          .select('id', { count: 'exact', head: true })
          .eq('instance_id', input.instanceId)
          .eq('decision', 'allowed')
          .eq('kind', 'cold')
          .gte('created_at', desdeInicioDoDia)
        if ((friosHoje ?? 0) >= capFrio) {
          const emAquecimento = capFrio < policy.cap_frio_dia
          return {
            allow: false,
            kind,
            reason: 'cap_frio_dia',
            message: emAquecimento
              ? `Teto de contatos novos de hoje atingido (${capFrio}, linha em aquecimento). Sobe sozinho amanhã.`
              : `Teto de contatos novos de hoje atingido (${capFrio}).`,
            retryAfterSeconds: 3600,
            typingDelaySeconds: 0,
            policy,
          }
        }
      }

      // Link na primeira mensagem para quem nunca falou com a gente.
      if (!coldBypass && policy.bloqueia_link_primeiro_contato && LINK_RE.test(texto)) {
        return {
          allow: false,
          kind,
          reason: 'link_primeiro_contato',
          message: 'Primeira mensagem para contato novo não leva link. Apresente-se, e mande o link depois que a pessoa responder.',
          typingDelaySeconds: 0,
          policy,
        }
      }

      // Insistência: quantas vezes já batemos nesta porta sem ninguém abrir.
      if (input.leadId && !coldBypass) {
        const { data: tentativas } = await admin
          .from('whatsapp_outbound_log')
          .select('created_at')
          .eq('lead_id', input.leadId)
          .eq('decision', 'allowed')
          .eq('kind', 'cold')
          .order('created_at', { ascending: false })
          .limit(10)
        const lista = (tentativas as Array<{ created_at: string }> | null) ?? []
        if (lista.length >= policy.frio_max_tentativas) {
          return {
            allow: false,
            kind,
            reason: 'frio_max_tentativas',
            message: `Já tentamos ${lista.length}x com este número e ninguém respondeu. Parar aqui é o que protege a linha.`,
            typingDelaySeconds: 0,
            policy,
          }
        }
        const ultimaTentativa = lista[0]?.created_at
        if (ultimaTentativa) {
          const dias = (agora.getTime() - new Date(ultimaTentativa).getTime()) / 86_400_000
          if (dias < policy.frio_espera_dias) {
            return {
              allow: false,
              kind,
              reason: 'frio_espera',
              message: `Já tentamos há ${Math.floor(dias)} dia(s). A espera desta linha entre tentativas é de ${policy.frio_espera_dias} dias.`,
              retryAfterSeconds: Math.ceil((policy.frio_espera_dias - dias) * 86_400),
              typingDelaySeconds: 0,
              policy,
            }
          }
        }
      }
    }

    return {
      allow: true,
      kind,
      typingDelaySeconds: typingDelaySeconds(texto, kind),
      policy,
    }
  } catch (e) {
    console.warn('[antiBan] guarda indisponível, liberando:', e instanceof Error ? e.message : String(e))
    return {
      allow: true,
      kind: kindForcado ?? 'proactive',
      reason: 'guarda_indisponivel',
      typingDelaySeconds: 0,
    }
  }
}

/**
 * Resposta, proativo ou contato novo?
 *  - `reply`     — a pessoa escreveu nas últimas 24h (conversa aberta).
 *  - `proactive` — já escreveu alguma vez, mas não agora.
 *  - `cold`      — nunca escreveu para o CRM. É aqui que mora o risco.
 */
export async function classifyOutbound(
  admin: SupabaseClient,
  leadId: string | null | undefined,
  _instanceId: string | null,
): Promise<OutboundKind> {
  if (!leadId) return 'cold'
  try {
    const { data: state } = await admin
      .from('crm_conversation_states')
      .select('last_inbound_at')
      .eq('lead_id', leadId)
      .maybeSingle()
    const lastInbound = (state as { last_inbound_at?: string | null } | null)?.last_inbound_at
    if (lastInbound) {
      const idadeH = (Date.now() - new Date(lastInbound).getTime()) / 3_600_000
      if (idadeH <= 24) return 'reply'
      return 'proactive'
    }
    // `crm_conversation_states.last_inbound_at` já congelou antes (ago/26). A pergunta
    // "esta pessoa já escreveu?" tem uma segunda fonte: a própria interação de entrada.
    const { data: ultimaEntrada } = await admin
      .from('interactions')
      .select('happened_at')
      .eq('lead_id', leadId)
      .eq('direction', 'in')
      .order('happened_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const at = (ultimaEntrada as { happened_at?: string } | null)?.happened_at
    if (!at) return 'cold'
    const idadeH = (Date.now() - new Date(at).getTime()) / 3_600_000
    return idadeH <= 24 ? 'reply' : 'proactive'
  } catch {
    // Na dúvida, trata como proativo: aplica teto, mas não bloqueia como se fosse frio.
    return 'proactive'
  }
}

/**
 * Grava no livro-caixa e devolve o id da linha. Nunca lança: log não pode derrubar envio.
 *
 * O id importa porque a decisão é tomada ANTES do envio (é assim que o teto segura duas
 * rotinas ao mesmo tempo), e o envio ainda pode falhar depois. Ver `marcarEnvioFalhou`.
 */
export async function recordWhatsappOutbound(
  admin: SupabaseClient,
  input: GuardInput & { decision: GuardDecision },
): Promise<string | null> {
  try {
    const { data } = await admin.from('whatsapp_outbound_log').insert({
      tenant_id: input.tenantId ?? 'instituto-lorena',
      instance_id: input.instanceId,
      lead_id: input.leadId ?? null,
      phone: String(input.phone ?? '').replace(/[^0-9]/g, ''),
      kind: input.decision.kind,
      decision: input.decision.allow ? 'allowed' : 'blocked',
      reason: input.decision.reason ?? null,
      source: input.source?.slice(0, 60) ?? null,
      text_hash: hashTexto(input.text),
    }).select('id').single()
    return (data as { id?: string } | null)?.id ?? null
  } catch (e) {
    console.warn('[antiBan] falha ao gravar livro-caixa:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/**
 * O envio foi autorizado mas não saiu (instância inexistente, sessão fora do ar, 500 do
 * provedor). Reclassifica a linha do livro-caixa para que ela pare de contar como mensagem
 * entregue.
 *
 * Sem isto o teto punia o dia por mensagens que ninguém recebeu: em 20/08/2026 a fila de
 * primeiro contato tentou uma linha cujo instanceId nem existia mais no provedor, e cada
 * nova tentativa gastava cota do dia por nada.
 */
export async function marcarEnvioFalhou(
  admin: SupabaseClient,
  logId: string | null,
  motivo: string,
): Promise<void> {
  if (!logId) return
  try {
    await admin
      .from('whatsapp_outbound_log')
      .update({ decision: 'blocked', reason: `envio_falhou: ${motivo}`.slice(0, 200) })
      .eq('id', logId)
  } catch {
    /* best-effort */
  }
}

/**
 * Atalho usado nos pontos de envio: descobre de quem é o número, decide, e grava a decisão.
 *
 * A busca do lead pelo telefone não é detalhe: quem chama sem `leadId` (rotina que só tem o
 * número em mãos) cairia em 'cold' por omissão, e um aviso para quem conversa com a gente
 * todo dia seria tratado como abordagem a desconhecido — bloqueado pela regra errada.
 */
export async function guardAndRecord(
  admin: SupabaseClient,
  input: GuardInput,
): Promise<GuardDecision & { logId: string | null }> {
  let leadId = input.leadId ?? null
  if (!leadId && !input.kind) {
    const digitos = String(input.phone ?? '').replace(/[^0-9]/g, '')
    if (digitos.length >= 10) {
      try {
        const { data: achado } = await admin
          .from('leads')
          .select('id')
          .eq('phone', digitos)
          .limit(1)
          .maybeSingle()
        leadId = (achado as { id?: string } | null)?.id ?? null
      } catch {
        /* sem lead: segue com o que veio */
      }
    }
  }
  const efetivo: GuardInput = { ...input, leadId }
  const decision = await guardWhatsappOutbound(admin, efetivo)
  const logId = await recordWhatsappOutbound(admin, { ...efetivo, decision })
  return { ...decision, logId }
}

/**
 * Pausa a linha (freio de mão). Chamado pelo webhook de eventos quando a sessão cai e
 * pelo botão de pânico da tela.
 */
export async function pausarLinha(
  admin: SupabaseClient,
  instanceId: string,
  minutos: number,
  motivo: string,
  tenantId?: string | null,
): Promise<void> {
  const until = new Date(Date.now() + Math.max(1, minutos) * 60_000).toISOString()
  await admin
    .from('whatsapp_line_policy')
    .upsert(
      {
        instance_id: instanceId,
        ...(tenantId ? { tenant_id: tenantId } : {}),
        pausado_ate: until,
        pausa_motivo: motivo.slice(0, 200),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'instance_id' },
    )
}

export async function despausarLinha(admin: SupabaseClient, instanceId: string): Promise<void> {
  await admin
    .from('whatsapp_line_policy')
    .update({ pausado_ate: null, pausa_motivo: null, updated_at: new Date().toISOString() })
    .eq('instance_id', instanceId)
}

/** Escreve o estado da sessão. `detail` guarda o payload cru para depuração. */
export async function registrarSaudeDaLinha(
  admin: SupabaseClient,
  instanceId: string,
  patch: {
    tenantId?: string | null
    status?: string
    connected?: boolean | null
    phone?: string | null
    event?: string
    detail?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const now = new Date().toISOString()
    const row: Record<string, unknown> = {
      instance_id: instanceId,
      last_event: patch.event ?? null,
      last_event_at: now,
      updated_at: now,
    }
    if (patch.tenantId) row.tenant_id = patch.tenantId
    if (patch.status) row.status = patch.status
    if (patch.connected !== undefined) row.connected = patch.connected
    if (patch.phone) row.phone_e164 = patch.phone
    if (patch.detail) row.detail = patch.detail
    if (patch.connected === true) row.last_connected_at = now
    if (patch.connected === false) row.last_disconnected_at = now
    await admin.from('whatsapp_line_health').upsert(row, { onConflict: 'instance_id' })
  } catch (e) {
    console.warn('[antiBan] falha ao gravar saúde da linha:', e instanceof Error ? e.message : String(e))
  }
}
