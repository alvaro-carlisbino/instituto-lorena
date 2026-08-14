import { useState } from 'react'
import { toast } from 'sonner'
import { CloudDownload, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  importarLote,
  listarNotasSefaz,
  type ListaSefaz,
  type ResultadoImport,
} from '@/services/nfeSefaz'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Notas que a SEFAZ tem contra o CNPJ do polo e ainda não estão lançadas.
 *
 * A tela separa em dois blocos porque a diferença é irreversível, não uma preferência:
 * nota COM XML completo entra inteira (itens no estoque, parcelas reais da duplicata); nota
 * em RESUMO entra só como documento + uma parcela, porque a SEFAZ já não tem mais os itens —
 * ciência da operação tem prazo de 10 dias da emissão e depois disso o XML não existe.
 *
 * Mostrar isso separado evita a leitura errada de "importei tudo, então o estoque está certo".
 */
export function NotasSefazPanel({ onImportou }: { onImportou?: () => void }) {
  const [lista, setLista] = useState<ListaSefaz | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [progresso, setProgresso] = useState<{ feitas: number; total: number; atual: string } | null>(null)
  const [resultado, setResultado] = useState<ResultadoImport[] | null>(null)

  const consultar = async () => {
    setCarregando(true)
    setResultado(null)
    try {
      setLista(await listarNotasSefaz())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao consultar a SEFAZ')
    } finally {
      setCarregando(false)
    }
  }

  const importar = async (somenteComXml: boolean) => {
    if (!lista) return
    const alvo = lista.notas.filter((n) => (somenteComXml ? n.xmlCompleto : true))
    if (alvo.length === 0) return
    setProgresso({ feitas: 0, total: alvo.length, atual: '' })
    try {
      const res = await importarLote(alvo, setProgresso)
      setResultado(res)
      const ok = res.filter((r) => r.ok).length
      const falhou = res.length - ok
      toast[falhou ? 'warning' : 'success'](
        `${ok} nota(s) lançada(s)${falhou ? `, ${falhou} com erro` : ''}`,
      )
      onImportou?.()
      await consultar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na carga')
    } finally {
      setProgresso(null)
    }
  }

  const comXml = lista?.notas.filter((n) => n.xmlCompleto).length ?? 0
  const soResumo = (lista?.faltando ?? 0) - comXml

  return (
    <Card className="border-primary/40 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <CloudDownload className="size-4 text-primary" /> Notas na SEFAZ
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Notas de fornecedor emitidas contra o CNPJ deste polo, direto da SEFAZ — sem depender de
          ninguém mandar o XML.
        </p>

        <Button size="sm" variant="outline" onClick={() => void consultar()} disabled={carregando || !!progresso}>
          {carregando ? 'Consultando…' : 'Consultar SEFAZ'}
        </Button>

        {lista && (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{lista.total} na SEFAZ</Badge>
              <Badge variant="outline">{lista.jaNoSistema} já lançadas</Badge>
              {lista.faltando > 0 && (
                <Badge variant="destructive">
                  {lista.faltando} faltando · {brl(lista.valorFaltando)}
                </Badge>
              )}
            </div>

            <p className="flex items-start gap-1.5 text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              <span>{lista.aviso}</span>
            </p>

            {lista.faltando > 0 && (
              <div className="space-y-2 pt-1">
                <div className="rounded border p-2">
                  <p className="font-medium">{comXml} com XML completo</p>
                  <p className="text-muted-foreground">
                    Entram inteiras: fornecedor, parcelas e itens no estoque.
                  </p>
                </div>
                <div className="rounded border p-2">
                  <p className="font-medium">{soResumo} só com resumo</p>
                  <p className="text-muted-foreground">
                    A SEFAZ não tem mais os itens (ciência vence em 10 dias). Entram como documento
                    + uma parcela EM ABERTO vencendo na emissão — conferir o que já foi pago.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" onClick={() => void importar(true)} disabled={!!progresso || comXml === 0}>
                    Importar as {comXml} completas
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void importar(false)}
                    disabled={!!progresso}
                  >
                    Importar todas as {lista.faltando}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {progresso && (
          <p className="text-xs text-muted-foreground">
            Importando {progresso.feitas}/{progresso.total}… {progresso.atual}
          </p>
        )}

        {resultado && (
          <div className="max-h-52 space-y-0.5 overflow-y-auto rounded border p-2 text-xs">
            {resultado.filter((r) => !r.ok).length === 0 ? (
              <p className="text-muted-foreground">Todas entraram sem erro.</p>
            ) : (
              resultado
                .filter((r) => !r.ok)
                .map((r) => (
                  <p key={r.chave} className="text-destructive">
                    {r.chave.slice(-8)}: {r.detalhe}
                  </p>
                ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
