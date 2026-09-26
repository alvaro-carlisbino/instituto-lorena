import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Minus, Plus, Printer, RefreshCw, Ruler, ScanLine, Settings2 } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QtyStepper } from '@/components/estoque/QtyStepper'
import {
  CALIBRAR_ZPL,
  CONFIGURACAO_ZPL,
  type ConfigEtiqueta,
  type PacoteParaEtiqueta,
  etiquetaZpl,
  guardarConfigEtiqueta,
  lerConfigEtiqueta,
  reguaZpl,
} from '@/lib/etiquetaCme'
import { enviarParaZebra, imprimirPelaJanela, logoDaEtiqueta } from '@/lib/impressaoCme'
import { cn } from '@/lib/utils'
import { ErroZebra, type ImpressoraZebra, LARGURA_MAXIMA_MM, type MotivoErroZebra, acharImpressora } from '@/lib/zebra'
import { listarAutoclaves, listarColaboradores, listarMateriais } from '@/services/cme'

// /cme/etiqueta: a Zebra da CME. Mostra se o Browser Print achou a impressora, guarda o tamanho do
// rolo e o ajuste fino neste computador, e imprime etiquetas de teste, régua e calibração.

// Código que o sistema nunca gera (29 + 9999999999): bipado, não acha pacote nenhum.
const CODIGO_DE_TESTE = '2999999999991'

const PRESETS: Array<{ rotulo: string; larguraMm: number; alturaMm: number }> = [
  { rotulo: '110 × 150 (rolo grande)', larguraMm: 110, alturaMm: 150 },
  { rotulo: '100 × 50', larguraMm: 100, alturaMm: 50 },
  { rotulo: '60 × 30', larguraMm: 60, alturaMm: 30 },
]

type Conexao =
  | { estado: 'procurando' }
  | { estado: 'ok'; escolhida: ImpressoraZebra; todas: ImpressoraZebra[] }
  | { estado: 'erro'; motivo: MotivoErroZebra; mensagem: string }

type Registro = { hora: string; acao: string; ok: boolean; detalhe: string }

function amostraInicial(): PacoteParaEtiqueta {
  const validade = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  return {
    codigo: CODIGO_DE_TESTE,
    materialNome: 'Caixa Transplante 1',
    lote: 'TESTE',
    autoclave: 'Autoclave 1',
    metodo: 'Vapor saturado sob pressão',
    esterilizadoEm: new Date().toISOString(),
    validade,
    responsavel: 'Teste',
  }
}

function Opcoes<T extends string | boolean>({
  valor,
  opcoes,
  onChange,
  rotulo,
}: {
  valor: T
  opcoes: ReadonlyArray<readonly [T, string]>
  onChange: (v: T) => void
  rotulo: string
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={rotulo}>
      {opcoes.map(([v, texto]) => (
        <Button key={String(v)} type="button" size="sm" variant={valor === v ? 'default' : 'outline'} aria-pressed={valor === v} onClick={() => onChange(v)}>
          {texto}
        </Button>
      ))}
    </div>
  )
}

/** − valor + com passo fracionado (o QtyStepper é de quantidade inteira e positiva). */
function Ajuste({ rotulo, valor, passo, min, max, unidade, onChange }: { rotulo: string; valor: number; passo: number; min: number; max: number; unidade?: string; onChange: (v: number) => void }) {
  const limitar = (v: number) => Math.round(Math.min(max, Math.max(min, v)) * 10) / 10
  return (
    <div className="space-y-1.5">
      <Label>{rotulo}</Label>
      <div className="inline-flex h-10 items-center rounded-lg border border-input bg-background">
        <Button type="button" variant="ghost" size="icon" className="h-full w-10 rounded-r-none" aria-label={`Diminuir ${rotulo}`} onClick={() => onChange(limitar(valor - passo))} disabled={valor <= min}>
          <Minus className="size-4" aria-hidden />
        </Button>
        <span className="min-w-16 border-x border-input px-2 text-center text-sm font-medium tabular-nums">
          {valor > 0 ? `+${String(valor).replace('.', ',')}` : String(valor).replace('.', ',')}
          {unidade ? ` ${unidade}` : ''}
        </span>
        <Button type="button" variant="ghost" size="icon" className="h-full w-10 rounded-l-none" aria-label={`Aumentar ${rotulo}`} onClick={() => onChange(limitar(valor + passo))} disabled={valor >= max}>
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}

/** Pergunta ao Browser Print pela Zebra e guarda a escolhida na configuração. */
async function buscarZebra(setConexao: (c: Conexao) => void, setConfig: Dispatch<SetStateAction<ConfigEtiqueta>>) {
  try {
    const r = await acharImpressora(lerConfigEtiqueta().zebra?.uid)
    setConexao({ estado: 'ok', ...r })
    setConfig((c) => (c.zebra?.uid === r.escolhida.uid ? c : { ...c, zebra: r.escolhida }))
  } catch (e) {
    setConexao({
      estado: 'erro',
      motivo: e instanceof ErroZebra ? e.motivo : 'sem_browser_print',
      mensagem: e instanceof Error ? e.message : 'O Browser Print não respondeu.',
    })
  }
}

export function CmeEtiquetaPage() {
  const [config, setConfig] = useState<ConfigEtiqueta>(lerConfigEtiqueta)
  const [conexao, setConexao] = useState<Conexao>({ estado: 'procurando' })
  const [amostra, setAmostra] = useState<PacoteParaEtiqueta>(amostraInicial)
  const [copias, setCopias] = useState(1)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [registros, setRegistros] = useState<Registro[]>([])
  const [ultimoZpl, setUltimoZpl] = useState('')

  const mudar = (parcial: Partial<ConfigEtiqueta>) => setConfig((c) => ({ ...c, ...parcial }))
  useEffect(() => guardarConfigEtiqueta(config), [config])

  useEffect(() => {
    void buscarZebra(setConexao, setConfig)
  }, [])
  const procurar = () => {
    setConexao({ estado: 'procurando' })
    void buscarZebra(setConexao, setConfig)
  }

  // Etiqueta de teste com o que já está no cadastro: material, autoclave e colaborador de verdade.
  useEffect(() => {
    Promise.all([listarMateriais(), listarAutoclaves(), listarColaboradores()])
      .then(([materiais, autoclaves, colaboradores]) => {
        const m = materiais[0]
        const a = autoclaves[0]
        setAmostra((s) => ({
          ...s,
          materialNome: m?.nome ?? s.materialNome,
          autoclave: a?.nome ?? s.autoclave,
          metodo: a?.metodo ?? s.metodo,
          responsavel: colaboradores[0]?.nome ?? s.responsavel,
          validade: m ? new Date(Date.now() + m.validadeDias * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : s.validade,
        }))
      })
      .catch(() => {
        /* fica a amostra padrão */
      })
  }, [])

  const registrar = (acao: string, ok: boolean, detalhe: string) =>
    setRegistros((r) => [{ hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), acao, ok, detalhe }, ...r].slice(0, 12))

  const mandar = async (acao: string, gerar: () => Promise<string>) => {
    setEnviando(acao)
    try {
      const zpl = await gerar()
      setUltimoZpl(zpl)
      const impressora = await enviarParaZebra(zpl, config)
      registrar(acao, true, `enviado para ${impressora.name}`)
      toast.success(`${acao}: enviado para a Zebra.`)
      if (conexao.estado !== 'ok') procurar()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao enviar'
      registrar(acao, false, msg)
      toast.error(msg)
    } finally {
      setEnviando(null)
    }
  }

  const imprimirTeste = () => {
    const pacote = { ...amostra, esterilizadoEm: new Date().toISOString() }
    if (config.impressao === 'navegador') {
      imprimirPelaJanela(Array.from({ length: copias }, () => pacote), config)
      registrar('Etiqueta de teste', true, 'aberta a janela de impressão')
      return
    }
    void mandar('Etiqueta de teste', async () => etiquetaZpl(pacote, config, copias, await logoDaEtiqueta(config)))
  }

  const zebra = config.impressao === 'zebra'
  const larguraDemais = config.larguraMm > LARGURA_MAXIMA_MM
  const resumo = useMemo(
    () => `${config.larguraMm} × ${config.alturaMm} mm · ${config.codigo === 'qr' ? 'QR' : 'barras'}${config.logo ? ' · com logo' : ''}`,
    [config.larguraMm, config.alturaMm, config.codigo, config.logo],
  )

  return (
    <AppLayout title="Etiqueta e impressora" subtitle="A Zebra da CME: conexão, tamanho do rolo e etiquetas de teste.">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'size-2.5 shrink-0 rounded-full',
                  conexao.estado === 'ok' ? 'bg-emerald-500' : conexao.estado === 'procurando' ? 'animate-pulse bg-amber-500' : 'bg-red-500',
                )}
                aria-hidden
              />
              <p className="min-w-0 text-sm">
                {conexao.estado === 'procurando' ? (
                  'Procurando a Zebra pelo Browser Print…'
                ) : conexao.estado === 'ok' ? (
                  <>
                    <span className="font-medium">{conexao.escolhida.name}</span>
                    <span className="text-muted-foreground"> · {conexao.escolhida.connection}</span>
                  </>
                ) : (
                  <span className="text-destructive">{conexao.mensagem}</span>
                )}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={procurar} disabled={conexao.estado === 'procurando'}>
              <RefreshCw className="size-4" aria-hidden /> Procurar de novo
            </Button>
          </div>

          {conexao.estado === 'ok' && conexao.todas.length > 1 ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Impressora">
              {conexao.todas.map((d) => (
                <Button
                  key={d.uid}
                  size="sm"
                  variant={config.zebra?.uid === d.uid ? 'default' : 'outline'}
                  aria-pressed={config.zebra?.uid === d.uid}
                  onClick={() => {
                    mudar({ zebra: d })
                    setConexao({ ...conexao, escolhida: d })
                  }}
                >
                  {d.name}
                </Button>
              ))}
            </div>
          ) : null}

          {conexao.estado === 'erro' ? (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              {conexao.motivo === 'sem_browser_print' ? (
                <>
                  <li>
                    Instale o <span className="font-medium text-foreground">Zebra Browser Print</span> neste computador (site da Zebra, busque por Browser Print) e deixe
                    ele aberto.
                  </li>
                  <li>Ligue a ZD220 no USB. No Windows, instale também o driver ZDesigner.</li>
                  <li>
                    No Browser Print, em Settings, escolha a ZD220 como impressora padrão. Quando ele perguntar se aceita este site, clique em Yes. Se o Chrome perguntar
                    se o site pode acessar apps deste computador, clique em Permitir.
                  </li>
                  <li>
                    Clique em Procurar de novo. Se ainda não achar (ou se for Safari), abra{' '}
                    <a className="underline" href="https://127.0.0.1:9101/ssl_support" target="_blank" rel="noreferrer">
                      https://127.0.0.1:9101/ssl_support
                    </a>
                    , aceite o certificado e volte aqui.
                  </li>
                </>
              ) : (
                <li>Confira se a Zebra está ligada, com o cabo USB no computador, e se aparece na lista do Browser Print.</li>
              )}
            </ol>
          ) : null}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">Testes</h2>
            <p className="text-xs text-muted-foreground">{resumo}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <QtyStepper value={copias} onChange={setCopias} min={1} max={20} label="cópias de teste" className="h-10" />
            <Button className="h-10" onClick={imprimirTeste} disabled={enviando !== null}>
              <Printer className="size-4" aria-hidden /> {enviando === 'Etiqueta de teste' ? 'Enviando…' : 'Imprimir etiqueta de teste'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A de teste sai com lote TESTE e o código {CODIGO_DE_TESTE}, que o sistema nunca usa: se for bipada, não acha pacote nenhum.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!zebra || enviando !== null} onClick={() => void mandar('Régua de alinhamento', async () => reguaZpl(config))}>
              <Ruler className="size-4" aria-hidden /> Régua de alinhamento
            </Button>
            <Button variant="outline" size="sm" disabled={!zebra || enviando !== null} onClick={() => void mandar('Calibrar o rolo', async () => CALIBRAR_ZPL)}>
              <ScanLine className="size-4" aria-hidden /> Calibrar o rolo
            </Button>
            <Button variant="outline" size="sm" disabled={!zebra || enviando !== null} onClick={() => void mandar('Configuração da impressora', async () => CONFIGURACAO_ZPL)}>
              <Settings2 className="size-4" aria-hidden /> Configuração da impressora
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Régua: moldura na borda da etiqueta e marcas a cada 5 mm, para conferir tamanho e posição. Calibrar: a Zebra puxa algumas etiquetas até achar o espaço entre
            elas (faça depois de trocar o rolo). Configuração: a própria Zebra imprime resolução, sensor e escuridão.
          </p>
          {registros.length > 0 ? (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
              {registros.map((r, i) => (
                <li key={`${r.hora}-${i}`} className="flex items-start gap-2 px-3 py-2">
                  <span className="shrink-0 tabular-nums text-muted-foreground">{r.hora}</span>
                  {r.ok ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="ok" /> : <span className="shrink-0 font-medium text-destructive">falhou</span>}
                  <span className="min-w-0">
                    <span className="font-medium">{r.acao}</span>
                    <span className="text-muted-foreground"> · {r.detalhe}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="space-y-4">
          <h2 className="text-base font-semibold">Etiqueta</h2>
          <div className="space-y-1.5">
            <Label>Como imprimir</Label>
            <Opcoes
              rotulo="Como imprimir"
              valor={config.impressao}
              onChange={(v) => mudar({ impressao: v })}
              opcoes={[
                ['zebra', 'Direto na Zebra'],
                ['navegador', 'Pela janela de impressão'],
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Direto na Zebra sai no tamanho exato, sem janela, e é o que os ciclos usam. A janela de impressão fica de reserva para quando o Browser Print não estiver
              instalado.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Tamanho do rolo (largura × altura, mm)</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => {
                const ativo = config.larguraMm === p.larguraMm && config.alturaMm === p.alturaMm
                return (
                  <Button key={p.rotulo} size="sm" variant={ativo ? 'default' : 'outline'} aria-pressed={ativo} onClick={() => mudar({ larguraMm: p.larguraMm, alturaMm: p.alturaMm })}>
                    {p.rotulo}
                  </Button>
                )
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="et-l">Largura</Label>
                <Input
                  id="et-l"
                  inputMode="numeric"
                  value={config.larguraMm}
                  onChange={(e) => mudar({ larguraMm: Math.min(150, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                  className="h-10 w-24"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="et-a">Altura</Label>
                <Input
                  id="et-a"
                  inputMode="numeric"
                  value={config.alturaMm}
                  onChange={(e) => mudar({ alturaMm: Math.min(150, Number(e.target.value.replace(/\D/g, '')) || 0) })}
                  className="h-10 w-24"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Largura é a medida de lado a lado do rolo, como ele entra na Zebra.
              {larguraDemais ? ` A ZD220 imprime até ${LARGURA_MAXIMA_MM} mm: num rolo de ${config.larguraMm} ficam uns ${Math.round((config.larguraMm - LARGURA_MAXIMA_MM) / 2)} mm de cada lado sem impressão.` : ''}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Código</Label>
              <Opcoes
                rotulo="Tipo de código"
                valor={config.codigo}
                onChange={(v) => mudar({ codigo: v })}
                opcoes={[
                  ['qr', 'QR code'],
                  ['barras', 'Código de barras'],
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Logo do Instituto</Label>
              <Opcoes
                rotulo="Logo"
                valor={config.logo}
                onChange={(v) => mudar({ logo: v })}
                opcoes={[
                  [true, 'Com logo'],
                  [false, 'Sem logo'],
                ]}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">QR só é lido por leitor 2D (o que lê código no celular). Se o leitor da montagem não ler o QR, use código de barras.</p>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Ajuste fino</Label>
            <div className="flex flex-wrap items-end gap-4">
              <Ajuste rotulo="Para a direita" valor={config.ajusteXMm} passo={0.5} min={-20} max={20} unidade="mm" onChange={(v) => mudar({ ajusteXMm: v })} />
              <Ajuste rotulo="Para baixo" valor={config.ajusteYMm} passo={0.5} min={-20} max={20} unidade="mm" onChange={(v) => mudar({ ajusteYMm: v })} />
              <Ajuste rotulo="Escuridão" valor={config.escuridao} passo={1} min={-15} max={15} onChange={(v) => mudar({ escuridao: v })} />
              <div className="space-y-1.5">
                <Label>Posição</Label>
                <Opcoes
                  rotulo="Posição"
                  valor={config.girar}
                  onChange={(v) => mudar({ girar: v })}
                  opcoes={[
                    [false, 'Normal'],
                    [true, 'Virada 180°'],
                  ]}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Imprima a régua e veja para onde o desenho escapou. Escuridão soma à da própria Zebra: se a etiqueta sair clara, suba; se borrar, desça. Tudo fica guardado
              neste computador.
            </p>
          </div>
        </section>

        {ultimoZpl ? (
          <details className="rounded-xl border border-border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">Ver o ZPL do último teste</summary>
            <div className="mt-2 space-y-2">
              <textarea readOnly value={ultimoZpl} className="h-48 w-full rounded-lg border border-input bg-background p-2 font-mono text-xs" aria-label="ZPL enviado" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(ultimoZpl).then(
                    () => toast.success('ZPL copiado.'),
                    () => toast.error('Não deu para copiar.'),
                  )
                }}
              >
                <Copy className="size-4" aria-hidden /> Copiar
              </Button>
            </div>
          </details>
        ) : null}
      </div>
    </AppLayout>
  )
}

export default CmeEtiquetaPage
