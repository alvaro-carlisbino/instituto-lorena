import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { EscalaCapilar } from '@/components/landing/EscalaCapilar'
import { capturarAtribuicaoDoNavegador, type AtribuicaoLanding } from '@/lib/atribuicaoLanding'
import { iniciarPixelMeta, pixelLead, pixelTriagemCompleta } from '@/lib/pixelMeta'
import {
  escalaDoGrau,
  mascararTelefone,
  nomeValido,
  perguntasVisiveis,
  podeReservarHorario,
  telefoneValido,
  temEstimativa,
  triagemCompleta,
  type PerguntaTriagem,
  type RespostasTriagem,
} from '@/lib/triagemConsulta'
import {
  ErroAgenda,
  carregarEstimativa,
  carregarNumerosPublicos,
  enviarPreAgendamento,
  registrarEventoLanding,
  type EstimativaPublica,
  type NumerosPublicos,
  type RespostaPreAgendamento,
} from '@/services/agendaPublica'

/**
 * Landing /consulta: qualifica em três toques e entrega a pessoa no WhatsApp já
 * aquecida, com a clínica tendo falado primeiro.
 *
 * Por que ela existe: a clínica fecha 0,4% dos leads. Todo mundo entra pela mesma
 * porta do WhatsApp e a atendente descobre a mão, uma pergunta por vez, quem tem
 * indicação e quem está passeando. Aqui a pessoa se qualifica sozinha e a atendente
 * pega a conversa sabendo do que falar.
 *
 * Quatro decisões de conversão que valem mais que o layout:
 *  1. A primeira pergunta está NA DOBRA. Não há tela de boas-vindas, não há botão
 *     "começar": quem chega do anúncio já responde.
 *  2. Nenhuma digitação até o fim. Três perguntas de um toque, com desenho (duas para
 *     sobrancelha e barba). Eram cinco até 27/ago/2026.
 *  3. A recompensa vem antes do pedido: o número de folículos aparece ACIMA dos campos
 *     de nome e WhatsApp, na mesma tela. O quiz do Tricopill morreu por fazer o
 *     contrário, e uma tela só para o formulário era um clique que não perguntava nada.
 *  4. A conversa começa SOZINHA. Ao enviar, a Sofia manda a primeira mensagem no
 *     WhatsApp da pessoa (`crm-agendar-publico`), e o botão desta tela abre a conversa
 *     já com o texto lá dentro. Chat vazio é onde o lead pago morre: a pessoa não sabe
 *     o que escrever, fecha e some.
 *
 * NÃO se marca horário aqui, e a página não vende: sem "como funciona", sem biografia
 * longa, sem FAQ. Quem convence é a conversa no WhatsApp (decisões do Álvaro e do
 * Fabricio, 27/ago/2026). O backend continua sabendo reservar slot, o payload aceita
 * `slotAt`, só que esta tela não oferece mais.
 *
 * A página é da CLÍNICA e roda deslogada. Nada aqui pode encostar no Tricopill.
 */

const WHATSAPP_CLINICA = '5544991493656'
const TELEFONE_VISIVEL = '(44) 99149-3656'

/**
 * A frase é a ETIQUETA desta porta, não é enfeite de copy.
 *
 * `ctwa_aberturas` guarda o trecho "vim pelo site e quero falar sobre a consulta
 * capilar" com canal `landing`, e o carimbo (`crm_ctwa_carimbar`, cron de 15 em
 * 15 min) usa a PRIMEIRA mensagem do lead para dizer de onde ele veio. Mudar o
 * texto aqui sem mudar a linha lá devolve a landing para o balde de origem
 * desconhecida, onde estavam 244 conversas até 01/set/2026.
 *
 * A frase dizia "avaliação capilar" até 03/set/2026. O trecho antigo continua
 * ativo na tabela: quem abriu o WhatsApp com o link velho e só responder semana
 * que vem ainda precisa ser carimbado como landing.
 *
 * Por isso os quatro botões da página usam o mesmo link: os dois do topo e do
 * rodapé abriam o WhatsApp em branco, e quem saía por eles chegava anônimo.
 */
const MENSAGEM_WHATSAPP = 'Olá! Vim pelo site e quero falar sobre a consulta capilar.'
const LINK_WHATSAPP = `https://wa.me/${WHATSAPP_CLINICA}?text=${encodeURIComponent(MENSAGEM_WHATSAPP)}`

const numeroBr = (n: number) => n.toLocaleString('pt-BR')

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
          href={LINK_WHATSAPP}
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

/**
 * "Quem somos", no desenho do site oficial: números grandes da casa inteira em cima
 * (a história da Dra. Lorena, não só o centro cirúrgico atual) e, embaixo, o que o
 * próprio sistema conta desde 2025. O RPC começou a contar em 2025, então mostrar
 * SÓ ele fazia a landing parecer uma clínica de 190 cirurgias, quando a marca
 * publica mais de 3.000. Os dois números convivem: um é a marca, o outro é auditável.
 */
const NUMEROS_DA_CASA = [
  { valor: '+3.000', rotulo: 'transplantes realizados' },
  { valor: '+2 milhões', rotulo: 'de fios implantados' },
  { valor: '+1.000', rotulo: 'pacientes satisfeitos' },
] as const

function QuemSomos({ numeros }: { numeros: NumerosPublicos | null }) {
  const temContagem = Boolean(numeros && numeros.cirurgiasRealizadas > 0)
  return (
    <section className="relative overflow-hidden bg-[#DCDBD1] py-12 sm:py-16">
      {/* A curva do site oficial, só decoração. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -right-10 top-0 h-full w-[46%] text-white/70"
        viewBox="0 0 400 400"
        fill="none"
        preserveAspectRatio="none"
      >
        <path d="M400 -20 C 250 60, 180 180, 210 420" stroke="currentColor" strokeWidth="2" />
      </svg>
      <div className="relative mx-auto max-w-5xl px-4">
        <h2 className="font-heading text-4xl font-bold leading-none tracking-tight sm:text-5xl">Quem somos</h2>
        <dl className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {NUMEROS_DA_CASA.map((n) => (
            <div key={n.rotulo} className="text-center sm:text-left">
              <dd className="font-heading text-4xl font-bold leading-none tracking-tight sm:text-5xl">{n.valor}</dd>
              <dt className="mt-2 text-sm text-[#252A33]/75 sm:text-base">{n.rotulo}</dt>
            </div>
          ))}
        </dl>
        <div className="mt-8 grid gap-4 border-t border-[#252A33]/15 pt-6 sm:grid-cols-[1.1fr_0.9fr] sm:gap-8">
          <p className="text-sm leading-relaxed text-[#252A33]/75">
            A Dra. Lorena Visentainer (CRM 33717 | RQE 27798) é dermatologista, membro da SBD e da ISHRS, criou o
            Transplante Capilar Regenerativo® e escreveu o primeiro livro de transplante FUE do Brasil.
          </p>
          {temContagem && numeros ? (
            <p className="text-sm leading-relaxed text-[#252A33]/75">
              Só no centro cirúrgico atual, desde {numeros.desdeAno}:{' '}
              <strong className="font-semibold text-[#252A33]">{numeroBr(numeros.cirurgiasRealizadas)} cirurgias</strong> e{' '}
              <strong className="font-semibold text-[#252A33]">{numeroBr(numeros.foliculosImplantados)} folículos</strong>,
              contados um a um pelo próprio sistema. É dessa base que sai a sua estimativa.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

// ── Página ───────────────────────────────────────────────────────────────────

/**
 * Três telas, e a primeira já está na dobra.
 *
 * 'inicio' (um botão "começar" antes da 1ª pergunta) e 'contato' (o formulário numa
 * tela só dele) foram removidos em 27/ago/2026: eram dois cliques que não perguntavam
 * nada. A estimativa e os campos de nome/WhatsApp agora dividem a tela 'resultado',
 * com o número em cima e o pedido embaixo, que é a ordem que importa.
 */
type Etapa = 'triagem' | 'resultado' | 'pronto'

export function ConsultaLandingPage() {
  const [etapa, setEtapa] = useState<Etapa>('triagem')
  const [indice, setIndice] = useState(0)
  const [respostas, setRespostas] = useState<RespostasTriagem>({})

  const [numeros, setNumeros] = useState<NumerosPublicos | null>(null)
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
  /**
   * Quantas perguntas a pessoa vai responder. Antes de o objetivo estar escolhido,
   * `perguntasVisiveis` devolve 2 (o grau depende do objetivo) e a barra saltava de
   * 1/2 para 2/3 no primeiro toque, que é o contador andando para trás na cara dela.
   * Até lá vale o pior caso, 3.
   */
  const totalPassos = respostas.objetivo ? visiveis.length : 3
  /** Quem NÃO respondeu "só pesquisando". Muda o texto, não o caminho: todo mundo termina no WhatsApp. */
  const querResolver = podeReservarHorario(respostas)

  // Título, descrição e rastro da campanha. O index.html é do CRM interno, e sem isto
  // a aba de quem vem do anúncio diz "Instituto Lorena CRM · INTERNO".
  useEffect(() => {
    const anterior = document.title
    document.title = 'Consulta capilar · Instituto Lorena Visentainer'
    const meta = document.querySelector('meta[name="description"]')
    const descricaoAnterior = meta?.getAttribute('content') ?? ''
    meta?.setAttribute(
      'content',
      'Descubra em 2 minutos quantas unidades foliculares o seu caso pede e fale com a equipe do Instituto Lorena Visentainer no WhatsApp.',
    )
    rastro.current = capturarAtribuicaoDoNavegador()
    registrarEventoLanding('landing_view', rastro.current)
    // O pixel só existe nesta tela. Ver o comentário em lib/pixelMeta.ts.
    const pararPixel = iniciarPixelMeta()
    return () => {
      pararPixel()
      document.title = anterior
      if (meta && descricaoAnterior) meta.setAttribute('content', descricaoAnterior)
    }
  }, [])

  useEffect(() => {
    void carregarNumerosPublicos().then(setNumeros)
  }, [])

  const rolarParaPainel = useCallback(() => {
    window.requestAnimationFrame(() => {
      painel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

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
      // Chegar aqui é ver a estimativa E o formulário: 'landing_triagem' passou a ser
      // o passo do meio inteiro. Não há mais tela de contato para medir à parte.
      registrarEventoLanding('landing_triagem', { ...rastro.current, passo: novas.urgencia ?? '' })
      pixelTriagemCompleta(novas.objetivo)
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
    if (indice > 0) setIndice(indice - 1)
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
        unidade: 'maringa',
        slotAt: null,
        codigoPrestador: null,
        respostas: respostas as Record<string, string>,
        atribuicao: rastro.current.atribuicao,
        sessionId: rastro.current.sessao,
        sobrenome,
      })
      setResultado(r)
      setEtapa('pronto')
      // É este evento que o anúncio compra. Vai depois do POST dar certo: disparar
      // no clique contaria tentativa, e a Meta otimizaria para quem clica em enviar.
      pixelLead(r.protocolo)
      rolarParaPainel()
    } catch (e) {
      const msg = e instanceof ErroAgenda ? e.message : 'Não consegui concluir agora. Tente de novo.'
      setErro(msg)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-dvh bg-white text-[#252A33] antialiased">
      <Cabecalho />

      {/* ── Dobra: a primeira pergunta já está aqui ──────────────────────── */}
      <section
        ref={painel}
        className="scroll-mt-16 border-b border-[#252A33]/10 bg-gradient-to-b from-white to-[#DCDBD1]/40"
      >
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start lg:gap-12">
          {/* No celular fica só título e uma linha acima do cartão: a primeira
              pergunta tem de aparecer sem rolar. O resto desce para depois dele. */}
          <div className="lg:sticky lg:top-24">
            <p className="mb-3 inline-flex rounded-full bg-[#252A33]/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-[#252A33]/70">
              Transplante Capilar Regenerativo®
            </p>
            <h1 className="font-heading text-[28px] font-semibold leading-[1.1] sm:text-4xl lg:text-5xl">
              Descubra o que o seu caso pede em 3 perguntas.
            </h1>
            <p className="mt-3 leading-relaxed text-[#252A33]/75 lg:mt-4 lg:text-lg">
              A estimativa sai das cirurgias feitas aqui dentro, e a equipe te chama no WhatsApp na hora.
            </p>
            <div className="mt-5 hidden lg:block">
              <p className="text-sm text-[#252A33]/60">Sem cadastro e sem custo. Você só digita nome e WhatsApp no fim.</p>
              <a
                href={LINK_WHATSAPP}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#128C4A] hover:underline"
              >
                <IconeWhatsapp className="h-4 w-4" />
                Prefiro ir direto para o WhatsApp
              </a>
            </div>
          </div>

          {/* ── Painel: pergunta, resultado ou confirmação ──────────────── */}
          <div className="rounded-3xl border border-[#252A33]/12 bg-white p-5 shadow-[0_18px_60px_-30px_rgba(37,42,51,0.45)] sm:p-7">
            {etapa === 'triagem' && pergunta ? (
              <div>
                <div className="mb-5 flex items-center gap-3">
                  {indice > 0 ? (
                    <button
                      type="button"
                      onClick={voltar}
                      className="rounded-full border border-[#252A33]/15 px-3 py-1 text-sm text-[#252A33]/70 hover:border-[#252A33]/50"
                    >
                      Voltar
                    </button>
                  ) : null}
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#252A33]/10">
                    <div
                      className="h-full rounded-full bg-[#252A33] transition-all"
                      style={{ width: `${Math.round(((indice + 1) / Math.max(totalPassos, 1)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-sm tabular-nums text-[#252A33]/60">
                    {indice + 1}/{totalPassos}
                  </span>
                </div>

                <h2 className="font-heading text-2xl font-semibold leading-tight sm:text-3xl">{pergunta.titulo}</h2>
                {pergunta.ajuda ? <p className="mt-2 text-[#252A33]/65">{pergunta.ajuda}</p> : null}

                <div className={pergunta.visual ? 'mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4' : 'mt-5 grid gap-3'}>
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

            {/* Estimativa e formulário na MESMA tela: o número em cima é a recompensa,
                e pedir o contato numa tela separada custava um clique sem perguntar nada. */}
            {etapa === 'resultado' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void enviar()
                }}
              >
                <button
                  type="button"
                  onClick={voltar}
                  className="mb-5 rounded-full border border-[#252A33]/15 px-3 py-1 text-sm text-[#252A33]/70 hover:border-[#252A33]/50"
                >
                  Voltar
                </button>

                {estimativa ? (
                  <div className="rounded-2xl bg-[#252A33] p-5 text-white sm:p-6">
                    <p className="text-xs uppercase tracking-[0.2em] text-white/60">Sua estimativa</p>
                    <p className="mt-2 font-heading text-4xl font-semibold leading-none sm:text-5xl">
                      {numeroBr(estimativa.esperado)}
                    </p>
                    <p className="mt-1 text-base font-normal text-white/70">unidades foliculares</p>
                    <p className="mt-3 text-sm leading-relaxed text-white/75">
                      Faixa de {numeroBr(Math.min(estimativa.minimo, estimativa.esperado))} a{' '}
                      {numeroBr(Math.max(estimativa.maximo, estimativa.esperado))}, calculada sobre{' '}
                      {numeroBr(estimativa.amostra)} cirurgias já realizadas no Instituto. O número final depende da
                      sua área doadora, e isso só a consulta médica define.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#DCDBD1]/50 p-5">
                    <h2 className="font-heading text-xl font-semibold">Seu caso pede uma consulta presencial</h2>
                    <p className="mt-2 text-sm text-[#252A33]/75">
                      Pelo que você respondeu, o caminho é examinar de perto antes de falar em número de fios ou em
                      técnica.
                    </p>
                  </div>
                )}

                <h2 className="mt-6 font-heading text-xl font-semibold sm:text-2xl">
                  {querResolver ? 'Para onde mandamos a sua orientação?' : 'Quer receber a orientação, sem compromisso?'}
                </h2>
                <p className="mt-1 text-sm text-[#252A33]/70">
                  Assim que você enviar, a mensagem com o seu caso cai no seu WhatsApp. É só abrir e responder.
                </p>

                <div className="mt-4 grid gap-3">
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
                      esta solicitação.
                    </span>
                  </label>
                </div>

                {erro ? (
                  <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{erro}</p>
                ) : null}

                <Botao tipo="submit" variante="whatsapp" desabilitado={enviando} className="mt-5 w-full">
                  {enviando ? 'Mandando no seu WhatsApp...' : 'Receber agora no meu WhatsApp'}
                </Botao>
                <p className="mt-3 text-center text-xs text-[#252A33]/55">
                  Seus dados ficam com a clínica e não são vendidos nem compartilhados.
                </p>
              </form>
            ) : null}

            {etapa === 'pronto' && resultado ? (
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#128C4A]/12">
                  <IconeWhatsapp className="h-7 w-7 text-[#128C4A]" />
                </div>
                <h2 className="mt-4 font-heading text-2xl font-semibold sm:text-3xl">
                  {resultado.mensagemEnviada ? 'A mensagem já está no seu WhatsApp' : 'Recebemos o seu contato'}
                </h2>

                <p className="mx-auto mt-3 max-w-md text-[#252A33]/75">
                  {resultado.mensagemEnviada ? (
                    <>
                      A Sofia acabou de te mandar a orientação do seu caso, com a sua estimativa. Abra a conversa e
                      responda por lá. A equipe continua contigo.
                    </>
                  ) : (
                    <>A nossa equipe vai te chamar no WhatsApp com a orientação do seu caso.</>
                  )}
                  <span className="mt-1 block text-sm">
                    Protocolo <strong className="font-heading">{resultado.protocolo}</strong>.
                  </span>
                </p>

                <a
                  href={resultado.whatsappUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  onClick={() => registrarEventoLanding('landing_whatsapp', rastro.current)}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#128C4A] px-6 py-4 text-base font-semibold text-white hover:bg-[#0f7a40]"
                >
                  <IconeWhatsapp />
                  {resultado.mensagemEnviada ? 'Abrir a minha conversa' : 'Falar agora no WhatsApp'}
                </a>

                {resultado.mensagemEnviada ? (
                  <p className="mt-4 text-sm text-[#252A33]/60">
                    Não chegou em um minuto? Toque no botão mesmo assim: a conversa abre no {TELEFONE_VISIVEL}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="lg:hidden">
            <p className="text-sm text-[#252A33]/60">Sem cadastro e sem custo. Você só digita nome e WhatsApp no fim.</p>
            <a
              href={LINK_WHATSAPP}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#128C4A] hover:underline"
            >
              <IconeWhatsapp className="h-4 w-4" />
              Prefiro ir direto para o WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ── Quem somos ──────────────────────────────────────────────────── */}
      <QuemSomos numeros={numeros} />

      {/* ── Depoimentos ─────────────────────────────────────────────────── */}
      <section className="border-b border-[#252A33]/10 bg-[#DCDBD1]/30 py-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                texto:
                  'Excelente atendimento, aconchegante e acolhedor. Fiz meu procedimento há uma semana e a recuperação está ótima.',
                autor: 'Eneida Peixoto',
                nota: 'Paciente',
              },
              {
                texto:
                  'A Dra. Lorena figura entre os grandes nomes do transplante capilar no país. Sair do país é desnecessário quando se tem esse nível tão perto.',
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

      {/* ── Rodapé ──────────────────────────────────────────────────────── */}
      <footer className="bg-white py-8 pb-28 sm:pb-8">
        <div className="mx-auto grid max-w-5xl gap-5 px-4 sm:grid-cols-2">
          <div>
            <img src="/marca/lorena.svg" alt="Instituto Lorena Visentainer" className="h-9 w-auto" />
            <p className="mt-3 text-sm leading-relaxed text-[#252A33]/70">
              Av. Nóbrega, 814 · Zona 4 · Maringá/PR · 87014-180
              <span className="block">Atendimento em Londrina/PR uma vez por mês</span>
            </p>
          </div>
          <div className="text-sm text-[#252A33]/70">
            <p>
              WhatsApp e telefone:{' '}
              <a className="font-semibold text-[#252A33]" href={LINK_WHATSAPP}>
                {TELEFONE_VISIVEL}
              </a>
            </p>
            <p className="mt-3 text-xs leading-relaxed text-[#252A33]/55">
              Responsável técnica: Dra. Lorena Visentainer, CRM 33717 | RQE 27798. Esta página é informativa e não
              substitui a consulta médica. Resultados variam conforme o caso.
            </p>
          </div>
        </div>
      </footer>

      {/* ── Barra fixa no celular ───────────────────────────────────────── */}
      {etapa !== 'pronto' ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#252A33]/10 bg-white/95 p-3 backdrop-blur sm:hidden">
          <Botao onClick={rolarParaPainel} className="w-full">
            {etapa === 'resultado' ? 'Voltar para o meu resultado' : `Responder as ${totalPassos} perguntas`}
          </Botao>
        </div>
      ) : null}
    </div>
  )
}

export default ConsultaLandingPage
