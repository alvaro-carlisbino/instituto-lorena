import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EscalaCapilar } from '@/components/landing/EscalaCapilar'
import { capturarAtribuicaoDoNavegador, type AtribuicaoLanding } from '@/lib/atribuicaoLanding'
import { diaLocal } from '@/lib/diaLocal'
import {
  agruparPorDia,
  escalaDoGrau,
  mascararTelefone,
  nomeValido,
  perguntasVisiveis,
  podeReservarHorario,
  telefoneValido,
  temEstimativa,
  triagemCompleta,
  type DiaComHorarios,
  type Horario,
  type PerguntaTriagem,
  type RespostasTriagem,
} from '@/lib/triagemConsulta'
import {
  ErroAgenda,
  carregarEstimativa,
  carregarHorarios,
  carregarNumerosPublicos,
  carregarProfissionais,
  carregarUnidades,
  enviarPreAgendamento,
  registrarEventoLanding,
  type EstimativaPublica,
  type NumerosPublicos,
  type ProfissionalPublico,
  type RespostaPreAgendamento,
  type UnidadePublica,
} from '@/services/agendaPublica'

/**
 * Landing /consulta: triagem + pré-agendamento.
 *
 * Por que ela existe: a clínica fecha 0,4% dos leads. Todo mundo entra pela mesma
 * porta do WhatsApp e a atendente descobre a mão, uma pergunta por vez, quem tem
 * indicação e quem está passeando. Aqui a pessoa se qualifica sozinha, vê uma
 * estimativa feita com as cirurgias REAIS da casa e escolhe um horário. A atendente
 * recebe a fila já pontuada, e quem responde "só estou pesquisando" não ocupa agenda.
 *
 * Três decisões de conversão que valem mais que o layout:
 *  1. Nenhuma digitação até o fim. Cinco perguntas de um toque, com desenho.
 *  2. A recompensa vem antes do pedido: o número de folículos aparece ANTES de pedir
 *     nome e telefone. O quiz do Tricopill morreu por fazer o contrário.
 *  3. Escassez verdadeira: os horários vêm da agenda, com feriado e Shosp descontados.
 *     Nada de "últimas vagas" inventado.
 *
 * A página é da CLÍNICA e roda deslogada. Nada aqui pode encostar no Tricopill.
 */

const WHATSAPP_CLINICA = '5544991493656'
const TELEFONE_VISIVEL = '(44) 99149-3656'

const numeroBr = (n: number) => n.toLocaleString('pt-BR')

function rotuloDoDia(dia: string): { semana: string; data: string } {
  const d = new Date(`${dia}T12:00:00-03:00`)
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' })
    .format(d)
    .replace('.', '')
  const data = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
    .format(d)
  return { semana: semana.charAt(0).toUpperCase() + semana.slice(1), data }
}

/** "Dra. Lorena Visentainer" vira "Dra. Lorena": cabe no botão e a pessoa reconhece. */
function primeiroNome(nome: string): string {
  const partes = nome.trim().split(/\s+/)
  if (partes.length <= 2) return nome
  return `${partes[0]} ${partes[1]}`
}

/** "amanhã" ou "seg, 25/08": a pessoa precisa saber quando, não o dia da semana por extenso. */
function quandoCurto(iso: string | null): string {
  if (!iso) return ''
  const dia = diaLocal(iso)
  const hoje = diaLocal(new Date())
  const amanha = diaLocal(new Date(Date.now() + 86_400_000))
  const hora = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
  if (dia === hoje) return `hoje ${hora}`
  if (dia === amanha) return `amanhã ${hora}`
  const { semana, data } = rotuloDoDia(dia)
  return `${semana} ${data}`
}

function horaDoSlot(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

function dataPorExtenso(iso: string): string {
  const texto = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** Link de calendário que funciona em qualquer celular, sem baixar arquivo. */
function linkGoogleAgenda(slotAt: string, unidade: UnidadePublica | undefined): string {
  const inicio = new Date(slotAt)
  const fim = new Date(inicio.getTime() + 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'Avaliação capilar · Instituto Lorena Visentainer',
    dates: `${fmt(inicio)}/${fmt(fim)}`,
    details: `Avaliação no Instituto Lorena Visentainer. Dúvidas pelo WhatsApp ${TELEFONE_VISIVEL}.`,
    location: unidade?.endereco || 'Instituto Lorena Visentainer',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// ── Peças visuais ────────────────────────────────────────────────────────────

function Botao({
  children,
  onClick,
  variante = 'primario',
  tipo = 'button',
  desabilitado = false,
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  variante?: 'primario' | 'contorno' | 'whatsapp'
  tipo?: 'button' | 'submit'
  desabilitado?: boolean
  className?: string
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'
  const estilo =
    variante === 'primario'
      ? 'bg-[#252A33] text-white hover:bg-[#171b21] active:scale-[0.99]'
      : variante === 'whatsapp'
        ? 'bg-[#128C4A] text-white hover:bg-[#0f7a40]'
        : 'border border-[#252A33]/25 bg-white text-[#252A33] hover:border-[#252A33]/60'
  return (
    <button type={tipo} onClick={onClick} disabled={desabilitado} className={`${base} ${estilo} ${className}`}>
      {children}
    </button>
  )
}

function IconeWhatsapp({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.41a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.85.83-.85 2.02s.87 2.34.99 2.5c.12.16 1.71 2.61 4.15 3.66.58.25 1.03.4 1.39.51.58.19 1.11.16 1.53.1.47-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  )
}

function Cabecalho() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#252A33]/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <img src="/marca/lorena.svg" alt="Instituto Lorena Visentainer" className="h-9 w-auto" />
        <a
          href={`https://wa.me/${WHATSAPP_CLINICA}`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 rounded-full border border-[#252A33]/20 px-4 py-2 text-sm font-semibold text-[#252A33] hover:border-[#252A33]/60"
        >
          <IconeWhatsapp className="h-4 w-4" />
          <span className="hidden sm:inline">{TELEFONE_VISIVEL}</span>
          <span className="sm:hidden">WhatsApp</span>
        </a>
      </div>
    </header>
  )
}

function Prova({ numeros }: { numeros: NumerosPublicos | null }) {
  if (!numeros || numeros.cirurgiasRealizadas <= 0) {
    return (
      <p className="text-sm text-[#252A33]/70">
        Dra. Lorena Visentainer · CRM 33717 | RQE 27798 · dermatologista e membro da ISHRS
      </p>
    )
  }
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      <div>
        <dt className="text-xs uppercase tracking-widest text-[#252A33]/55">Cirurgias finalizadas</dt>
        <dd className="font-heading text-2xl font-semibold">{numeroBr(numeros.cirurgiasRealizadas)}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase tracking-widest text-[#252A33]/55">Folículos implantados</dt>
        <dd className="font-heading text-2xl font-semibold">{numeroBr(numeros.foliculosImplantados)}</dd>
      </div>
      <div className="col-span-2 sm:col-span-1">
        <dt className="text-xs uppercase tracking-widest text-[#252A33]/55">Responsável técnica</dt>
        <dd className="font-heading text-base font-semibold leading-tight">
          Dra. Lorena Visentainer
          <span className="block text-xs font-normal text-[#252A33]/60">CRM 33717 | RQE 27798</span>
        </dd>
      </div>
    </dl>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────

type Etapa = 'inicio' | 'triagem' | 'resultado' | 'contato' | 'pronto'

export function ConsultaLandingPage() {
  const [etapa, setEtapa] = useState<Etapa>('inicio')
  const [indice, setIndice] = useState(0)
  const [respostas, setRespostas] = useState<RespostasTriagem>({})

  const [numeros, setNumeros] = useState<NumerosPublicos | null>(null)
  const [unidades, setUnidades] = useState<UnidadePublica[]>([])
  const [unidadeId, setUnidadeId] = useState('maringa')
  const [horarios, setHorarios] = useState<Horario[]>([])
  const [carregandoHorarios, setCarregandoHorarios] = useState(false)
  const [diaEscolhido, setDiaEscolhido] = useState('')
  const [slotEscolhido, setSlotEscolhido] = useState('')
  const [profissionais, setProfissionais] = useState<ProfissionalPublico[]>([])
  // '' = primeira vaga com qualquer profissional. É o padrão porque o que a pessoa
  // quer, antes de escolher médico, é ser atendida cedo.
  const [prestadorEscolhido, setPrestadorEscolhido] = useState('')

  const [estimativa, setEstimativa] = useState<EstimativaPublica | null>(null)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [sobrenome, setSobrenome] = useState('') // armadilha de robô
  const [aceite, setAceite] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<RespostaPreAgendamento | null>(null)

  const rastro = useRef<{ atribuicao: AtribuicaoLanding; sessao: string }>({ atribuicao: {}, sessao: '' })
  const painel = useRef<HTMLDivElement | null>(null)

  const visiveis = useMemo(() => perguntasVisiveis(respostas), [respostas])
  const pergunta: PerguntaTriagem | undefined = visiveis[indice]
  const querAgenda = podeReservarHorario(respostas)
  const unidade = unidades.find((u) => u.id === unidadeId)

  // Título, descrição e rastro da campanha. O index.html é do CRM interno, e sem isto
  // a aba de quem vem do anúncio diz "Instituto Lorena CRM · INTERNO".
  useEffect(() => {
    const anterior = document.title
    document.title = 'Avaliação capilar · Instituto Lorena Visentainer'
    const meta = document.querySelector('meta[name="description"]')
    const descricaoAnterior = meta?.getAttribute('content') ?? ''
    meta?.setAttribute(
      'content',
      'Descubra em 2 minutos quantas unidades foliculares o seu caso pede e reserve a sua avaliação no Instituto Lorena Visentainer.',
    )
    rastro.current = capturarAtribuicaoDoNavegador()
    registrarEventoLanding('landing_view', rastro.current)
    return () => {
      document.title = anterior
      if (meta && descricaoAnterior) meta.setAttribute('content', descricaoAnterior)
    }
  }, [])

  useEffect(() => {
    void carregarNumerosPublicos().then(setNumeros)
    void carregarUnidades()
      .then((lista) => {
        setUnidades(lista)
        if (lista.length && !lista.some((u) => u.id === 'maringa')) setUnidadeId(lista[0].id)
      })
      .catch(() => setUnidades([]))
  }, [])

  // Agenda: só busca quando a pessoa está no resultado (é lá que o seletor aparece) e
  // refaz ao trocar de unidade. NÃO refaz ao ir para o formulário: fazia isso antes e
  // a busca voltava limpando o horário escolhido, então o botão do fim virava
  // "quero receber orientação" e a reserva sumia entre uma tela e outra.
  useEffect(() => {
    if (etapa !== 'resultado') return
    if (!querAgenda) return
    let vivo = true
    setCarregandoHorarios(true)
    void carregarProfissionais(unidadeId, respostas.objetivo)
      .then((lista) => { if (vivo) setProfissionais(lista) })
      .catch(() => undefined)
    carregarHorarios(unidadeId, respostas.objetivo)
      .then((lista) => {
        if (!vivo) return
        setHorarios(lista)
        const dias = agruparPorDia(lista)
        setDiaEscolhido((atual) => (dias.some((d) => d.dia === atual) ? atual : (dias[0]?.dia ?? '')))
        // Só perde a escolha quem perdeu o horário de verdade (alguém reservou antes).
        setSlotEscolhido((atual) => (lista.some((h) => h.slotAt === atual) ? atual : ''))
      })
      .catch(() => {
        if (vivo) setHorarios([])
      })
      .finally(() => {
        if (vivo) setCarregandoHorarios(false)
      })
    return () => {
      vivo = false
    }
  }, [etapa, unidadeId, querAgenda, respostas.objetivo])

  /**
   * Em "primeira vaga" um horário aparece uma vez só, com quem estiver na frente da
   * ordem. Com profissional escolhido, mostra a agenda dele inteira. Sem isto, o
   * mesmo 13:00 apareceria três vezes, uma por médico.
   */
  const horariosVisiveis = useMemo(() => {
    if (prestadorEscolhido) return horarios.filter((h) => h.codigoPrestador === prestadorEscolhido)
    const vistos = new Set<string>()
    return horarios.filter((h) => {
      if (vistos.has(h.slotAt)) return false
      vistos.add(h.slotAt)
      return true
    })
  }, [horarios, prestadorEscolhido])

  const dias: DiaComHorarios[] = useMemo(() => agruparPorDia(horariosVisiveis), [horariosVisiveis])
  const horariosDoDia = dias.find((d) => d.dia === diaEscolhido)?.horarios ?? []
  const horarioEscolhido = horariosVisiveis.find((h) => h.slotAt === slotEscolhido) ?? null
  const profissionalEscolhido = profissionais.find((p) => p.codigoPrestador === prestadorEscolhido) ?? null
  /** Quem tem a vaga mais próxima entre os outros: é o que se oferece a quem ficou sem. */
  const alternativa = useMemo(() => {
    const outros = profissionais.filter((p) => p.codigoPrestador !== prestadorEscolhido && p.vagas > 0 && p.proxima)
    return outros.sort((a, b) => String(a.proxima).localeCompare(String(b.proxima)))[0] ?? null
  }, [profissionais, prestadorEscolhido])
  // Escassez verdadeira: quantas vagas existem na primeira semana que tem vaga. Sai
  // do próprio primeiro horário disponível, não de "hoje", para não prometer número
  // de uma semana em que a agenda está fechada.
  const vagasNaSemana = useMemo(() => {
    const primeiro = dias[0]?.dia
    if (!primeiro) return 0
    const limite = diaLocal(new Date(`${primeiro}T12:00:00-03:00`).getTime() + 7 * 86_400_000)
    return dias.filter((d) => d.dia <= limite).reduce((soma, d) => soma + d.horarios.length, 0)
  }, [dias])

  useEffect(() => {
    if (!dias.length) return
    if (dias.some((d) => d.dia === diaEscolhido)) return
    setDiaEscolhido(dias[0].dia)
    setSlotEscolhido('')
  }, [dias, diaEscolhido])

  const rolarParaPainel = useCallback(() => {
    window.requestAnimationFrame(() => {
      painel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const comecar = () => {
    setEtapa('triagem')
    setIndice(0)
    rolarParaPainel()
  }

  const responder = (id: keyof RespostasTriagem, valor: string) => {
    const novas = { ...respostas, [id]: valor }
    // Trocar de objetivo invalida o grau: Norwood não serve para sobrancelha.
    if (id === 'objetivo' && valor !== respostas.objetivo) delete novas.grau
    setRespostas(novas)

    const proximas = perguntasVisiveis(novas)
    const proximoIndice = indice + 1
    if (proximoIndice < proximas.length) {
      setIndice(proximoIndice)
      return
    }
    if (triagemCompleta(novas)) {
      setEtapa('resultado')
      registrarEventoLanding('landing_triagem', { ...rastro.current, passo: novas.urgencia ?? '' })
      const escala = temEstimativa(novas) ? escalaDoGrau(novas.grau ?? '') : null
      if (escala) void carregarEstimativa(escala.escala, escala.grau).then(setEstimativa)
      rolarParaPainel()
    }
  }

  const voltar = () => {
    if (etapa === 'resultado') {
      setEtapa('triagem')
      setIndice(Math.max(0, visiveis.length - 1))
      return
    }
    if (indice === 0) {
      setEtapa('inicio')
      return
    }
    setIndice(indice - 1)
  }

  const irParaContato = () => {
    setEtapa('contato')
    if (querAgenda) registrarEventoLanding('landing_horarios', { ...rastro.current, passo: slotEscolhido })
    rolarParaPainel()
  }

  const enviar = async () => {
    setErro('')
    if (!nomeValido(nome)) {
      setErro('Escreva o seu nome e sobrenome.')
      return
    }
    if (!telefoneValido(telefone)) {
      setErro('Confira o WhatsApp: precisa de DDD e número.')
      return
    }
    if (!aceite) {
      setErro('Precisamos da sua autorização para entrar em contato.')
      return
    }
    setEnviando(true)
    try {
      const r = await enviarPreAgendamento({
        nome: nome.trim(),
        telefone,
        unidade: unidadeId,
        slotAt: querAgenda && slotEscolhido ? slotEscolhido : null,
        codigoPrestador: horarioEscolhido?.codigoPrestador ?? null,
        respostas: respostas as Record<string, string>,
        atribuicao: rastro.current.atribuicao,
        sessionId: rastro.current.sessao,
        sobrenome,
      })
      setResultado(r)
      setEtapa('pronto')
      rolarParaPainel()
    } catch (e) {
      const msg = e instanceof ErroAgenda ? e.message : 'Não consegui concluir agora. Tente de novo.'
      setErro(msg)
      // Horário tomado no meio do caminho: recarrega a agenda para a pessoa escolher outro.
      if (e instanceof ErroAgenda && e.codigo === 'horario_indisponivel') {
        setSlotEscolhido('')
        setEtapa('resultado')
        void carregarHorarios(unidadeId, respostas.objetivo).then(setHorarios)
      }
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-dvh bg-white text-[#252A33] antialiased">
      <Cabecalho />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="border-b border-[#252A33]/10 bg-gradient-to-b from-white to-[#DCDBD1]/40">
        <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:py-16 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-[#252A33]/5 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#252A33]/70">
              Transplante Capilar Regenerativo®
            </p>
            <h1 className="font-heading text-3xl font-semibold leading-[1.1] sm:text-5xl">
              Descubra o que o seu caso pede e reserve a sua avaliação em 2 minutos.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#252A33]/75">
              São 5 perguntas de um toque. No fim você vê a estimativa de unidades foliculares calculada com as
              cirurgias já realizadas aqui dentro e escolhe o horário da sua avaliação.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Botao onClick={comecar} className="w-full sm:w-auto">
                Começar a minha avaliação
              </Botao>
              <a
                href={`https://wa.me/${WHATSAPP_CLINICA}?text=${encodeURIComponent('Olá! Vim pelo site e quero falar sobre a avaliação capilar.')}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#252A33]/25 px-6 py-4 text-base font-semibold hover:border-[#252A33]/60 sm:w-auto"
              >
                <IconeWhatsapp />
                Prefiro falar no WhatsApp
              </a>
            </div>
            <p className="mt-4 text-sm text-[#252A33]/60">
              Sem cadastro, sem custo para responder. Você escolhe o horário no fim.
            </p>
          </div>
          <div className="rounded-3xl border border-[#252A33]/10 bg-white p-6 shadow-sm">
            <Prova numeros={numeros} />
            <p className="mt-5 border-t border-[#252A33]/10 pt-5 text-sm leading-relaxed text-[#252A33]/70">
              Números do próprio centro cirúrgico do Instituto, contados a partir das cirurgias finalizadas
              {numeros?.desdeAno ? ` desde ${numeros.desdeAno}` : ''}. A estimativa que você vai receber sai daí, não
              de tabela de internet.
            </p>
          </div>
        </div>
      </section>

      {/* ── Painel da triagem ────────────────────────────────────────────── */}
      <section ref={painel} className="scroll-mt-20 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
          <div className="rounded-3xl border border-[#252A33]/12 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(37,42,51,0.45)] sm:p-8">
            {etapa === 'inicio' ? (
              <div className="text-center">
                <h2 className="font-heading text-2xl font-semibold sm:text-3xl">Vamos entender o seu caso</h2>
                <p className="mx-auto mt-3 max-w-lg text-[#252A33]/70">
                  Cinco perguntas rápidas. Nenhuma delas pede documento, e você só digita nome e WhatsApp no final,
                  para a equipe segurar o seu horário.
                </p>
                <Botao onClick={comecar} className="mt-6 w-full sm:w-auto">
                  Começar agora
                </Botao>
              </div>
            ) : null}

            {etapa === 'triagem' && pergunta ? (
              <div>
                <div className="mb-6 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={voltar}
                    className="rounded-full border border-[#252A33]/15 px-3 py-1 text-sm text-[#252A33]/70 hover:border-[#252A33]/50"
                  >
                    Voltar
                  </button>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#252A33]/10">
                    <div
                      className="h-full rounded-full bg-[#252A33] transition-all"
                      style={{ width: `${Math.round(((indice + 1) / Math.max(visiveis.length, 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm tabular-nums text-[#252A33]/60">
                    {indice + 1}/{visiveis.length}
                  </span>
                </div>

                <h2 className="font-heading text-2xl font-semibold leading-tight sm:text-3xl">{pergunta.titulo}</h2>
                {pergunta.ajuda ? <p className="mt-2 text-[#252A33]/65">{pergunta.ajuda}</p> : null}

                <div
                  className={
                    pergunta.visual
                      ? 'mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4'
                      : 'mt-6 grid gap-3'
                  }
                >
                  {pergunta.opcoes.map((opcao) => {
                    const marcada = respostas[pergunta.id] === opcao.valor
                    return (
                      <button
                        key={opcao.valor}
                        type="button"
                        onClick={() => responder(pergunta.id, opcao.valor)}
                        className={`group rounded-2xl border p-4 text-left transition ${
                          marcada
                            ? 'border-[#252A33] bg-[#252A33]/5'
                            : 'border-[#252A33]/15 hover:border-[#252A33]/50 hover:bg-[#DCDBD1]/25'
                        }`}
                      >
                        {pergunta.visual ? (
                          <span className="mb-2 flex justify-center">
                            <EscalaCapilar grau={opcao.valor} tamanho={66} />
                          </span>
                        ) : null}
                        <span className="block font-semibold leading-tight">{opcao.rotulo}</span>
                        {opcao.detalhe ? (
                          <span className="mt-1 block text-sm leading-snug text-[#252A33]/60">{opcao.detalhe}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {etapa === 'resultado' ? (
              <div>
                <button
                  type="button"
                  onClick={voltar}
                  className="mb-6 rounded-full border border-[#252A33]/15 px-3 py-1 text-sm text-[#252A33]/70 hover:border-[#252A33]/50"
                >
                  Voltar
                </button>

                {estimativa ? (
                  <div className="rounded-2xl bg-[#252A33] p-6 text-white sm:p-8">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/60">Sua estimativa</p>
                    <p className="mt-3 font-heading text-5xl font-semibold leading-none">
                      {numeroBr(estimativa.esperado)}
                    </p>
                    <p className="mt-1 text-base font-normal text-white/70">unidades foliculares</p>
                    <p className="mt-3 text-sm leading-relaxed text-white/75">
                      Faixa de {numeroBr(Math.min(estimativa.minimo, estimativa.esperado))} a{' '}
                      {numeroBr(Math.max(estimativa.maximo, estimativa.esperado))}, calculada sobre{' '}
                      {numeroBr(estimativa.amostra)} cirurgias já realizadas no Instituto. O número final depende do que
                      a sua área doadora comporta, e isso só a avaliação médica define.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#DCDBD1]/50 p-6">
                    <h2 className="font-heading text-2xl font-semibold">Seu caso pede uma avaliação presencial</h2>
                    <p className="mt-2 text-[#252A33]/75">
                      Pelo que você respondeu, o caminho é examinar o seu couro cabeludo antes de falar em número de
                      fios ou em técnica.
                    </p>
                  </div>
                )}

                {querAgenda ? (
                  <div className="mt-8">
                    <h3 className="font-heading text-xl font-semibold">Escolha o horário da sua avaliação</h3>
                    <p className="mt-1 text-sm text-[#252A33]/65">
                      {carregandoHorarios
                        ? 'Consultando a agenda...'
                        : vagasNaSemana > 0
                          ? `${vagasNaSemana} ${vagasNaSemana === 1 ? 'horário livre' : 'horários livres'} na primeira semana com vaga. Os horários vêm da agenda da clínica e mudam ao longo do dia.`
                          : 'Os próximos horários abertos estão logo abaixo.'}
                    </p>

                    {unidades.length > 1 ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {unidades.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => setUnidadeId(u.id)}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                              u.id === unidadeId
                                ? 'border-[#252A33] bg-[#252A33] text-white'
                                : 'border-[#252A33]/20 hover:border-[#252A33]/60'
                            }`}
                          >
                            {u.rotulo}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {profissionais.length > 1 ? (
                      <div className="mt-5">
                        <p className="mb-2 text-sm font-semibold">Com quem você quer ser atendido?</p>
                        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPrestadorEscolhido('')
                              setSlotEscolhido('')
                            }}
                            className={`min-w-[132px] shrink-0 rounded-2xl border px-3 py-2 text-left transition ${
                              prestadorEscolhido === ''
                                ? 'border-[#252A33] bg-[#252A33] text-white'
                                : 'border-[#252A33]/15 hover:border-[#252A33]/50'
                            }`}
                          >
                            <span className="block text-sm font-semibold">Primeira vaga</span>
                            <span className="block text-[11px] opacity-70">com qualquer profissional</span>
                          </button>
                          {profissionais.map((p) => {
                            const marcado = p.codigoPrestador === prestadorEscolhido
                            return (
                              <button
                                key={p.codigoPrestador}
                                type="button"
                                onClick={() => {
                                  setPrestadorEscolhido(p.codigoPrestador)
                                  setSlotEscolhido('')
                                }}
                                className={`min-w-[150px] shrink-0 rounded-2xl border px-3 py-2 text-left transition ${
                                  marcado
                                    ? 'border-[#252A33] bg-[#252A33] text-white'
                                    : 'border-[#252A33]/15 hover:border-[#252A33]/50'
                                } ${p.vagas === 0 ? 'opacity-60' : ''}`}
                              >
                                <span className="block text-sm font-semibold">{primeiroNome(p.nome)}</span>
                                <span className="block text-[11px] opacity-70">
                                  {p.vagas === 0 ? 'sem vaga nas próximas semanas' : `a partir de ${quandoCurto(p.proxima)}`}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                        {profissionalEscolhido ? (
                          <p className="rounded-xl bg-[#DCDBD1]/40 px-4 py-3 text-sm">
                            <strong>{profissionalEscolhido.nome}</strong>
                            {profissionalEscolhido.credencial ? (
                              <span className="text-[#252A33]/70"> · {profissionalEscolhido.credencial}</span>
                            ) : null}
                            {profissionalEscolhido.descricao ? (
                              <span className="mt-1 block text-[#252A33]/70">{profissionalEscolhido.descricao}</span>
                            ) : null}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {dias.length === 0 && !carregandoHorarios ? (
                      <div className="mt-5 rounded-2xl border border-[#252A33]/15 p-5">
                        {prestadorEscolhido && alternativa ? (
                          <>
                            <p className="text-[#252A33]/75">
                              {profissionalEscolhido?.nome ?? 'Esse profissional'} não tem horário aberto nas próximas
                              semanas. {alternativa.nome} atende o mesmo caso e tem vaga {quandoCurto(alternativa.proxima)}.
                            </p>
                            <Botao
                              variante="contorno"
                              className="mt-4 w-full sm:w-auto"
                              onClick={() => {
                                setPrestadorEscolhido(alternativa.codigoPrestador)
                                setSlotEscolhido('')
                              }}
                            >
                              Ver a agenda de {primeiroNome(alternativa.nome)}
                            </Botao>
                          </>
                        ) : (
                          <p className="text-[#252A33]/75">
                            A agenda desta unidade está fechada no momento. Fale com a equipe pelo WhatsApp que a gente
                            encaixa você na próxima abertura.
                          </p>
                        )}
                        <a
                          href={`https://wa.me/${WHATSAPP_CLINICA}`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#128C4A] px-5 py-3 text-sm font-semibold text-white"
                        >
                          <IconeWhatsapp className="h-4 w-4" />
                          Falar com a equipe
                        </a>
                      </div>
                    ) : null}

                    {dias.length > 0 ? (
                      <>
                        <div className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                          {dias.map((d) => {
                            const { semana, data } = rotuloDoDia(d.dia)
                            const marcado = d.dia === diaEscolhido
                            return (
                              <button
                                key={d.dia}
                                type="button"
                                onClick={() => {
                                  setDiaEscolhido(d.dia)
                                  setSlotEscolhido('')
                                }}
                                className={`min-w-[74px] shrink-0 rounded-2xl border px-3 py-2 text-center transition ${
                                  marcado
                                    ? 'border-[#252A33] bg-[#252A33] text-white'
                                    : 'border-[#252A33]/15 hover:border-[#252A33]/50'
                                }`}
                              >
                                <span className="block text-xs uppercase tracking-wide opacity-70">{semana}</span>
                                <span className="block font-heading text-lg font-semibold">{data}</span>
                                <span className="block text-[11px] opacity-70">
                                  {d.horarios.length} {d.horarios.length === 1 ? 'vaga' : 'vagas'}
                                </span>
                              </button>
                            )
                          })}
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                          {horariosDoDia.map((h) => {
                            const marcado = h.slotAt === slotEscolhido
                            return (
                              <button
                                key={h.slotAt}
                                type="button"
                                onClick={() => setSlotEscolhido(h.slotAt)}
                                className={`rounded-xl border px-2 py-2.5 text-center transition ${
                                  marcado
                                    ? 'border-[#252A33] bg-[#252A33] text-white'
                                    : 'border-[#252A33]/15 hover:border-[#252A33]/50'
                                }`}
                              >
                                <span className="block text-sm font-semibold">{horaDoSlot(h.slotAt)}</span>
                                {h.profissional ? (
                                  <span className={`block text-[11px] leading-tight ${marcado ? 'text-white/70' : 'text-[#252A33]/55'}`}>
                                    {primeiroNome(h.profissional)}
                                  </span>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>

                        {unidade?.endereco ? (
                          <p className="mt-3 text-sm text-[#252A33]/60">{unidade.endereco}</p>
                        ) : null}

                        <Botao onClick={irParaContato} desabilitado={!slotEscolhido} className="mt-6 w-full">
                          {slotEscolhido
                            ? `Reservar ${horaDoSlot(slotEscolhido)} de ${rotuloDoDia(diaEscolhido).data}`
                            : 'Escolha um horário acima'}
                        </Botao>
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-8 rounded-2xl border border-[#252A33]/15 p-6">
                    <h3 className="font-heading text-xl font-semibold">Sem pressa, e sem compromisso</h3>
                    <p className="mt-2 text-[#252A33]/75">
                      Você disse que ainda está pesquisando, então não vamos ocupar um horário da agenda médica agora.
                      Deixe o seu contato que a nossa equipe te manda a orientação do seu caso pelo WhatsApp, e quando
                      você quiser marcar, a gente marca.
                    </p>
                    <Botao onClick={irParaContato} variante="contorno" className="mt-5 w-full sm:w-auto">
                      Receber orientação no WhatsApp
                    </Botao>
                  </div>
                )}
              </div>
            ) : null}

            {etapa === 'contato' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void enviar()
                }}
              >
                <button
                  type="button"
                  onClick={() => setEtapa('resultado')}
                  className="mb-6 rounded-full border border-[#252A33]/15 px-3 py-1 text-sm text-[#252A33]/70 hover:border-[#252A33]/50"
                >
                  Voltar
                </button>

                <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
                  {querAgenda && slotEscolhido ? 'Falta só segurar o seu horário' : 'Para onde mandamos a orientação?'}
                </h2>
                {querAgenda && slotEscolhido ? (
                  <p className="mt-2 rounded-xl bg-[#DCDBD1]/50 px-4 py-3 text-sm font-semibold">
                    {dataPorExtenso(slotEscolhido)} · {unidade?.rotulo ?? 'Maringá'}
                    {horarioEscolhido?.profissional ? (
                      <span className="block font-normal text-[#252A33]/70">com {horarioEscolhido.profissional}</span>
                    ) : null}
                  </p>
                ) : null}

                <div className="mt-6 grid gap-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">Nome completo</span>
                    <input
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      autoComplete="name"
                      placeholder="Como está no seu documento"
                      className="w-full rounded-xl border border-[#252A33]/20 px-4 py-3 text-base outline-none focus:border-[#252A33]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold">WhatsApp com DDD</span>
                    <input
                      value={telefone}
                      onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="(44) 99999-9999"
                      className="w-full rounded-xl border border-[#252A33]/20 px-4 py-3 text-base outline-none focus:border-[#252A33]"
                    />
                  </label>

                  {/* Armadilha: fica fora da vista e fora do foco. Gente não preenche. */}
                  <input
                    value={sobrenome}
                    onChange={(e) => setSobrenome(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
                  />

                  <label className="flex items-start gap-3 text-sm text-[#252A33]/75">
                    <input
                      type="checkbox"
                      checked={aceite}
                      onChange={(e) => setAceite(e.target.checked)}
                      className="mt-1 h-4 w-4 accent-[#252A33]"
                    />
                    <span>
                      Autorizo o Instituto Lorena Visentainer a entrar em contato comigo por WhatsApp e telefone sobre
                      esta avaliação.
                    </span>
                  </label>
                </div>

                {erro ? (
                  <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{erro}</p>
                ) : null}

                <Botao tipo="submit" desabilitado={enviando} className="mt-6 w-full">
                  {enviando
                    ? 'Enviando...'
                    : querAgenda && slotEscolhido
                      ? 'Confirmar meu pré-agendamento'
                      : 'Quero receber a orientação'}
                </Botao>
                <p className="mt-3 text-center text-xs text-[#252A33]/55">
                  Seus dados ficam com a clínica e não são vendidos nem compartilhados.
                </p>
              </form>
            ) : null}

            {etapa === 'pronto' && resultado ? (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#128C4A]/12">
                  <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#128C4A]" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M4 12.5 9.5 18 20 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h2 className="mt-4 font-heading text-2xl font-semibold sm:text-3xl">
                  {resultado.slotAt ? 'Horário reservado no seu nome' : 'Recebemos o seu contato'}
                </h2>

                {resultado.slotAt ? (
                  <p className="mx-auto mt-3 max-w-md text-[#252A33]/75">
                    {dataPorExtenso(resultado.slotAt)} · {unidade?.rotulo ?? 'Maringá'}
                    {resultado.profissional ? (
                      <span className="block font-medium text-[#252A33]">com {resultado.profissional}</span>
                    ) : null}
                    <span className="mt-1 block text-sm">
                      Protocolo <strong className="font-heading">{resultado.protocolo}</strong>. A equipe confirma com
                      você pelo WhatsApp e passa as orientações da consulta.
                    </span>
                  </p>
                ) : (
                  <p className="mx-auto mt-3 max-w-md text-[#252A33]/75">
                    A nossa equipe vai te chamar no WhatsApp com a orientação do seu caso. Protocolo{' '}
                    <strong className="font-heading">{resultado.protocolo}</strong>.
                  </p>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <a
                    href={resultado.whatsappUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#128C4A] px-6 py-4 text-base font-semibold text-white hover:bg-[#0f7a40]"
                  >
                    <IconeWhatsapp />
                    Falar agora no WhatsApp
                  </a>
                  {resultado.slotAt ? (
                    <a
                      href={linkGoogleAgenda(resultado.slotAt, unidade)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center justify-center rounded-full border border-[#252A33]/25 px-6 py-4 text-base font-semibold hover:border-[#252A33]/60"
                    >
                      Salvar no meu calendário
                    </a>
                  ) : null}
                </div>

                {resultado.slotAt && unidade?.endereco ? (
                  <p className="mt-6 text-sm text-[#252A33]/65">{unidade.endereco}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* ── O que acontece depois ────────────────────────────────────────── */}
      <section className="bg-[#DCDBD1]/40 py-12">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">Como funciona daqui em diante</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                titulo: '1. Você reserva o horário',
                texto: 'A vaga fica no seu nome assim que você confirma aqui na página.',
              },
              {
                titulo: '2. A equipe confirma',
                texto: 'Falamos com você pelo WhatsApp para confirmar a data e explicar como é a consulta.',
              },
              {
                titulo: '3. Avaliação com exame',
                texto:
                  'Análise do couro cabeludo, contagem de área doadora e o plano do seu caso, com valores na mesa.',
              },
            ].map((passo) => (
              <li key={passo.titulo} className="rounded-2xl bg-white p-5">
                <h3 className="font-heading text-lg font-semibold">{passo.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#252A33]/70">{passo.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Método ───────────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-16">
        <div className="mx-auto grid max-w-5xl gap-8 px-4 lg:grid-cols-2">
          <div>
            <h2 className="font-heading text-2xl font-semibold sm:text-3xl">
              Transplante Capilar Regenerativo®
            </h2>
            <p className="mt-4 leading-relaxed text-[#252A33]/75">
              É a técnica FUE somada, ainda no intraoperatório, a um tratamento com células autólogas. Além dos fios
              transplantados, os fios nativos passam por regeneração. O método é marca registrada da Dra. Lorena
              Visentainer e é o que a clínica faz de diferente.
            </p>
            <ul className="mt-6 grid gap-3 text-[#252A33]/80">
              {[
                'Transplante masculino e feminino, este último sem raspar a cabeça',
                'Sobrancelhas com a técnica Brow FUE Long Hair',
                'Barba, para preencher falhas e fechar o desenho',
                'Tratamentos sem cirurgia: terapia regenerativa, eletroporação sem agulhas e laser',
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#252A33]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl bg-[#252A33] p-6 text-white sm:p-8">
            <h3 className="font-heading text-xl font-semibold">Dra. Lorena Visentainer</h3>
            <p className="mt-1 text-sm text-white/60">CRM 33717 | RQE 27798 · dermatologista</p>
            <ul className="mt-5 grid gap-3 text-sm leading-relaxed text-white/80">
              {[
                'Medicina pela UEL, residência em dermatologia e mestrado na UNICAMP, tricologia pela USP',
                'Membro titular da SBD e membro da ISHRS e da ABCRC',
                'Fundadora do Hair Academy, pós-graduação para médicos, e palestrante internacional',
                'Autora do primeiro livro de transplante FUE do Brasil e do primeiro livro de transplante de sobrancelhas do mundo',
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#DCDBD1]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Depoimentos ─────────────────────────────────────────────────── */}
      <section className="border-y border-[#252A33]/10 bg-[#DCDBD1]/30 py-12">
        <div className="mx-auto max-w-5xl px-4">
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">Quem já passou por aqui</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              {
                texto:
                  'Excelente atendimento, aconchegante e acolhedor. Fiz meu procedimento há uma semana e a recuperação está ótima. Agradeço a todos os profissionais envolvidos.',
                autor: 'Eneida Peixoto',
                nota: 'Paciente',
              },
              {
                texto:
                  'A Dra. Lorena figura entre os grandes nomes do transplante capilar no país, aliando competência técnica e senso estético. Sair do país é desnecessário quando se tem esse nível tão perto.',
                autor: 'Rafael Januário Rocha',
                nota: 'Acompanhante de paciente',
              },
              {
                texto: 'Melhor tratamento capilar do Brasil. Dra. Lorena maravilhosa.',
                autor: 'Salsicha',
                nota: 'Apresentador',
              },
            ].map((d) => (
              <figure key={d.autor} className="rounded-2xl bg-white p-5">
                <blockquote className="text-sm leading-relaxed text-[#252A33]/80">{d.texto}</blockquote>
                <figcaption className="mt-4 text-sm font-semibold">
                  {d.autor}
                  <span className="block text-xs font-normal text-[#252A33]/55">{d.nota}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-4 text-xs text-[#252A33]/55">
            Depoimentos publicados no site oficial do Instituto. Resultados variam de paciente para paciente.
          </p>
        </div>
      </section>

      {/* ── Perguntas ───────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-3xl px-4">
          <h2 className="font-heading text-2xl font-semibold sm:text-3xl">Perguntas que todo mundo faz</h2>
          <div className="mt-6 divide-y divide-[#252A33]/10">
            {[
              {
                p: 'O que acontece depois que eu reservo o horário?',
                r: 'A vaga fica bloqueada no seu nome e a nossa equipe confirma com você pelo WhatsApp. Enquanto ninguém confirma, ninguém mais consegue marcar aquele horário.',
              },
              {
                p: 'Quanto custa a avaliação?',
                r: 'A avaliação é uma consulta médica particular, com exame do couro cabeludo. A equipe informa o valor no contato de confirmação, junto com as formas de pagamento.',
              },
              {
                p: 'Preciso raspar a cabeça?',
                r: 'No caso feminino, não. O Instituto faz transplante feminino sem raspagem. No masculino, a conduta é definida na avaliação.',
              },
              {
                p: 'Dói?',
                r: 'O procedimento é feito com anestesia local, e o desconforto maior costuma ser nas primeiras horas. Todo o cuidado do pós é explicado antes de você decidir.',
              },
              {
                p: 'Sou de outra cidade. Como funciona?',
                r: 'Boa parte dos nossos pacientes vem de fora. Dá para fazer a primeira conversa por consulta online e concentrar exame e procedimento na mesma viagem.',
              },
              {
                p: 'Em quanto tempo aparece resultado?',
                r: 'Os fios transplantados crescem ao longo dos meses seguintes, e o resultado se consolida por volta de um ano. O acompanhamento faz parte do tratamento.',
              },
            ].map((item) => (
              <details key={item.p} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {item.p}
                  <span className="text-2xl leading-none text-[#252A33]/40 group-open:rotate-45 transition">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-[#252A33]/75">{item.r}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Rodapé ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#252A33]/10 bg-white py-10 pb-28 sm:pb-10">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 sm:grid-cols-2">
          <div>
            <img src="/marca/lorena.svg" alt="Instituto Lorena Visentainer" className="h-10 w-auto" />
            <p className="mt-4 text-sm leading-relaxed text-[#252A33]/70">
              Av. Nóbrega, 814 · Zona 4 · Maringá/PR · 87014-180
              <span className="block">Unidade em Londrina/PR</span>
            </p>
          </div>
          <div className="text-sm text-[#252A33]/70">
            <p>
              WhatsApp e telefone:{' '}
              <a className="font-semibold text-[#252A33]" href={`https://wa.me/${WHATSAPP_CLINICA}`}>
                {TELEFONE_VISIVEL}
              </a>
            </p>
            <p className="mt-1">
              E-mail:{' '}
              <a className="font-semibold text-[#252A33]" href="mailto:atendimento@lorenavisentainer.com.br">
                atendimento@lorenavisentainer.com.br
              </a>
            </p>
            <p className="mt-4 text-xs leading-relaxed text-[#252A33]/55">
              Responsável técnica: Dra. Lorena Visentainer, CRM 33717 | RQE 27798. Esta página é informativa e não
              substitui a consulta médica. Resultados variam conforme o caso.
            </p>
          </div>
        </div>
      </footer>

      {/* ── Barra fixa no celular ───────────────────────────────────────── */}
      {etapa !== 'pronto' ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#252A33]/10 bg-white/95 p-3 backdrop-blur sm:hidden">
          <Botao
            onClick={() => {
              if (etapa === 'inicio') comecar()
              else rolarParaPainel()
            }}
            className="w-full"
          >
            {etapa === 'inicio' ? 'Começar a minha avaliação' : 'Voltar para a minha avaliação'}
          </Botao>
        </div>
      ) : null}
    </div>
  )
}

export default ConsultaLandingPage
