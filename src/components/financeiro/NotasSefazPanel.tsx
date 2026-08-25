import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CloudDownload, PackagePlus, RefreshCw, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  darEntradaLote,
  listarEstoquePendente,
  resumoSefaz,
  sincronizarSefaz,
  type ResultadoEntrada,
  type ResumoSefaz,
} from '@/services/nfeSefaz'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (d: string | null) =>
  d ? d.split('-').reverse().join('/') : '—'

/** "há 12 min" diz mais que um horário: a pergunta é se rodou, não quando exatamente. */
function desde(iso: string | null): string {
  if (!iso) return 'ainda não rodou'
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.round(h / 24)} dia(s)`
}

/**
 * Notas de fornecedor emitidas contra o CNPJ do polo.
 *
 * A captura e o lançamento financeiro rodam sozinhos de hora em hora (`crm-sefaz-sync`), e o
 * casamento com o extrato roda dois minutos depois. Esta tela não busca nota: mostra o que já
 * entrou.
 *
 * **A entrada de estoque também não espera mais clique.** Ela continua rodando no NAVEGADOR
 * por obrigação — o casamento de item (EAN → SKU → nome → alias) vive em `nfeImport.ts` contra
 * o catálogo do polo, e ter duas implementações daquela cascata foi o que criou item duplicado
 * nas cargas de julho e agosto. O que mudou é que abrir a tela basta: se há nota esperando,
 * ela entra sozinha. Produto que não casar nasce marcado como "a revisar", que é a rede de
 * segurança de sempre — metade do que a NF-e cria não é estoque clínico.
 *
 * O que continua sendo decisão de gente é só a conferência do que já foi pago: nem a SEFAZ nem
 * o XML dizem isso, e o que o extrato não explica ninguém pode carimbar por dedução.
 */
export function NotasSefazPanel({ onImportou }: { onImportou?: () => void }) {
  const [resumo, setResumo] = useState<ResumoSefaz | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [sincronizando, setSincronizando] = useState(false)
  const [progresso, setProgresso] = useState<{ feitas: number; total: number; atual: string } | null>(null)
  const [falhas, setFalhas] = useState<ResultadoEntrada[] | null>(null)

  // Sem `setCarregando(true)` aqui: além de ser setState síncrono dentro do efeito, recarregar
  // mostrando o número antigo até o novo chegar é melhor do que piscar "carregando" a cada vez.
  const carregar = useCallback(async () => {
    try {
      const r = await resumoSefaz()
      setResumo(r)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao ler as notas da SEFAZ')
    } finally {
      setCarregando(false)
    }
  }, [])

  // A primeira carga não passa pelo `carregar` porque precisa da trava de desmontagem: quem sai
  // de /contas-a-pagar antes da consulta voltar não deve tomar setState em componente morto.
  useEffect(() => {
    let vivo = true
    void resumoSefaz()
      .then((r) => { if (vivo) setResumo(r) })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao ler as notas da SEFAZ'))
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [])

  /**
   * `silencioso` é a rodada automática ao abrir a tela: ela não avisa quando não fez nada, mas
   * AVISA quando fez. Entrada de estoque mexe no catálogo e cria produto — acontecer sem
   * ninguém saber é como o financeiro perde a noção de onde o item apareceu.
   */
  const darEntrada = async ({ silencioso = false } = {}) => {
    setFalhas(null)
    try {
      const pendentes = await listarEstoquePendente()
      if (pendentes.length === 0) return
      setProgresso({ feitas: 0, total: pendentes.length, atual: '' })
      const res = await darEntradaLote(pendentes, setProgresso)
      const ok = res.filter((r) => r.ok).length
      const ruins = res.filter((r) => !r.ok)
      setFalhas(ruins.length > 0 ? ruins : null)
      if (ok > 0 || ruins.length > 0) {
        toast[ruins.length ? 'warning' : 'success'](
          `${ok} nota(s) com entrada no estoque${ruins.length ? `, ${ruins.length} com erro` : ''}`,
        )
      }
      await carregar()
      onImportou?.()
    } catch (e) {
      if (!silencioso) toast.error(e instanceof Error ? e.message : 'Falha na entrada de estoque')
    } finally {
      setProgresso(null)
    }
  }

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await sincronizarSefaz()
      const novas = Number(r.resumosLancados ?? 0) + Number(r.completasLancadas ?? 0)
      toast.success(novas > 0 ? `${novas} nota(s) nova(s) lançada(s)` : 'Nada novo na SEFAZ')
      await carregar()
      if (novas > 0) {
        onImportou?.()
        // A que acabou de chegar com XML também entra no estoque agora. Sem isto ela ficaria
        // parada até a próxima vez que alguém abrisse a tela — e a automação de mount não a
        // pega, porque já rodou nesta montagem.
        await darEntrada({ silencioso: true })
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar')
    } finally {
      setSincronizando(false)
    }
  }

  /**
   * A entrada de estoque não espera mais clique: se há nota pendente quando a tela abre, ela
   * roda. Era o único passo que ainda dependia de alguém lembrar de apertar um botão, e nota
   * ficava semanas parada esperando isso.
   *
   * Uma vez por montagem, e é de propósito. Nota que falha continua pendente; sem a trava, o
   * `resumo` recarregado dispararia a mesma tentativa de novo, em laço, contra a mesma nota
   * quebrada. A falha aparece na lista e o botão continua ali para tentar de novo com gente
   * olhando.
   */
  const jaRodouEntrada = useRef(false)
  useEffect(() => {
    if (!resumo || resumo.estoquePendente === 0 || jaRodouEntrada.current) return
    jaRodouEntrada.current = true
    void darEntrada({ silencioso: true })
    // `darEntrada` é estável o bastante: só lê serviços e setState. Depender dele aqui exigiria
    // useCallback com o mesmo efeito prático e mais ruído.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumo])

  return (
    <Card className="border-primary/40 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CloudDownload className="size-4 text-primary" /> Notas na SEFAZ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Notas de fornecedor emitidas contra o CNPJ deste polo entram sozinhas, de hora em hora,
          sem depender de ninguém mandar o XML. A entrada no estoque roda ao abrir esta tela.
        </p>

        {carregando && !resumo && <p className="text-xs text-muted-foreground">Carregando…</p>}

        {resumo && (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{resumo.capturadas} na janela</Badge>
              <Badge variant="outline">{resumo.lancadas} lançadas</Badge>
              {resumo.comErro > 0 && <Badge variant="destructive">{resumo.comErro} com erro</Badge>}
            </div>
            <p className="text-muted-foreground">
              {brl(resumo.valorTotal)} · {dia(resumo.janelaDe)} a {dia(resumo.janelaAte)} ·{' '}
              {resumo.comXmlGuardado} com XML guardado
            </p>
            {/* Sem esta linha, painel parado por falta de nota nova e painel parado por cron
                quebrado são a mesma tela — e a conclusão de quem olha é sempre a segunda. */}
            <p className={resumo.ultimaRodadaErro ? 'text-destructive' : 'text-muted-foreground'}>
              Servidor olhou a SEFAZ {desde(resumo.ultimaRodada)}
              {resumo.ultimaRodadaErro ? ` · falhou: ${resumo.ultimaRodadaErro}` : ''}
            </p>

            {/* Nota que a SEFAZ trouxe e o extrato ainda não explicou. O casamento com o banco
                roda sozinho de hora em hora; o que sobra aqui é o que ele não teve como
                decidir — ou o que de fato não foi pago. */}
            {resumo.aConferirParcelas > 0 && (
              <div className="rounded border border-amber-500/40 bg-amber-500/[0.06] p-2">
                <p className="flex items-start gap-1.5 font-medium">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0 text-amber-600" />
                  {resumo.aConferirParcelas} parcela(s) em aberto · {brl(resumo.aConferirValor)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Nasceram em aberto porque nem a SEFAZ nem o XML dizem se a nota foi paga. O que
                  o extrato do banco prova já foi dado por pago sozinho
                  {resumo.conciliadasAuto > 0
                    ? ` (${resumo.conciliadasAuto} parcela(s), ${brl(resumo.conciliadoAutoValor)})`
                    : ''}
                  . Isto aqui é o que o extrato não explica.
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  A conferência é o painel logo abaixo.
                </p>
              </div>
            )}

            {resumo.estoquePendente > 0 && (
              <div className="rounded border p-2">
                <p className="font-medium">
                  {resumo.estoquePendente} nota(s) esperando entrada no estoque
                </p>
                <p className="mt-1 text-muted-foreground">
                  O financeiro dessas já entrou. Falta casar os itens com o catálogo, que roda
                  aqui no navegador — e roda sozinho quando esta tela abre. O que sobra aqui
                  ou acabou de chegar, ou falhou na primeira tentativa. Produto que não casar
                  nasce marcado como “a revisar”.
                </p>
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => void darEntrada()}
                  disabled={!!progresso || sincronizando}
                >
                  <PackagePlus className="mr-1 size-3.5" />
                  Dar entrada nas {resumo.estoquePendente}
                </Button>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={() => void sincronizar()}
              disabled={sincronizando || !!progresso}
            >
              <RefreshCw className={`mr-1 size-3.5 ${sincronizando ? 'animate-spin' : ''}`} />
              {sincronizando ? 'Sincronizando…' : 'Sincronizar agora'}
            </Button>

            <p className="text-muted-foreground">
              A SEFAZ disponibiliza documentos por ~90 dias. Nota mais antiga não aparece aqui e
              vem do XML do contador.
            </p>
          </div>
        )}

        {progresso && (
          <p className="text-xs text-muted-foreground">
            Dando entrada {progresso.feitas}/{progresso.total}… {progresso.atual}
          </p>
        )}

        {falhas && (
          <div className="max-h-52 space-y-0.5 overflow-y-auto rounded border p-2 text-xs">
            {falhas.map((r) => (
              <p key={r.chave} className="text-destructive">
                {r.chave.slice(-8)}: {r.detalhe}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
