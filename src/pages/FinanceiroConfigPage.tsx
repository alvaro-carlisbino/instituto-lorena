// CONFIGURAÇÃO DO FINANCEIRO — o que era código vira coisa que o financeiro mexe sozinho.
//
// Três buracos que faziam isto não ser ERP:
//
//   Centro de custo era um array `const` no fonte. Criar "Tricoscopia" ou renomear "SPA" exigia
//   deploy — a estrutura de custo da clínica dependia de programador.
//
//   As regras de classificação nasciam implícitas ao classificar um lançamento e não tinham
//   tela nenhuma. Uma regra errada carimba centenas de linhas de uma vez, e não havia como ver
//   qual regra fez o quê nem desfazer. Poder aplicar em massa sem poder revisar é a pior
//   combinação possível num financeiro.
//
//   Categoria tinha CRUD escondido dentro da tela de contas bancárias.
//
// Renomear centro de custo arrasta o histórico de propósito: `cost_center` é TEXTO nas tabelas
// que o consomem (herança de quando era array), então sem arrastar, renomear deixaria todo o
// passado num centro que não existe mais na lista — linha fantasma no relatório que ninguém
// consegue nem selecionar.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, RotateCcw, Settings2, Tag, Trash2, Wand2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { FinanceTabs } from '@/components/page/FinanceTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTenant } from '@/context/TenantContext'
import {
  deleteCategoryRule,
  deleteCostCenter,
  listCategories,
  listCategoryRules,
  listCostCenters,
  listRuleUsage,
  renameCostCenter,
  undoCategoryRule,
  upsertCategory,
  upsertCostCenter,
  type CategoryRule,
  type CostCenter,
  type FinCategory,
} from '@/services/financeiro'

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Aba = 'centros' | 'categorias' | 'regras'

export function FinanceiroConfigPage() {
  const { tenant } = useTenant()
  const [aba, setAba] = useState<Aba>('centros')
  const [centros, setCentros] = useState<CostCenter[]>([])
  const [categorias, setCategorias] = useState<FinCategory[]>([])
  const [regras, setRegras] = useState<CategoryRule[]>([])
  const [uso, setUso] = useState<Map<string, { usos: number; amountCents: number }>>(new Map())
  const [busy, setBusy] = useState(false)

  const [novoCentro, setNovoCentro] = useState('')
  const [editando, setEditando] = useState<{ id: string; de: string; para: string } | null>(null)
  const [novaCat, setNovaCat] = useState({ name: '', kind: 'despesa' as 'despesa' | 'receita' })

  const carregar = async () => {
    setBusy(true)
    try {
      const [cc, cats, rr, uu] = await Promise.all([
        listCostCenters(true),
        listCategories(undefined, true),
        listCategoryRules(),
        listRuleUsage(),
      ])
      setCentros(cc)
      setCategorias(cats)
      setRegras(rr)
      setUso(uu)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a configuração')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nomeCategoria = (id: string) => categorias.find((c) => c.id === id)?.name ?? '—'

  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      await carregar()
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na operação')
    } finally {
      setBusy(false)
    }
  }

  /** Regras ordenadas pelo que mais carimbou — regra que mexe em muito dinheiro vem primeiro. */
  const regrasOrdenadas = useMemo(
    () =>
      [...regras].sort(
        (a, b) => (uso.get(b.id)?.amountCents ?? 0) - (uso.get(a.id)?.amountCents ?? 0),
      ),
    [regras, uso],
  )

  return (
    <AppLayout
      title="Configuração do financeiro"
      subtitle="Centros de custo, categorias e as regras que classificam o extrato sozinhas."
    >
      <FinanceTabs isSalesPolo={tenant.poloType === 'sales'} />

      <div className="mb-4 flex gap-1">
        {(
          [
            ['centros', 'Centros de custo', centros.length],
            ['categorias', 'Categorias', categorias.length],
            ['regras', 'Regras de classificação', regras.length],
          ] as Array<[Aba, string, number]>
        ).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              aba === id ? 'bg-primary text-primary-foreground' : 'bg-muted/60 text-muted-foreground'
            }`}
          >
            {label} <span className="opacity-70">({n})</span>
          </button>
        ))}
      </div>

      {aba === 'centros' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Settings2 className="size-4 text-muted-foreground" /> Centros de custo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Renomear arrasta o histórico junto: o lançamento antigo passa a apontar para o nome
              novo, em vez de virar linha fantasma no relatório.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Novo centro de custo"
                value={novoCentro}
                onChange={(e) => setNovoCentro(e.target.value)}
                className="max-w-[300px]"
              />
              <Button
                size="sm"
                disabled={busy || novoCentro.trim().length < 2}
                onClick={() =>
                  void acao(async () => {
                    await upsertCostCenter({ name: novoCentro })
                    setNovoCentro('')
                  }, 'Centro criado.')
                }
              >
                <Plus className="size-4" /> Criar
              </Button>
            </div>
            <div className="space-y-1">
              {centros.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                  {editando?.id === c.id ? (
                    <>
                      <Input
                        value={editando.para}
                        onChange={(e) => setEditando({ ...editando, para: e.target.value })}
                        className="h-8 max-w-[260px]"
                      />
                      <Button
                        size="sm"
                        disabled={busy || editando.para.trim().length < 2}
                        onClick={() =>
                          void acao(async () => {
                            await renameCostCenter(c.id, editando.de, editando.para)
                            setEditando(null)
                          }, 'Renomeado, com o histórico junto.')
                        }
                      >
                        Salvar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className={`min-w-0 flex-1 ${c.active ? '' : 'text-muted-foreground line-through'}`}>
                        {c.name}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => setEditando({ id: c.id, de: c.name, para: c.name })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() =>
                          void acao(
                            () => upsertCostCenter({ id: c.id, name: c.name, active: !c.active }),
                            c.active ? 'Desativado.' : 'Reativado.',
                          )
                        }
                      >
                        {c.active ? 'Desativar' : 'Reativar'}
                      </Button>
                      {/* Apagar só faz sentido pra centro que ninguém usou; o resto desativa. */}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busy}
                        onClick={() => void acao(() => deleteCostCenter(c.id), 'Apagado.')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {aba === 'categorias' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Tag className="size-4 text-muted-foreground" /> Categorias
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input
                placeholder="Nova categoria"
                value={novaCat.name}
                onChange={(e) => setNovaCat({ ...novaCat, name: e.target.value })}
                className="max-w-[280px]"
              />
              <Select
                value={novaCat.kind}
                onValueChange={(v) => setNovaCat({ ...novaCat, kind: (v as 'despesa' | 'receita') ?? 'despesa' })}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="despesa">Despesa</SelectItem>
                  <SelectItem value="receita">Receita</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={busy || novaCat.name.trim().length < 2}
                onClick={() =>
                  void acao(async () => {
                    await upsertCategory({ name: novaCat.name, kind: novaCat.kind })
                    setNovaCat({ name: '', kind: 'despesa' })
                  }, 'Categoria criada.')
                }
              >
                <Plus className="size-4" /> Criar
              </Button>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {categorias.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                  <span className={`min-w-0 flex-1 truncate ${c.active ? '' : 'text-muted-foreground line-through'}`}>
                    {c.name}
                  </span>
                  <Badge variant={c.kind === 'receita' ? 'default' : 'secondary'}>{c.kind}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() =>
                      void acao(
                        () => upsertCategory({ id: c.id, name: c.name, kind: c.kind, active: !c.active }),
                        c.active ? 'Desativada.' : 'Reativada.',
                      )
                    }
                  >
                    {c.active ? 'Desativar' : 'Reativar'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {aba === 'regras' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wand2 className="size-4 text-muted-foreground" /> Regras de classificação
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Criadas quando você classifica um lançamento no Extrato. “Desfazer” tira a categoria
              só das linhas que <em>esta regra</em> carimbou — o que foi classificado à mão fica
              intacto.
            </p>
            {regrasOrdenadas.length === 0 ? (
              <EmptyState
                icon={Wand2}
                title={busy ? 'Carregando…' : 'Nenhuma regra ainda'}
                description="Classifique um lançamento no Extrato com “classificar todos os iguais” ligado."
              />
            ) : (
              <div className="space-y-1">
                {regrasOrdenadas.map((r) => {
                  const u = uso.get(r.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.pattern}</div>
                        <div className="text-xs text-muted-foreground">
                          → {nomeCategoria(r.categoryId)}
                          {r.costCenter ? ` · ${r.costCenter}` : ''}
                          {r.direction ? ` · ${r.direction === 'out' ? 'saídas' : 'entradas'}` : ''}
                        </div>
                      </div>
                      {u && (
                        <Badge variant="secondary" className="shrink-0">
                          {u.usos} · {brl(u.amountCents)}
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={busy || !u}
                        onClick={() =>
                          void acao(async () => {
                            const n = await undoCategoryRule(r.id)
                            toast.message(`${n} lançamento(s) voltaram a ficar sem categoria.`)
                          }, 'Regra desfeita.')
                        }
                      >
                        <RotateCcw className="size-3.5" /> Desfazer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        disabled={busy}
                        onClick={() => void acao(() => deleteCategoryRule(r.id), 'Regra apagada.')}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </AppLayout>
  )
}
