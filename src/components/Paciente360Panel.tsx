import { useEffect, useState } from 'react'
import { Activity, CalendarDays, CreditCard, Receipt, Scissors } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { carregarPaciente360, type Paciente360 } from '@/services/pacienteBusca'

/**
 * O histórico clínico e financeiro do paciente, num painel só.
 *
 * Consultas do Shosp, cirurgias, tricoscopia, vendas e pagamentos moravam cada um na
 * sua tela, sem caminho de volta para a pessoa. Aqui tudo aparece junto, na ficha,
 * numa única ida ao banco (crm_paciente_360).
 *
 * Seção vazia não é escondida: "nenhuma cirurgia" é informação clínica. Sumir com a
 * seção faz parecer que o sistema não sabe, quando ele sabe que não tem.
 */

const brl = (centavos: number | null | undefined) =>
  ((centavos ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const dia = (iso: string | null) => {
  if (!iso) return '—'
  // `data` do Shosp é dia puro (YYYY-MM-DD): sem o meio-dia, o fuso joga pro dia anterior.
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
}

/** Área doadora não rala: serve de controle do que é efeito do tratamento e do que é ruído de captura. */
const DOADORA = /occiput|occipital/i

function Secao({
  icone: Icone, titulo, contador, vazio, children,
}: {
  icone: typeof Activity; titulo: string; contador: number; vazio: string; children?: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icone className="size-4 opacity-70" />
        <h3 className="text-sm font-semibold">{titulo}</h3>
        <Badge variant="secondary" className="tabular-nums">{contador}</Badge>
      </div>
      {contador === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  )
}

export function Paciente360Panel({ leadId }: { leadId: string }) {
  const [dados, setDados] = useState<Paciente360 | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    carregarPaciente360(leadId)
      .then((d) => { if (vivo) setDados(d) })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não deu para carregar o histórico.') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [leadId])

  if (carregando) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
  }
  if (erro) return <p className="text-sm text-destructive">{erro}</p>
  if (!dados) return <p className="text-sm text-muted-foreground">Paciente não encontrado neste polo.</p>

  const r = dados.resumo

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          {[
            ['Consultas', r.consultas],
            ['Cirurgias', r.cirurgias],
            ['Exames de tricoscopia', r.exames_tricoscopia],
            ['Mensagens', r.mensagens],
          ].map(([label, valor]) => (
            <div key={String(label)}>
              <div className="text-2xl font-semibold tabular-nums">{Number(valor)}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
          <div>
            <div className="text-2xl font-semibold tabular-nums">{brl(r.faturado_centavos)}</div>
            <div className="text-xs text-muted-foreground">Vendido</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{brl(r.pago_centavos)}</div>
            <div className="text-xs text-muted-foreground">Pago no cartão</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{dia(r.primeira_consulta)}</div>
            <div className="text-xs text-muted-foreground">Primeira consulta</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">{dia(r.ultima_consulta)}</div>
            <div className="text-xs text-muted-foreground">Última consulta</div>
          </div>
        </CardContent>
      </Card>

      <Secao icone={Activity} titulo="Tricoscopia" contador={dados.tricoscopia.length}
        vazio="Nenhum exame vinculado. Se o paciente fez tricoscopia, o vínculo com a pasta do HairMetrix ainda está pendente na tela Tricoscopia.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Região</TableHead>
              <TableHead className="w-28">Último exame</TableHead>
              <TableHead className="text-right">Fios/cm²</TableHead>
              <TableHead className="text-right">Espessura</TableHead>
              <TableHead className="text-right">% finos</TableHead>
              <TableHead className="w-20 text-right">Exames</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.tricoscopia.map((t) => (
              <TableRow key={t.regiao ?? 'sem'}>
                <TableCell className="font-medium">
                  {t.regiao ?? '—'}
                  {DOADORA.test(t.regiao ?? '') && (
                    <Badge variant="outline" className="ml-2" title="Área doadora: não rala. Serve de controle da técnica de captura.">
                      controle
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{dia(t.capturado_em)}</TableCell>
                <TableCell className="text-right tabular-nums">{t.densidade_fios_cm2?.toFixed(1) ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{t.espessura_media_um ? `${t.espessura_media_um.toFixed(1)} µm` : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{t.pct_fios_finos?.toFixed(1) ?? '—'}%</TableCell>
                <TableCell className="text-right tabular-nums">{t.exames_na_regiao}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={Scissors} titulo="Cirurgias" contador={dados.cirurgias.length} vazio="Nenhuma cirurgia registrada.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Dia</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right">Meta</TableHead>
              <TableHead className="text-right">Extraídos</TableHead>
              <TableHead className="text-right">Implantados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.cirurgias.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="tabular-nums">{dia(c.dia)}</TableCell>
                <TableCell>{c.status ?? '—'}</TableCell>
                <TableCell>{c.sala ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.meta ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.extraidos ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.implantados ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={CalendarDays} titulo="Consultas" contador={dados.consultas.length} vazio="Nenhuma consulta no Shosp.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-20">Hora</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead className="w-28">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.consultas.map((c) => (
              <TableRow key={c.codigo ?? `${c.data}-${c.horario}`}>
                <TableCell className="tabular-nums">{dia(c.data)}</TableCell>
                <TableCell className="tabular-nums">{c.horario ?? '—'}</TableCell>
                <TableCell>{c.servico ?? '—'}</TableCell>
                <TableCell>{c.prestador ?? '—'}</TableCell>
                <TableCell>{c.status ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={Receipt} titulo="Vendas" contador={dados.vendas.length} vazio="Nenhuma venda registrada.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Vendido em</TableHead>
              <TableHead>Procedimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.vendas.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="tabular-nums">{dia(v.vendido_em)}</TableCell>
                <TableCell>{v.procedimento ?? v.tipo ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(v.valor_centavos)}</TableCell>
                <TableCell>{v.forma ?? '—'}{v.parcelas && v.parcelas > 1 ? ` ${v.parcelas}x` : ''}</TableCell>
                <TableCell>{v.status ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={CreditCard} titulo="Pagamentos" contador={dados.pagamentos.length} vazio="Nenhum pagamento no cartão.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Método</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead>Descrição</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.pagamentos.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums">{dia(p.pago_em ?? p.criado_em)}</TableCell>
                <TableCell className="text-right tabular-nums">{brl(p.valor_centavos)}</TableCell>
                <TableCell>{p.metodo ?? '—'}</TableCell>
                <TableCell>{p.status ?? '—'}</TableCell>
                <TableCell className="max-w-[16rem] truncate">{p.descricao ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>
    </div>
  )
}
