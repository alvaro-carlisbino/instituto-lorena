// Painel de sugestão da IA — ela propõe, você aprova, vira regra.
//
// O desenho todo gira em torno de uma coisa: a IA NÃO carimba nada sozinha. Ela devolve
// "acho que 'AGAVE MOVEIS' é Fornecedores e insumos, confiança 0,9", e só vira regra quando
// alguém marca e aprova. Classificação errada aqui contamina o DRE inteiro e ninguém percebe
// meses depois — o custo de revisar é minúsculo perto do custo de confiar.
//
// A confiança não é enfeite: ela decide o que vem MARCADO. Acima de 0,8 já vem selecionado
// porque é onde o modelo acerta quase sempre; abaixo disso vem desmarcado e com o motivo à
// vista, que é o caso em que ele está chutando num nome de pessoa física ou sigla.
//
// VARREDURA COMPLETA: são 315 pagadores diferentes sem categoria, e nenhuma requisição aguenta
// isso de uma vez (o modelo gera ~40 tokens por pagador e o gateway corta em ~150s). Então um
// clique dispara uma SEQUÊNCIA de chamadas de 36 em 36 até cobrir a lista inteira, mostrando
// quanto já andou e deixando parar no meio. As sugestões aparecem conforme chegam, e não no
// fim: quem espera cinco minutos olhando pra tela vazia acha que travou.

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, Sparkles, Square } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { saveCategoryRule, sugerirCategoriasIA, type SugestaoIA } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Acima disso vem marcado. Abaixo, o modelo está chutando e precisa de olho humano. */
const CONFIANCA_SEGURA = 0.8

/** Pagadores por chamada. Tem que bater com o que a função aguenta dentro do prazo dela. */
const PASSO = 36

export function SugestaoIAPanel({
  de,
  ate,
  onAplicado,
}: {
  de: string
  ate: string
  onAplicado: () => void
}) {
  const [sugestoes, setSugestoes] = useState<SugestaoIA[]>([])
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [descartadas, setDescartadas] = useState(0)
  const [faltaram, setFaltaram] = useState(0)
  const [busy, setBusy] = useState(false)
  const [pensando, setPensando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [pediu, setPediu] = useState(false)
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 })
  const [aplicando, setAplicando] = useState({ feitos: 0, total: 0 })
  const pararRef = useRef<AbortController | null>(null)

  // Relógio na espera. A varredura inteira leva minutos, e espera sem número na tela é
  // indistinguível de tela travada: foi exatamente o que aconteceu quando a função dava 504.
  useEffect(() => {
    if (!pensando) return
    const id = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [pensando])

  // Varredura em andamento tem que morrer junto com a tela, senão fica chamando a IA sozinha.
  useEffect(() => () => pararRef.current?.abort(), [])

  const pedir = async () => {
    const controller = new AbortController()
    pararRef.current = controller
    setBusy(true)
    setSegundos(0)
    setPensando(true)
    setSugestoes([])
    setMarcadas(new Set())
    setDescartadas(0)
    setFaltaram(0)
    setProgresso({ feitos: 0, total: 0 })

    const acumulado: SugestaoIA[] = []
    let descartadasTotal = 0
    let faltaramTotal = 0
    let offset = 0
    let total = 0
    const falhas: string[] = []

    try {
      do {
        const r = await sugerirCategoriasIA({ de, ate, limite: PASSO, offset, signal: controller.signal })
          .catch((e: unknown) => {
            // Fatia que falhou não derruba a varredura: são minutos de trabalho, e perder tudo
            // por um 429 no meio seria pior que ficar sem 36 dos 315. Segue pra próxima.
            if (controller.signal.aborted) throw e
            falhas.push(e instanceof Error ? e.message : 'falha numa fatia')
            return null
          })
        if (controller.signal.aborted) break

        if (r) {
          total = r.total
          descartadasTotal += r.descartadas
          faltaramTotal += r.faltaram
          acumulado.push(...r.sugestoes)
          // Mostra o que já chegou em vez de guardar pro fim.
          setSugestoes([...acumulado])
          // Só ACRESCENTA as novas de alta confiança: refazer o conjunto do zero apagaria o que
          // o usuário desmarcou enquanto a varredura corria.
          setMarcadas((m) => {
            const n = new Set(m)
            for (const s of r.sugestoes) if (s.confianca >= CONFIANCA_SEGURA) n.add(s.padrao)
            return n
          })
          setDescartadas(descartadasTotal)
        } else {
          // Fatia perdida inteira. No fim da lista ela é menor que o passo.
          faltaramTotal += total > 0 ? Math.max(0, Math.min(PASSO, total - offset)) : PASSO
        }
        setFaltaram(faltaramTotal)
        offset += PASSO
        setProgresso({ feitos: Math.min(offset, total), total })
        // `total` só existe depois da primeira resposta; se a primeira falhou, não há o que varrer.
      } while (offset < total && !controller.signal.aborted)

      setPediu(true)
      if (controller.signal.aborted) {
        toast.message(`Parado. ${acumulado.length} sugestão(ões) até aqui.`)
      } else if (acumulado.length === 0 && total === 0) {
        toast.message('Nada sem categoria neste período.')
      } else if (acumulado.length === 0) {
        toast.error(falhas[0] ?? 'A IA não devolveu nenhuma sugestão.')
      } else if (falhas.length > 0) {
        toast.warning(`${acumulado.length} sugestões. ${falhas.length} pedaço(s) falharam: ${falhas[0]}`)
      } else {
        toast.success(`${acumulado.length} sugestões para ${total} pagadores.`)
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        toast.error(e instanceof Error ? e.message : 'Falha ao pedir sugestão')
      } else {
        setPediu(true)
        toast.message(`Parado. ${acumulado.length} sugestão(ões) até aqui.`)
      }
    } finally {
      pararRef.current = null
      setPensando(false)
      setBusy(false)
    }
  }

  const aplicar = async () => {
    const alvo = sugestoes.filter((s) => marcadas.has(s.padrao))
    if (alvo.length === 0) return toast.error('Marque ao menos uma sugestão.')
    setBusy(true)
    setAplicando({ feitos: 0, total: alvo.length })
    let carimbadosTotal = 0
    let aplicadas = 0
    try {
      // Uma por vez de propósito: cada uma vira uma regra própria, e regra é o que dá o
      // desfazer individual lá na configuração. Um lote só seria impossível de reverter.
      for (const s of alvo) {
        const { carimbados } = await saveCategoryRule({
          pattern: s.padrao,
          categoryId: s.categoryId,
          direction: 'out',
          costCenter: s.costCenter || null,
        })
        carimbadosTotal += carimbados
        aplicadas += 1
        setAplicando({ feitos: aplicadas, total: alvo.length })
      }
      toast.success(`${aplicadas} regra(s) criada(s) · ${carimbadosTotal} lançamento(s) classificado(s).`)
      setSugestoes((a) => a.filter((s) => !marcadas.has(s.padrao)))
      setMarcadas(new Set())
      onAplicado()
    } catch (e) {
      // Falhou na 200ª de 300: as 199 já estão gravadas, e dizer só "falhou" faria o usuário
      // refazer tudo. Tira da lista o que passou e conta o que sobrou.
      const feitas = new Set(alvo.slice(0, aplicadas).map((s) => s.padrao))
      setSugestoes((a) => a.filter((s) => !feitas.has(s.padrao)))
      setMarcadas((m) => new Set([...m].filter((p) => !feitas.has(p))))
      if (aplicadas > 0) onAplicado()
      toast.error(
        `${aplicadas} de ${alvo.length} aplicadas. Parou em "${alvo[aplicadas]?.padrao ?? ''}": ${
          e instanceof Error ? e.message : 'falha ao aplicar'
        }`,
      )
    } finally {
      setAplicando({ feitos: 0, total: 0 })
      setBusy(false)
    }
  }

  const alternar = (p: string) =>
    setMarcadas((s) => {
      const n = new Set(s)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })

  const todasMarcadas = sugestoes.length > 0 && marcadas.size === sugestoes.length
  const alternarTodas = () =>
    setMarcadas(todasMarcadas ? new Set() : new Set(sugestoes.map((s) => s.padrao)))

  const somaMarcada = sugestoes
    .filter((s) => marcadas.has(s.padrao))
    .reduce((a, s) => a + s.amountCents, 0)

  const rotuloBotao = pensando
    ? progresso.total > 0
      ? `${progresso.feitos}/${progresso.total} · ${segundos}s`
      : `Começando… ${segundos}s`
    : pediu
      ? 'Sugerir de novo'
      : 'Sugerir categorias'

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-muted-foreground" /> Sugestão da IA
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void pedir()}>
            {rotuloBotao}
          </Button>
          {pensando && (
            <Button size="sm" variant="ghost" onClick={() => pararRef.current?.abort()}>
              <Square className="size-3" /> Parar
            </Button>
          )}
          {sugestoes.length > 0 && !pensando && (
            <>
              <Button size="sm" variant="ghost" onClick={alternarTodas}>
                {todasMarcadas ? 'Desmarcar todas' : 'Marcar todas'}
              </Button>
              <Button size="sm" disabled={busy || marcadas.size === 0} onClick={() => void aplicar()}>
                <Check className="size-4" />
                {aplicando.total > 0
                  ? `Aplicando ${aplicando.feitos}/${aplicando.total}`
                  : `Aplicar ${marcadas.size} (${brl(somaMarcada)})`}
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          A IA lê só o nome do pagador, quantas vezes pagou e o total. Não vai valor individual
          nem data. Ela não classifica nada sozinha: o que você marcar vira regra, e regra tem
          desfazer na Configuração.
        </p>

        {descartadas > 0 && (
          <p className="text-xs text-amber-600">
            {descartadas} sugestão(ões) foram recusadas por apontarem categoria que não existe. Se
            esse número for alto, desconfie do resto também.
          </p>
        )}

        {faltaram > 0 && (
          <p className="text-xs text-amber-600">
            {faltaram} pagador(es) ficaram sem resposta da IA. Aprove o que serve e clique em
            “Sugerir de novo”: quem já virou regra sai da fila e os que faltaram entram.
          </p>
        )}

        {sugestoes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {pensando
              ? progresso.total > 0
                ? `Varrendo ${progresso.total} pagadores, ${progresso.feitos} até agora (${segundos}s).`
                : `Levantando quem está sem categoria… ${segundos}s`
              : pediu
                ? 'Nada pendente aqui.'
                : 'Clique em “Sugerir categorias”.'}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {pensando
                ? `Varrendo: ${progresso.feitos} de ${progresso.total} pagadores (${segundos}s).`
                : `${sugestoes.length} sugestão(ões) · ${marcadas.size} marcada(s) · ${brl(somaMarcada)}.`}
            </p>
            <div className="space-y-1">
              {sugestoes.map((s) => {
                const baixa = s.confianca < CONFIANCA_SEGURA
                return (
                  <label
                    key={s.padrao}
                    className={`flex cursor-pointer flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
                      baixa ? 'border-amber-500/40 bg-amber-500/[0.04]' : 'border-border'
                    }`}
                  >
                    <Checkbox checked={marcadas.has(s.padrao)} onCheckedChange={() => alternar(s.padrao)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{s.padrao}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.qtd}× · {brl(s.amountCents)} → {s.categoria}
                        {s.costCenter ? ` · ${s.costCenter}` : ''}
                        {s.motivo ? ` · ${s.motivo}` : ''}
                      </div>
                    </div>
                    <Badge variant={baixa ? 'outline' : 'secondary'} className="shrink-0">
                      {Math.round(s.confianca * 100)}%
                    </Badge>
                  </label>
                )
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
