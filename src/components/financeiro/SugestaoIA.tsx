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

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { saveCategoryRule, sugerirCategoriasIA, type SugestaoIA } from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Acima disso vem marcado. Abaixo, o modelo está chutando e precisa de olho humano. */
const CONFIANCA_SEGURA = 0.8

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

  // Relógio na espera. São 3 chamadas ao modelo por trás de um botão só, e espera sem número na
  // tela é indistinguível de tela travada: foi o que aconteceu quando a função dava 504 calada.
  useEffect(() => {
    if (!pensando) return
    const id = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [pensando])

  const pedir = async () => {
    setBusy(true)
    setSegundos(0)
    setPensando(true)
    try {
      const r = await sugerirCategoriasIA({ de, ate })
      setSugestoes(r.sugestoes)
      setDescartadas(r.descartadas)
      setFaltaram(r.faltaram)
      setMarcadas(new Set(r.sugestoes.filter((s) => s.confianca >= CONFIANCA_SEGURA).map((s) => s.padrao)))
      setPediu(true)
      if (r.sugestoes.length === 0 && r.pagadores === 0) toast.message('Nada sem categoria neste período.')
      else if (r.sugestoes.length === 0) toast.error(r.erros[0] ?? 'A IA não devolveu nenhuma sugestão.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao pedir sugestão')
    } finally {
      setPensando(false)
      setBusy(false)
    }
  }

  const aplicar = async () => {
    const alvo = sugestoes.filter((s) => marcadas.has(s.padrao))
    if (alvo.length === 0) return toast.error('Marque ao menos uma sugestão.')
    setBusy(true)
    let total = 0
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
        total += carimbados
      }
      toast.success(`${alvo.length} regra(s) criada(s) · ${total} lançamento(s) classificado(s).`)
      setSugestoes((a) => a.filter((s) => !marcadas.has(s.padrao)))
      setMarcadas(new Set())
      onAplicado()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao aplicar')
    } finally {
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

  const somaMarcada = sugestoes
    .filter((s) => marcadas.has(s.padrao))
    .reduce((a, s) => a + s.amountCents, 0)

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-muted-foreground" /> Sugestão da IA
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void pedir()}>
            {pensando ? `Pensando… ${segundos}s` : pediu ? 'Pedir de novo' : 'Sugerir categorias'}
          </Button>
          {sugestoes.length > 0 && (
            <Button size="sm" disabled={busy || marcadas.size === 0} onClick={() => void aplicar()}>
              <Check className="size-4" /> Aplicar {marcadas.size} ({brl(somaMarcada)})
            </Button>
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
            “Pedir de novo”: quem já virou regra sai da fila e os que faltaram entram.
          </p>
        )}

        {sugestoes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {pensando
              ? `Pensando… ${segundos}s (vai em lotes de 6, costuma levar cerca de um minuto)`
              : pediu
                ? 'Nada pendente aqui.'
                : 'Clique em “Sugerir categorias”.'}
          </p>
        ) : (
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
        )}
      </CardContent>
    </Card>
  )
}
