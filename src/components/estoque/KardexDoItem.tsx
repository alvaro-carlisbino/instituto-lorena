import { Link } from 'react-router-dom'
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, History, Undo2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchField } from '@/components/ui/search-field'
import { Select, SelectContent, SelectItem } from '@/components/ui/select'
import { LabeledSelectTrigger } from '@/components/ui/labeled-select-trigger'
import { formatBRL, formatQtd } from '@/components/kits/kitUi'
import { diaLocalComOffset, hojeLocal } from '@/lib/diaLocal'
import { COR_GRUPO, ROTULO_GRUPO, dataDia, dataHora, linkDaOrigem } from '@/components/estoque/kardexUi'
import { type FiltroKardex, type LinhaKardex, grupoOperacao, podeEstornar, rotuloOrigem } from '@/lib/kardex'
import { cn } from '@/lib/utils'
import type { StockWarehouse } from '@/services/estoqueArmazens'

function Origem({ l, podeVerFinanceiro, itemNome }: { l: LinhaKardex; podeVerFinanceiro: boolean; itemNome: string }) {
  const { titulo, detalhe } = rotuloOrigem(l.origem)
  const link = linkDaOrigem(l, podeVerFinanceiro)
  const grupo = grupoOperacao(l)
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', COR_GRUPO[grupo])}>
          {l.qtd > 0 ? 'Entrada' : l.qtd < 0 ? 'Saída' : 'Acerto'}
        </span>
        {link ? (
          <Link to={link} className="font-medium break-words hover:underline">
            {titulo}
          </Link>
        ) : (
          <span className="font-medium break-words">{titulo}</span>
        )}
        {l.estornadoPor ? <Badge variant="outline">estornado</Badge> : null}
      </div>
      {detalhe ? <p className="text-xs break-words text-muted-foreground">{detalhe}</p> : null}
      {l.origem.tipo === 'kit' && l.origem.leadId ? (
        <Link to={`/leads/${l.origem.leadId}`} className="text-xs text-primary hover:underline">
          ficha do paciente
        </Link>
      ) : null}
      {l.itemNome && l.itemNome !== itemNome ? (
        <p className="line-clamp-2 text-xs text-muted-foreground" title={l.itemNome}>
          entrou como {l.itemNome}
        </p>
      ) : l.origem.tipo === 'nota' && l.observacao && l.observacao.includes(' · ') ? (
        <p className="line-clamp-2 text-xs text-muted-foreground" title={l.observacao}>
          na nota: {l.observacao.split(' · ')[1]}
        </p>
      ) : null}
      {l.motivo && !['compra (NF-e)', 'kit montado', 'transferência', 'uso do setor', 'inventário'].includes(l.motivo) ? (
        <p className="truncate text-xs text-muted-foreground" title={l.motivo}>
          {l.motivo}
          {l.observacao && l.origem.tipo !== 'kit' && l.origem.tipo !== 'transferencia' && l.origem.tipo !== 'uso' ? ` · ${l.observacao}` : ''}
        </p>
      ) : null}
    </div>
  )
}

function Lote({ l, podeVerFinanceiro }: { l: LinhaKardex; podeVerFinanceiro: boolean }) {
  if (!l.lote) return <span className="text-muted-foreground">sem lote</span>
  const vencido = l.validade != null && l.validade < hojeLocal()
  const nota = l.loteOrigem && l.origem.tipo !== 'nota' ? l.loteOrigem : null
  return (
    <div className="min-w-0 text-xs">
      <p className="truncate font-medium tabular-nums">{l.lote}</p>
      {l.validade ? (
        <p className={cn('tabular-nums text-muted-foreground', vencido && 'font-semibold text-destructive')}>
          {vencido ? 'venceu' : 'vence'} {dataDia(l.validade)}
        </p>
      ) : null}
      {nota ? (
        podeVerFinanceiro ? (
          <Link to={`/contas-a-pagar?nota=${nota.notaId}`} className="block truncate text-primary hover:underline">
            veio da NF {nota.numero}
          </Link>
        ) : (
          <p className="truncate text-muted-foreground">veio da NF {nota.numero}</p>
        )
      ) : null}
    </div>
  )
}

export function FiltrosDoKardex({
  filtro,
  setFiltro,
  setores,
  resultados,
}: {
  filtro: FiltroKardex
  setFiltro: (f: FiltroKardex) => void
  setores: StockWarehouse[]
  resultados: number
}) {
  const hoje = hojeLocal()
  const atalhos: Array<{ rotulo: string; de: string | null }> = [
    { rotulo: '30 dias', de: diaLocalComOffset(-30) },
    { rotulo: '90 dias', de: diaLocalComOffset(-90) },
    { rotulo: 'Este ano', de: `${hoje.slice(0, 4)}-01-01` },
    { rotulo: 'Tudo', de: null },
  ]
  const setorNome = setores.find((s) => s.id === filtro.setorId)?.name ?? 'Todos os setores'
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_13rem]">
        <SearchField
          value={filtro.busca}
          onChange={(busca) => setFiltro({ ...filtro, busca })}
          label="Buscar por nota, fornecedor, lote, paciente ou quem fez"
          resultados={resultados}
        />
        <Select value={filtro.setorId ?? 'todos'} onValueChange={(v) => setFiltro({ ...filtro, setorId: !v || v === 'todos' ? null : v })}>
          <LabeledSelectTrigger aria-label="Setor" className="h-9 w-full">
            {setorNome}
          </LabeledSelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os setores</SelectItem>
            {setores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filtro.grupo}
          onValueChange={(v) => setFiltro({ ...filtro, grupo: (v ?? 'tudo') as FiltroKardex['grupo'] })}
        >
          <LabeledSelectTrigger aria-label="Tipo de operação" className="h-9 w-full">
            {ROTULO_GRUPO[filtro.grupo]}
          </LabeledSelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_GRUPO) as Array<FiltroKardex['grupo']>).map((g) => (
              <SelectItem key={g} value={g}>
                {ROTULO_GRUPO[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1">
          {atalhos.map((a) => {
            const ativo = filtro.de === a.de && (a.de === null ? filtro.ate === null : filtro.ate === null)
            return (
              <Button
                key={a.rotulo}
                type="button"
                size="sm"
                variant={ativo ? 'default' : 'outline'}
                className="h-8"
                onClick={() => setFiltro({ ...filtro, de: a.de, ate: null })}
              >
                {a.rotulo}
              </Button>
            )
          })}
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="kardex-de" className="text-xs">
              De
            </Label>
            <Input
              id="kardex-de"
              type="date"
              value={filtro.de ?? ''}
              max={filtro.ate ?? undefined}
              onChange={(e) => setFiltro({ ...filtro, de: e.target.value || null })}
              className="h-8 w-[9.5rem]"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kardex-ate" className="text-xs">
              Até
            </Label>
            <Input
              id="kardex-ate"
              type="date"
              value={filtro.ate ?? ''}
              min={filtro.de ?? undefined}
              onChange={(e) => setFiltro({ ...filtro, ate: e.target.value || null })}
              className="h-8 w-[9.5rem]"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function KardexDoItem({
  linhas,
  itemNome,
  unidade,
  porSetor,
  podeVerFinanceiro,
  carregando,
  onEstornar,
}: {
  linhas: LinhaKardex[]
  itemNome: string
  unidade: string
  /** Com filtro de setor, o saldo mostrado é o do setor. */
  porSetor: boolean
  podeVerFinanceiro: boolean
  carregando: boolean
  onEstornar: (l: LinhaKardex) => void
}) {
  if (linhas.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={carregando ? 'Carregando o histórico…' : 'Nenhum movimento neste filtro'}
        description={carregando ? undefined : 'Mude o período, o setor ou a busca.'}
      />
    )
  }
  const saldoDa = (l: LinhaKardex) => (porSetor ? l.saldoSetor : l.saldo)
  return (
    <>
      {/* Celular: um cartão por lançamento. A tabela de 9 colunas não cabe em 400 px. */}
      <ul className="space-y-2 lg:hidden">
        {linhas.map((l) => (
          <li key={l.id} className={cn('rounded-xl border border-border bg-card p-3 text-sm', l.estornadoPor && 'opacity-60')}>
            <div className="flex items-start justify-between gap-2">
              <Origem l={l} podeVerFinanceiro={podeVerFinanceiro} itemNome={itemNome} />
              <div className="shrink-0 text-right">
                <p className={cn('font-semibold tabular-nums', l.qtd > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground')}>
                  {l.qtd > 0 ? '+' : ''}
                  {formatQtd(l.qtd)}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  saldo {formatQtd(saldoDa(l))} {unidade}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">{dataHora(l.criadoEm)}</span>
              {l.setorNome ? <span>{l.setorNome}</span> : null}
              {l.lote ? <span className="tabular-nums">lote {l.lote}</span> : null}
              {l.custoUnitCents != null ? <span className="tabular-nums">{formatBRL(l.custoUnitCents)}/{unidade}</span> : null}
              {l.autor ? <span>{l.autor}</span> : null}
            </div>
            {l.loteOrigem && l.origem.tipo !== 'nota' ? (
              <p className="mt-1 text-xs text-muted-foreground">lote veio da NF {l.loteOrigem.numero}</p>
            ) : null}
            {podeEstornar(l) ? (
              <Button variant="outline" size="sm" className="mt-2 h-8" onClick={() => onEstornar(l)}>
                <Undo2 className="size-3.5" aria-hidden /> Estornar
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-border lg:block">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-[6.5rem] px-2 py-2 font-medium">Data</th>
              <th className="px-2 py-2 font-medium">Operação</th>
              <th className="w-[6.5rem] px-2 py-2 font-medium">Setor</th>
              <th className="w-[8.5rem] px-2 py-2 font-medium">Lote</th>
              <th className="w-[5rem] px-2 py-2 text-right font-medium">Entrada</th>
              <th className="w-[5rem] px-2 py-2 text-right font-medium">Saída</th>
              <th className="w-[5.5rem] px-2 py-2 text-right font-medium">Saldo</th>
              <th className="w-[5.5rem] px-2 py-2 text-right font-medium">Custo un.</th>
              <th className="w-[7rem] px-2 py-2 font-medium">Quem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((l) => (
              <tr key={l.id} className={cn('align-top', l.estornadoPor && 'opacity-60')}>
                <td className="px-2 py-2 text-xs whitespace-nowrap tabular-nums text-muted-foreground">
                  {dataHora(l.criadoEm).split(', ')[0]}
                  <span className="block">{dataHora(l.criadoEm).split(', ')[1]}</span>
                  <span className="block text-[10px]">nº {l.seq}</span>
                </td>
                <td className="px-2 py-2">
                  <Origem l={l} podeVerFinanceiro={podeVerFinanceiro} itemNome={itemNome} />
                  {podeEstornar(l) ? (
                    <Button variant="ghost" size="sm" className="-ml-2 mt-1 h-7 text-xs" onClick={() => onEstornar(l)}>
                      <Undo2 className="size-3.5" aria-hidden /> Estornar
                    </Button>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-xs">
                  <span className="inline-flex items-center gap-1">
                    {l.origem.tipo === 'transferencia' || l.origem.tipo === 'uso' ? <ArrowLeftRight className="size-3 text-muted-foreground" aria-hidden /> : null}
                    {l.setorNome ?? ''}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <Lote l={l} podeVerFinanceiro={podeVerFinanceiro} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                  {l.qtd > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <ArrowDownToLine className="size-3" aria-hidden />
                      {formatQtd(l.qtd)}
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {l.qtd < 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpFromLine className="size-3 text-muted-foreground" aria-hidden />
                      {formatQtd(-l.qtd)}
                    </span>
                  ) : null}
                </td>
                <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', saldoDa(l) < 0 && 'text-destructive')}>
                  {formatQtd(saldoDa(l))}
                </td>
                <td className="px-2 py-2 text-right text-xs tabular-nums text-muted-foreground">
                  {l.custoUnitCents != null ? formatBRL(l.custoUnitCents) : ''}
                </td>
                <td className="truncate px-2 py-2 text-xs text-muted-foreground" title={l.autor ?? undefined}>
                  {l.autor ?? 'sistema'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
