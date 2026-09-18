// LISTAS DO SISTEMA — o vocabulário do comercial deixa de ser código.
//
// O financeiro já tinha isso desde agosto (/financeiro-config: centro de custo, linha do DRE,
// regra de classificação). O comercial não: procedimento, protocolo, tipo de consulta, forma de
// pagamento, origem da venda, motivo de perda, canal e resultado de follow-up eram arrays `const`
// em `src/services`. Quem descobre que falta um procedimento é quem vende — e, sem esta tela, ela
// escrevia a palavra que faltava em outro campo, ou pedia e esperava deploy.
//
// Três coisas que esta tela faz e um CRUD comum não faria:
//
//   RENOMEAR ARRASTA O HISTÓRICO. O texto fica gravado na venda, no lead, no follow-up. Trocar o
//   nome sem arrastar parte o relatório em duas linhas para a mesma coisa, e a linha velha não
//   aparece em filtro nenhum.
//
//   MOSTRA O QUE ESTÁ NO DADO E FORA DA LISTA. A importação da planilha trouxe "CRED 2X",
//   "CRED 3X", "CRED 10X" para o que a clínica chama de "Cartão de crédito". Isso não aparecia em
//   canto nenhum do sistema; aqui aparece com a contagem, e mesclar é um clique.
//
//   DÁ PESO ANTES DE APAGAR. Apagar a opção não apaga o histórico — mas quem aperta precisa saber
//   quantos registros continuam escritos com aquele nome.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ListTree, Merge, Pencil, Plus, Trash2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LISTAS,
  MODULOS_DE_LISTA,
  definicaoDaLista,
  type ChaveLista,
  type ModuloLista,
} from '@/config/listas'
import {
  apagarOpcao,
  atualizarOpcao,
  criarOpcao,
  limparCacheDeOpcoes,
  listarOpcoes,
  renomearOpcao,
  usoDaLista,
  type OpcaoLista,
} from '@/services/listas'

const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`

export function ListasPage() {
  const [chave, setChave] = useState<ChaveLista>('venda_procedimento')
  const [opcoes, setOpcoes] = useState<OpcaoLista[]>([])
  const [uso, setUso] = useState<Map<string, number>>(new Map())
  const [contagens, setContagens] = useState<Map<ChaveLista, number>>(new Map())
  const [busy, setBusy] = useState(false)

  const [nova, setNova] = useState('')
  const [editando, setEditando] = useState<{ id: string; de: string; para: string } | null>(null)
  const [apagando, setApagando] = useState<OpcaoLista | null>(null)
  const [mesclando, setMesclando] = useState<{ de: string; para: string } | null>(null)

  const def = definicaoDaLista(chave)

  const carregar = async (alvo: ChaveLista) => {
    setBusy(true)
    try {
      // O peso de cada opção é informação a mais: se a contagem falhar (sessão sem permissão
      // na RPC, por exemplo), a lista ainda tem que abrir para editar.
      const [rows, u] = await Promise.all([
        listarOpcoes(alvo, true),
        usoDaLista(alvo).catch(() => new Map<string, number>()),
      ])
      setOpcoes(rows)
      setUso(u)
      setContagens((c) => new Map(c).set(alvo, rows.filter((r) => r.active).length))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar a lista')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // `carregar` liga o "carregando" antes do primeiro await; o efeito aqui é a sincronização
    // com o banco, que é exatamente para o que ele serve.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregar(chave)
  }, [chave])

  /** Trocar de lista limpa o que estava no meio do caminho: edição aberta e campo de criação. */
  const escolher = (alvo: ChaveLista) => {
    setEditando(null)
    setNova('')
    setChave(alvo)
  }

  /** Toda ação recarrega e limpa o cache que os formulários usam — senão a mudança só aparece no F5. */
  const acao = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      limparCacheDeOpcoes(chave)
      await carregar(chave)
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na operação')
    } finally {
      setBusy(false)
    }
  }

  /**
   * O que está gravado no dado e não está cadastrado. Ordenado pelo que mais pesa.
   *
   * A comparação é pelo que o REGISTRO guarda: em lista com código, é o código, não o rótulo.
   */
  const foraDaLista = useMemo(() => {
    const cadastradas = new Set(opcoes.map((o) => (o.value ?? o.label).trim().toLowerCase()))
    return [...uso.entries()]
      .filter(([label]) => !cadastradas.has(label.trim().toLowerCase()))
      .sort((a, b) => b[1] - a[1])
  }, [opcoes, uso])

  const trocarOrdem = async (i: number, direcao: -1 | 1) => {
    const j = i + direcao
    if (j < 0 || j >= opcoes.length) return
    const a = opcoes[i]
    const b = opcoes[j]
    // Ordem repetida (tudo nasce com 100 ou 500) empataria e o clique não faria nada visível.
    await acao(async () => {
      await atualizarOpcao(a.id, { sortOrder: (j + 1) * 10 })
      await atualizarOpcao(b.id, { sortOrder: (i + 1) * 10 })
    }, 'Ordem trocada.')
  }

  const porModulo = (m: ModuloLista) => LISTAS.filter((l) => l.modulo === m)

  return (
    <AppLayout
      title="Listas do sistema"
      subtitle="As opções que aparecem para escolher nos formulários. Criar, renomear, desativar e apagar, sem deploy."
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_1fr]">
        <nav className="space-y-4">
          {MODULOS_DE_LISTA.map((m) => (
            <div key={m}>
              <div className="mb-1 px-1 text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {m}
              </div>
              <div className="space-y-0.5">
                {porModulo(m).map((l) => (
                  <button
                    key={l.chave}
                    type="button"
                    onClick={() => escolher(l.chave)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                      chave === l.chave
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted/60'
                    }`}
                  >
                    <span className="min-w-0 truncate">{l.titulo}</span>
                    {contagens.has(l.chave) ? (
                      <span className="shrink-0 text-xs opacity-70">{contagens.get(l.chave)}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListTree className="size-4 text-muted-foreground" /> {def.titulo}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {def.explicacao} Aparece em: <span className="font-medium">{def.ondeAparece}</span>.
                {def.arrastaHistorico
                  ? ' Renomear muda também os registros antigos que usavam o nome anterior.'
                  : ''}
              </p>

              <div className="flex gap-2">
                <Input
                  placeholder="Nova opção"
                  value={nova}
                  onChange={(e) => setNova(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nova.trim().length >= 2 && !busy) {
                      void acao(async () => {
                        await criarOpcao(chave, nova)
                        setNova('')
                      }, 'Opção criada.')
                    }
                  }}
                  className="max-w-[340px]"
                />
                <Button
                  size="sm"
                  disabled={busy || nova.trim().length < 2}
                  onClick={() =>
                    void acao(async () => {
                      await criarOpcao(chave, nova)
                      setNova('')
                    }, 'Opção criada.')
                  }
                >
                  <Plus className="size-4" /> Criar
                </Button>
              </div>

              {opcoes.length === 0 ? (
                <EmptyState
                  icon={ListTree}
                  title={busy ? 'Carregando…' : 'Lista vazia'}
                  description="Enquanto estiver vazia, os formulários usam a lista que veio no sistema."
                />
              ) : (
                <div className="space-y-1">
                  {opcoes.map((o, i) => {
                    const n = uso.get(o.value ?? o.label) ?? 0
                    return (
                      <div
                        key={o.id}
                        className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
                      >
                        {editando?.id === o.id ? (
                          <>
                            <Input
                              value={editando.para}
                              onChange={(e) => setEditando({ ...editando, para: e.target.value })}
                              className="h-8 max-w-[340px]"
                            />
                            <Button
                              size="sm"
                              className="h-8"
                              disabled={busy || editando.para.trim().length < 2}
                              onClick={() =>
                                void acao(async () => {
                                  const arrastados = await renomearOpcao(
                                    chave,
                                    editando.de,
                                    editando.para,
                                  )
                                  setEditando(null)
                                  if (arrastados > 0) {
                                    toast.message(
                                      `${plural(arrastados, 'registro antigo passou', 'registros antigos passaram')} a usar o nome novo.`,
                                    )
                                  }
                                }, 'Opção renomeada.')
                              }
                            >
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => setEditando(null)}
                            >
                              Cancelar
                            </Button>
                            {def.arrastaHistorico && n > 0 ? (
                              <span className="w-full text-xs text-muted-foreground">
                                {plural(n, 'registro vai', 'registros vão')} junto com o nome novo.
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span
                              className={`min-w-0 flex-1 truncate text-sm ${
                                o.active ? '' : 'text-muted-foreground line-through'
                              }`}
                            >
                              {o.label}
                              {o.value ? (
                                <span className="ml-2 text-xs text-muted-foreground">{o.value}</span>
                              ) : null}
                            </span>
                            {n > 0 ? (
                              <Badge variant="secondary" className="shrink-0 text-[0.65rem]">
                                {plural(n, 'uso', 'usos')}
                              </Badge>
                            ) : null}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-1.5"
                              disabled={busy || i === 0}
                              onClick={() => void trocarOrdem(i, -1)}
                              aria-label="Subir"
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-1.5"
                              disabled={busy || i === opcoes.length - 1}
                              onClick={() => void trocarOrdem(i, 1)}
                              aria-label="Descer"
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              onClick={() => setEditando({ id: o.id, de: o.label, para: o.label })}
                              aria-label="Renomear"
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
                                  () => atualizarOpcao(o.id, { active: !o.active }),
                                  o.active ? 'Desativada.' : 'Reativada.',
                                )
                              }
                            >
                              {o.active ? 'Desativar' : 'Reativar'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2"
                              disabled={busy}
                              onClick={() => setApagando(o)}
                              aria-label="Apagar"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {foraDaLista.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Merge className="size-4 text-muted-foreground" /> No dado, fora da lista
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  O que já está gravado em registro e não aparece para escolher, quase sempre
                  grafia que veio de importação ou de campo livre. Adicionar coloca na lista como
                  está.
                  {def.arrastaHistorico
                    ? ' Mesclar troca por uma opção existente e leva os registros junto.'
                    : ''}
                </p>
                <div className="space-y-1">
                  {foraDaLista.map(([label, n]) => (
                    <div
                      key={label}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
                      <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                        {plural(n, 'uso', 'usos')}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() => void acao(() => criarOpcao(chave, label), 'Adicionada à lista.')}
                      >
                        Adicionar
                      </Button>
                      {def.arrastaHistorico ? (
                      <Select
                        value=""
                        onValueChange={(v) => {
                          if (v) setMesclando({ de: label, para: String(v) })
                        }}
                      >
                        <SelectTrigger className="h-7 w-[190px] text-xs">
                          <SelectValue placeholder="Mesclar em…" />
                        </SelectTrigger>
                        <SelectContent>
                          {opcoes
                            .filter((o) => o.active)
                            .map((o) => (
                              <SelectItem key={o.id} value={o.label}>
                                {o.label}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      ) : null}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={apagando !== null}
        onOpenChange={(v) => !v && setApagando(null)}
        title={`Apagar “${apagando?.label ?? ''}”?`}
        description={
          (uso.get(apagando?.label ?? '') ?? 0) > 0
            ? `${plural(uso.get(apagando?.label ?? '') ?? 0, 'registro continua', 'registros continuam')} com esse texto gravado: o histórico não muda, a opção só some da lista de escolha. Para sumir da escolha e poder voltar atrás, use Desativar.`
            : 'Ninguém usou esta opção ainda. Ela sai da lista de escolha.'
        }
        confirmLabel="Apagar"
        onConfirm={() => {
          const alvo = apagando
          setApagando(null)
          if (alvo) void acao(() => apagarOpcao(alvo.id), 'Opção apagada.')
        }}
      />

      <ConfirmDialog
        open={mesclando !== null}
        onOpenChange={(v) => !v && setMesclando(null)}
        variant="default"
        icon={Merge}
        title={`Mesclar “${mesclando?.de ?? ''}” em “${mesclando?.para ?? ''}”?`}
        description={`${plural(uso.get(mesclando?.de ?? '') ?? 0, 'registro passa', 'registros passam')} a usar “${mesclando?.para ?? ''}”. Não tem desfazer: o texto antigo deixa de existir no histórico.`}
        confirmLabel="Mesclar"
        onConfirm={() => {
          const alvo = mesclando
          setMesclando(null)
          if (alvo) {
            void acao(async () => {
              const n = await renomearOpcao(chave, alvo.de, alvo.para)
              toast.message(`${plural(n, 'registro passou', 'registros passaram')} a usar “${alvo.para}”.`)
            }, 'Mesclado.')
          }
        }}
      />
    </AppLayout>
  )
}
