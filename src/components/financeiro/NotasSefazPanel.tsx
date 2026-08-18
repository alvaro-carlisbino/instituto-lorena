import { useCallback, useEffect, useState } from 'react'
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

/**
 * Notas de fornecedor emitidas contra o CNPJ do polo.
 *
 * A captura e o lançamento financeiro rodam sozinhos 2x/dia (`crm-sefaz-sync`). Esta tela não
 * busca nota: mostra o que já entrou e as duas pendências que a automação de propósito não
 * resolve sozinha — a entrada de estoque (precisa casar item com o catálogo) e a conferência
 * do que já foi pago (só o extrato do banco sabe).
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

  const sincronizar = async () => {
    setSincronizando(true)
    try {
      const r = await sincronizarSefaz()
      const novas = Number(r.resumosLancados ?? 0) + Number(r.completasLancadas ?? 0)
      toast.success(novas > 0 ? `${novas} nota(s) nova(s) lançada(s)` : 'Nada novo na SEFAZ')
      await carregar()
      if (novas > 0) onImportou?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar')
    } finally {
      setSincronizando(false)
    }
  }

  const darEntrada = async () => {
    setFalhas(null)
    try {
      const pendentes = await listarEstoquePendente()
      if (pendentes.length === 0) return
      setProgresso({ feitas: 0, total: pendentes.length, atual: '' })
      const res = await darEntradaLote(pendentes, setProgresso)
      const ok = res.filter((r) => r.ok).length
      const ruins = res.filter((r) => !r.ok)
      setFalhas(ruins.length > 0 ? ruins : null)
      toast[ruins.length ? 'warning' : 'success'](
        `${ok} nota(s) com entrada no estoque${ruins.length ? `, ${ruins.length} com erro` : ''}`,
      )
      await carregar()
      onImportou?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na entrada de estoque')
    } finally {
      setProgresso(null)
    }
  }

  return (
    <Card className="border-primary/40 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CloudDownload className="size-4 text-primary" /> Notas na SEFAZ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Notas de fornecedor emitidas contra o CNPJ deste polo entram sozinhas, duas vezes por
          dia, sem depender de ninguém mandar o XML.
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
                  aqui no navegador. Produto que não casar nasce marcado como “a revisar”.
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
