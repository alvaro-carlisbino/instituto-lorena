import { useMemo, useState } from 'react'
import { Camera, CheckCircle2, Clock, ImageOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { baseRegiao, dia, glosaRegiao, ordemRegiao } from '@/lib/tricoscopia'
import type { FotoExame, PedidoImagem } from '@/services/hairmetrix'

/**
 * A foto de verdade, quando existe. Vem do bucket privado por URL assinada de uma
 * hora — couro cabeludo é dado de saúde e não pode virar link que circula.
 *
 * Enquanto não existe, esta seção não some: ela explica por que, e oferece o
 * botão que enfileira o envio daquele paciente. O caminho antigo era subir a
 * captura mais recente de TODO mundo (4,5 GB), e por isso nunca foi subida
 * nenhuma.
 */

type Props = {
  fotos: FotoExame[]
  pedido: PedidoImagem | null
  pedindo: boolean
  onPedir: () => void
}

export function GaleriaFotos({ fotos, pedido, pedindo, onPedir }: Props) {
  const [aberta, setAberta] = useState<FotoExame | null>(null)

  /**
   * Agrupa por região e mostra a primeira e a última data de cada uma — que é o
   * antes e depois. Mostrar as doze fotos em fila deixa o médico procurando qual
   * comparar com qual na frente do paciente.
   */
  const porRegiao = useMemo(() => {
    const m = new Map<string, FotoExame[]>()
    for (const f of fotos) {
      const k = f.regiao ? baseRegiao(f.regiao) : 'Sem região'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(f)
    }
    for (const lista of m.values()) lista.sort((a, b) => a.capturadoEm.localeCompare(b.capturadoEm))
    return Array.from(m.entries()).sort((a, b) => ordemRegiao(a[0]) - ordemRegiao(b[0]))
  }, [fotos])

  if (fotos.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4">
        <div className="flex items-start gap-3">
          <ImageOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1 text-sm">
            <p className="m-0 font-medium">Sem foto deste paciente no CRM.</p>
            <p className="m-0 text-muted-foreground">
              As 32 mil capturas do HairMetrix somam 130 a 250 GB e não sobem de uma vez. Pedindo aqui, o
              agente da máquina da clínica manda na próxima rodada só as deste paciente — cerca de doze
              imagens do primeiro e do último exame.
            </p>
          </div>
        </div>

        {pedido?.status === 'pendente' ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            Pedido feito em {dia(pedido.solicitadoEm)} — aguardando a próxima rodada do agente.
          </span>
        ) : pedido?.status === 'atendido' && pedido.imagensEnviadas === 0 ? (
          <span className="text-sm text-muted-foreground">
            O agente rodou em {dia(pedido.atendidoEm)} e não achou imagem na pasta deste paciente.
          </span>
        ) : (
          <Button size="sm" variant="outline" onClick={onPedir} disabled={pedindo}>
            <Camera className="mr-1.5 h-3.5 w-3.5" />
            {pedindo ? 'Pedindo…' : 'Pedir as fotos deste paciente'}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {pedido?.status === 'atendido' && (
        <p className="m-0 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" />
          {pedido.imagensEnviadas} imagens enviadas pelo agente em {dia(pedido.atendidoEm)}.
        </p>
      )}

      {porRegiao.map(([regiao, lista]) => {
        // primeira e última: o antes e o depois. As do meio ficam na fila abaixo.
        const primeira = lista[0]
        const ultima = lista.length > 1 ? lista[lista.length - 1] : null
        const meio = lista.slice(1, -1)

        return (
          <div key={regiao}>
            <h3 className="m-0 mb-2 text-sm font-semibold">
              {regiao}
              {glosaRegiao(regiao) && (
                <span className="ml-2 font-normal text-muted-foreground">({glosaRegiao(regiao)})</span>
              )}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Foto foto={primeira} rotulo="Primeiro exame" onAbrir={setAberta} />
              {ultima ? (
                <Foto foto={ultima} rotulo="Exame mais recente" onAbrir={setAberta} />
              ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                  Só há uma captura desta região.
                </div>
              )}
            </div>
            {meio.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {meio.map((f) => (
                  <button
                    key={f.storagePath}
                    type="button"
                    onClick={() => setAberta(f)}
                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    {dia(f.capturadoEm)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <Dialog open={!!aberta} onOpenChange={(o) => { if (!o) setAberta(null) }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {aberta?.regiao ?? 'Captura'} — {dia(aberta?.capturadoEm)}
            </DialogTitle>
          </DialogHeader>
          {aberta?.url && (
            <img
              src={aberta.url}
              alt={`Tricoscopia de ${aberta.regiao ?? 'região não identificada'} em ${dia(aberta.capturadoEm)}`}
              className="max-h-[75vh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Foto({
  foto,
  rotulo,
  onAbrir,
}: {
  foto: FotoExame
  rotulo: string
  onAbrir: (f: FotoExame) => void
}) {
  return (
    <figure className="m-0">
      <figcaption className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</span>
        <span className="text-sm tabular-nums">{dia(foto.capturadoEm)}</span>
      </figcaption>
      {foto.url ? (
        <button type="button" onClick={() => onAbrir(foto)} className="block w-full">
          <img
            src={foto.url}
            alt={`Tricoscopia de ${foto.regiao ?? 'região não identificada'} em ${dia(foto.capturadoEm)}`}
            loading="lazy"
            className="w-full rounded-lg border border-border object-cover"
          />
        </button>
      ) : (
        // A URL assinada falha quando a policy de storage não deixa o usuário ler.
        // Dizer isso é melhor do que uma moldura vazia que parece foto quebrada.
        <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/30 p-3 text-center text-xs text-muted-foreground">
          A imagem existe no servidor, mas este usuário não tem permissão de leitura no bucket.
        </div>
      )}
    </figure>
  )
}
