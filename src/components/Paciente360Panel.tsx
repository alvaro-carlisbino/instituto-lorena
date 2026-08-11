import { useEffect, useState } from 'react'
import {
  Activity,
  CalendarDays,
  MessageSquare,
  Package,
  PhoneCall,
  Receipt,
  Repeat,
  Scissors,
  Star,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { carregarPaciente360, type Paciente360, type TipoPaciente } from '@/services/pacienteBusca'

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

/** Rótulo em cima, valor embaixo. Campo sem valor mostra travessão, não some: saber que
 *  o CPF não foi preenchido é diferente de não haver campo de CPF. */
function Campo({ rotulo, valor }: { rotulo: string; valor: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="break-words text-sm">{valor && valor.length > 0 ? valor : '—'}</div>
    </div>
  )
}

// `ref` NÃO serve de nome de prop: React trata como referência de elemento e o valor
// nunca chega no componente. Daí `refId`.
export function Paciente360Panel({ tipo = 'lead', refId }: { tipo?: TipoPaciente; refId: string }) {
  const [dados, setDados] = useState<Paciente360 | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    carregarPaciente360(tipo, refId)
      .then((d) => { if (vivo) setDados(d) })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não deu para carregar o histórico.') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [tipo, refId])

  if (carregando) {
    return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
  }
  if (erro) return <p className="text-sm text-destructive">{erro}</p>
  if (!dados) return <p className="text-sm text-muted-foreground">Paciente não encontrado neste polo.</p>

  const r = dados.resumo
  const p = dados.paciente
  const e = p.entrega

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          {[
            ['Consultas', r.consultas],
            ['Cirurgias', r.cirurgias],
            ['Exames de tricoscopia', r.exames_tricoscopia],
            ['Pedidos pagos', r.pedidos_pagos],
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
            <div className="text-xs text-muted-foreground">Pago (cartão e PIX)</div>
          </div>
          <div>
            <div className="text-2xl font-semibold tabular-nums">
              {r.nps_ultima_nota != null ? r.nps_ultima_nota : '—'}
            </div>
            <div className="text-xs text-muted-foreground">Última nota (NPS)</div>
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

      {/* Cadastro e endereço: é o que a atendente lê em voz alta no telefone para
          confirmar quem está falando e para onde foi o pedido. Estava tudo no banco
          (`custom_fields.cadastro` e `.entrega`) e não aparecia em lugar nenhum. */}
      <Card>
        <CardContent className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Nome completo" valor={p.nome_completo ?? p.nome} />
          <Campo rotulo="Telefone" valor={p.telefone} />
          <Campo rotulo="CPF" valor={p.cpf} />
          <Campo rotulo="E-mail" valor={p.email} />
          <Campo rotulo="Nascimento" valor={p.nascimento} />
          <Campo rotulo="Prontuário" valor={p.prontuario} />
          <Campo rotulo="Funil / etapa" valor={[p.funil, p.etapa].filter(Boolean).join(' · ') || null} />
          <Campo rotulo="Responsável" valor={p.responsavel} />
          <Campo rotulo="Cliente desde" valor={p.criado_em ? dia(p.criado_em) : null} />
          <Campo rotulo="Origem" valor={p.origem} />
          <Campo rotulo="Veio de" valor={p.canal_atribuicao} />
          <Campo rotulo="Campanha / página" valor={p.campanha} />
          {e ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <div className="text-xs text-muted-foreground">Endereço de entrega</div>
              <div className="text-sm">
                {[e.logradouro, e.numero, e.complemento, e.bairro].filter(Boolean).join(', ') || '—'}
                {e.cidade ? ` — ${e.cidade}/${e.uf ?? ''}` : ''}
                {e.cep ? ` · CEP ${e.cep}` : ''}
              </div>
              {e.tracking ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className="font-mono">{e.tracking}</Badge>
                  {e.service ? <span className="text-xs text-muted-foreground">{e.service}</span> : null}
                  {e.status ? <Badge variant="secondary">{e.status}</Badge> : null}
                  {e.tracking_updated_at ? (
                    <span className="text-xs text-muted-foreground">atualizado em {dia(e.tracking_updated_at)}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {p.tags.length > 0 ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <div className="text-xs text-muted-foreground">Etiquetas</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {p.tags.map((t) => (
                  <Badge key={t.nome} variant="outline">{t.nome}</Badge>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {dados.assinatura ? (
        <Card>
          <CardContent className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2">
              <Repeat className="size-4 opacity-70" />
              <h3 className="text-sm font-semibold">Assinatura</h3>
              <Badge variant="secondary">{dados.assinatura.status ?? '—'}</Badge>
            </div>
            <Campo rotulo="Cadência" valor={dados.assinatura.cadencia} />
            <Campo rotulo="Valor mensal" valor={brl(dados.assinatura.valor_mensal_centavos)} />
            <Campo rotulo="Frascos por envio" valor={dados.assinatura.frascos_por_envio?.toString() ?? null} />
            <Campo rotulo="Ciclos pagos" valor={dados.assinatura.ciclos_pagos?.toString() ?? null} />
            <Campo rotulo="Último ciclo enviado" valor={dados.assinatura.ultimo_ciclo_enviado?.toString() ?? null} />
            <Campo rotulo="Último envio" valor={dados.assinatura.ultimo_envio_em ? dia(dados.assinatura.ultimo_envio_em) : null} />
            <Campo rotulo="Status do envio" valor={dados.assinatura.ultimo_envio_status} />
            <Campo rotulo="Mínimo de ciclos" valor={dados.assinatura.minimo_ciclos?.toString() ?? null} />
          </CardContent>
        </Card>
      ) : null}

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

      {/* Pedidos, não "pagamentos": o que a pessoa comprou, com kit, cupom, frete,
          número no Bling e nota. Era esta a tela que faltava para responder "cadê meu
          pedido?" sem abrir o Bling em outra aba. */}
      <Secao icone={Package} titulo="Pedidos da loja" contador={dados.pedidos.length} vazio="Nenhum pedido na loja.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Data</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead>Pedido / NF-e</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.pedidos.map((o) => (
              <TableRow key={`${o.canal}-${o.id}`}>
                <TableCell className="tabular-nums">{dia(o.pago_em ?? o.criado_em)}</TableCell>
                <TableCell className="max-w-[20rem]">
                  <div className="truncate">
                    {o.itens?.length
                      ? o.itens.map((it) => `${it.qty ?? 1}× ${it.nome ?? ''}`).join(', ')
                      : o.descricao ?? o.kit ?? '—'}
                  </div>
                  {(o.cupom || o.frete_centavos) && (
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                      {o.cupom ? <span>cupom {o.cupom} (−{brl(o.desconto_centavos)})</span> : null}
                      {o.frete_centavos ? <span>frete {brl(o.frete_centavos)}</span> : null}
                      {o.origem ? <span>via {o.origem}</span> : null}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{brl(o.valor_centavos)}</TableCell>
                <TableCell>
                  {o.metodo ?? o.canal}
                  {o.parcelas && o.parcelas > 1 ? ` ${o.parcelas}x` : ''}
                </TableCell>
                <TableCell>{o.status ?? '—'}</TableCell>
                <TableCell className="text-xs">
                  {o.pedido_bling ? <div className="font-mono">#{o.pedido_bling}</div> : null}
                  {o.nfe_numero ? (
                    <div className="text-muted-foreground">
                      NF-e {o.nfe_numero}
                      {/* O status da nota vem junto de propósito: a SEFAZ recusa boa parte
                          delas e "NF-e 000210" sozinho passa a impressão de que saiu. */}
                      {o.nfe_status ? ` · ${o.nfe_status}` : ''}
                    </div>
                  ) : null}
                  {!o.pedido_bling && !o.nfe_numero ? '—' : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={Repeat} titulo="Protocolos de tratamento" contador={dados.protocolos.length}
        vazio="Nenhum protocolo em andamento.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Protocolo</TableHead>
              <TableHead className="w-28">Início</TableHead>
              <TableHead className="w-32 text-right">Sessões</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.protocolos.map((pr) => (
              <TableRow key={pr.id}>
                <TableCell className="font-medium">{pr.nome ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{dia(pr.iniciado_em)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {pr.sessoes_feitas}/{pr.sessoes_previstas ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {pr.preco != null ? brl(Math.round(pr.preco * 100)) : '—'}
                </TableCell>
                <TableCell>{pr.status ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={PhoneCall} titulo="Follow-ups" contador={dados.followups.length} vazio="Nenhum follow-up registrado.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-right">#</TableHead>
              <TableHead className="w-28">Agendado</TableHead>
              <TableHead className="w-28">Feito</TableHead>
              <TableHead className="w-24">Canal</TableHead>
              <TableHead>Desfecho</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.followups.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="text-right tabular-nums">{f.tentativa ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{dia(f.agendado_para)}</TableCell>
                <TableCell className="tabular-nums">{f.feito_em ? dia(f.feito_em) : '—'}</TableCell>
                <TableCell>{f.canal ?? '—'}</TableCell>
                <TableCell className="max-w-[20rem] truncate">
                  {[f.desfecho, f.nota].filter(Boolean).join(' — ') || '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      {/* NPS com a NOTA. O painel antigo só sabia dizer quantas pesquisas SAÍRAM — e
          o que interessa na ficha é o que a pessoa respondeu. */}
      <Secao icone={Star} titulo="Pesquisas de satisfação" contador={dados.nps.length} vazio="Nenhuma pesquisa enviada.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Enviada</TableHead>
              <TableHead className="w-24">Canal</TableHead>
              <TableHead className="w-20 text-right">Nota</TableHead>
              <TableHead className="w-28">Respondida</TableHead>
              <TableHead>Comentário</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.nps.map((n, i) => (
              <TableRow key={`${n.enviado_em}-${i}`}>
                <TableCell className="tabular-nums">{dia(n.enviado_em)}</TableCell>
                <TableCell>{n.canal ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{n.nota ?? '—'}</TableCell>
                <TableCell className="tabular-nums">{n.respondido_em ? dia(n.respondido_em) : 'sem resposta'}</TableCell>
                <TableCell className="max-w-[20rem] truncate">{n.comentario ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      <Secao icone={MessageSquare} titulo="Notas da equipe" contador={dados.notas_clinicas.length} vazio="Nenhuma nota registrada.">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Data</TableHead>
              <TableHead className="w-40">Autor</TableHead>
              <TableHead className="w-32">Categoria</TableHead>
              <TableHead>Nota</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.notas_clinicas.map((n) => (
              <TableRow key={n.id}>
                <TableCell className="tabular-nums">{dia(n.criada_em)}</TableCell>
                <TableCell>{n.autor ?? '—'}</TableCell>
                <TableCell>{n.categoria ?? '—'}</TableCell>
                <TableCell className="whitespace-pre-wrap">{n.nota ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Secao>

      {dados.conversa ? (
        <Card>
          <CardContent className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4 flex items-center gap-2">
              <MessageSquare className="size-4 opacity-70" />
              <h3 className="text-sm font-semibold">Conversa</h3>
            </div>
            <Campo rotulo="Mensagens" valor={String(dados.conversa.mensagens)} />
            <Campo rotulo="Recebidas" valor={String(dados.conversa.recebidas)} />
            <Campo rotulo="Enviadas" valor={String(dados.conversa.enviadas)} />
            <Campo rotulo="Primeira" valor={dados.conversa.primeira_em ? dia(dados.conversa.primeira_em) : null} />
            <Campo rotulo="Última" valor={dados.conversa.ultima_em ? dia(dados.conversa.ultima_em) : null} />
            {dados.conversa.linhas.map((l) => (
              <Campo
                key={l.linha ?? 'sem-linha'}
                rotulo={`Linha ${l.linha ?? '—'}`}
                // Quem responde nesta linha: é a informação que decide se a IA vai falar.
                valor={`${l.dono ?? '—'} · IA ${l.ia_ligada ? 'ligada' : 'desligada'}`}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
