import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, FileSearch, Merge } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchField } from '@/components/ui/search-field'
import { Skeleton } from '@/components/ui/skeleton'
import { dataHora } from '@/components/estoque/kardexUi'
import { formatQtd } from '@/components/kits/kitUi'
import { estoqueTabs } from '@/pages/EstoquePage'
import { useTenant } from '@/context/TenantContext'
import { normalizarBusca } from '@/lib/busca'
import { cn } from '@/lib/utils'
import { type StockItem, getStockItem } from '@/services/estoqueCompras'
import { type ItemDeNota, juntarItem, listarItensDeNota } from '@/services/estoqueJuncao'

/** Palavras que identificam o produto: número (22, 0,9) e palavra de 3+ letras que não é enfeite. */
const IGNORAR = new Set(['com', 'para', 'sem', 'tipo', 'und', 'unid', 'caixa', 'pct', 'pacote', 'esteril', 'nao'])
function palavras(nome: string): string[] {
  return normalizarBusca(nome)
    .replace(/[^a-z0-9,]+/g, ' ')
    .split(' ')
    .map((p) => p.replace(/^,+|,+$/g, ''))
    .filter((p) => (/\d/.test(p) ? p.length >= 1 : p.length >= 3) && !IGNORAR.has(p))
}

/** Quanto o nome da nota lembra o item: palavras em comum, com número pesando mais. */
function parecenca(item: StockItem, nota: ItemDeNota): number {
  if (item.barcode && nota.codigo && item.barcode.replace(/^0+/, '') === nota.codigo.replace(/^0+/, '')) return 100
  const doItem = new Set([item.name, ...item.aliases].flatMap(palavras))
  let pontos = 0
  for (const p of new Set(palavras(nota.nome))) {
    if (doItem.has(p)) pontos += /\d/.test(p) ? 2 : 3
    else if (!/\d/.test(p) && [...doItem].some((q) => q.length >= 4 && (p.startsWith(q) || q.startsWith(p)))) pontos += 1
  }
  return pontos
}

/**
 * Achar a nota de um item que entrou com outro nome e juntar no item que a equipe usa.
 * Exemplo real: a enfermagem conta "ABOCATH Nº22", a nota do fornecedor diz "CATETER INTRAV
 * PERIF DE SEGURANCA 22G (BD)". Juntando, a nota aparece na ficha do ABOCATH e a próxima nota
 * igual já cai nele.
 */
export function EstoqueJuntarItemPage() {
  const { itemId = '' } = useParams()
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const [item, setItem] = useState<StockItem | null>(null)
  const [itensDeNota, setItensDeNota] = useState<ItemDeNota[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<ItemDeNota | null>(null)
  const [juntando, setJuntando] = useState(false)

  useEffect(() => {
    let vivo = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCarregando(true)
    Promise.all([getStockItem(itemId), listarItensDeNota()])
      .then(([it, lista]) => {
        if (!vivo) return
        setItem(it)
        setItensDeNota(lista.filter((l) => l.itemId !== itemId))
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [itemId])

  const lista = useMemo(() => {
    if (!item) return []
    const termos = normalizarBusca(busca).split(/\s+/).filter(Boolean)
    const pontuados = itensDeNota.map((n) => ({ nota: n, pontos: parecenca(item, n) }))
    if (termos.length > 0) {
      return pontuados
        .filter(({ nota }) => {
          const t = normalizarBusca([nota.nome, nota.codigo, nota.fornecedores].filter(Boolean).join(' '))
          return termos.every((termo) => t.includes(termo))
        })
        .sort((a, b) => b.pontos - a.pontos || a.nota.nome.localeCompare(b.nota.nome, 'pt-BR'))
        .slice(0, 100)
    }
    return pontuados
      .filter((p) => p.pontos >= 3)
      .sort((a, b) => b.pontos - a.pontos || (b.nota.ultimaEntrada ?? '').localeCompare(a.nota.ultimaEntrada ?? ''))
      .slice(0, 30)
  }, [item, itensDeNota, busca])

  const unidadeDiferente = escolhido != null && item != null && escolhido.unidade.trim().toLowerCase() !== item.unit.trim().toLowerCase()
  const bloqueado = unidadeDiferente && escolhido != null && Math.abs(escolhido.saldo) > 0.0001

  const confirmar = async () => {
    if (!item || !escolhido) return
    setJuntando(true)
    try {
      const r = await juntarItem(escolhido.itemId, item.id)
      toast.success(
        `"${escolhido.nome}" juntado em ${item.name}.` +
          (r.lotes > 0 ? ` ${r.lotes} ${r.lotes === 1 ? 'lote' : 'lotes'} vieram junto.` : '') +
          (r.modelos > 0 ? ` ${r.modelos} ${r.modelos === 1 ? 'linha de modelo de kit' : 'linhas de modelo de kit'} repontadas.` : ''),
      )
      navigate(`/estoque/item/${item.id}?aba=compras`, { replace: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao juntar')
    } finally {
      setJuntando(false)
    }
  }

  return (
    <AppLayout
      title="Procurar a nota do item"
      subtitle={item ? `Nota que entrou com outro nome e é ${item.name}` : 'Nota que entrou com outro nome'}
    >
      <SubTabs tabs={estoqueTabs(tenant.poloType === 'sales')} />
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <Link to={`/estoque/item/${itemId}?aba=compras`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Ficha do item
        </Link>

        {carregando ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : !item ? (
          <EmptyState icon={FileSearch} title="Item não encontrado" />
        ) : (
          <>
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <p>
                A nota chega com o nome do fornecedor e vira um cadastro separado. Ache aqui o cadastro da nota que é{' '}
                <strong>{item.name}</strong> e junte: a nota passa a aparecer na ficha, o saldo e o lote vêm junto, e a próxima
                nota igual já entra neste item.
              </p>
            </div>

            <SearchField
              value={busca}
              onChange={setBusca}
              label="Nome como vem na nota, código de barras ou fornecedor"
              resultados={lista.length}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {busca.trim() ? `${lista.length} ${lista.length === 1 ? 'cadastro' : 'cadastros'} de nota` : 'Parecidos com o nome do item. Digite para procurar outro.'}
            </p>

            {lista.length === 0 ? (
              <EmptyState
                icon={FileSearch}
                title={busca.trim() ? 'Nada com esse nome' : 'Nenhum nome parecido'}
                description="Procure por uma palavra da nota: medida (22G, 25X28), marca ou fornecedor."
              />
            ) : (
              <ul className="space-y-2">
                {lista.map(({ nota, pontos }) => (
                  <li key={nota.itemId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <Link to={`/estoque/item/${nota.itemId}`} className="hover:underline">
                          {nota.nome}
                        </Link>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {nota.notas} {nota.notas === 1 ? 'nota' : 'notas'}
                        {nota.ultimaEntrada ? ` · última ${dataHora(nota.ultimaEntrada).slice(0, 8)}` : ''}
                        {nota.fornecedores ? ` · ${nota.fornecedores}` : ''}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant={Math.abs(nota.saldo) > 0.0001 ? 'secondary' : 'outline'} className="tabular-nums">
                          saldo {formatQtd(nota.saldo)} {nota.unidade}
                        </Badge>
                        {nota.codigo ? <Badge variant="outline" className="font-mono">{nota.codigo}</Badge> : null}
                        {!nota.ativo ? <Badge variant="outline">inativo</Badge> : null}
                        {pontos >= 100 ? <Badge>mesmo código de barras</Badge> : null}
                      </div>
                    </div>
                    <Button size="sm" onClick={() => setEscolhido(nota)}>
                      <Merge className="size-4" aria-hidden /> Juntar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <Dialog open={escolhido != null} onOpenChange={(open) => (!open && !juntando ? setEscolhido(null) : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Juntar em {item?.name}</DialogTitle>
            <DialogDescription>{escolhido?.nome}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>As {escolhido?.notas} {escolhido?.notas === 1 ? 'nota aparece' : 'notas aparecem'} na ficha de {item?.name}.</li>
            {escolhido && Math.abs(escolhido.saldo) > 0.0001 ? (
              <li>
                O saldo de {formatQtd(escolhido.saldo)} {escolhido.unidade} passa para {item?.name}, no mesmo lote e setor.
              </li>
            ) : (
              <li>Não tem saldo sobrando: só a história vem junto.</li>
            )}
            <li>O cadastro da nota fica inativo. Dá para desfazer pela ficha do item.</li>
          </ul>
          {unidadeDiferente ? (
            <p className={cn('rounded-lg border px-3 py-2 text-sm', bloqueado ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'border-amber-500/40 bg-amber-500/10')}>
              {bloqueado
                ? `A nota é em ${escolhido?.unidade} e o item é contado em ${item?.unit}. Com saldo sobrando a quantidade entraria errada: zere esse cadastro pela contagem antes de juntar.`
                : `A nota é em ${escolhido?.unidade} e o item é contado em ${item?.unit}. Sem saldo sobrando, dá para juntar; a quantidade antiga na ficha continua na unidade da nota.`}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscolhido(null)} disabled={juntando}>
              Voltar
            </Button>
            <Button onClick={() => void confirmar()} disabled={juntando || bloqueado}>
              {juntando ? 'Juntando…' : 'Juntar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  )
}
