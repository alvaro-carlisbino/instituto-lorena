import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link2Off, Link2, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  getLeadShospProntuario,
  linkLeadToShospPatient,
  searchShospPatients,
  unlinkLeadShospPatient,
  type ShospPatientCandidate,
} from '@/services/shosp'

type Props = {
  leadId: string
  leadName: string
  /** Telefone do lead (real; sintético 888001 é ignorado no ranking). */
  leadPhone?: string
  /** CPF captado no cadastro da conversa — confirmação mais forte. */
  leadCpf?: string
  /** Nascimento captado (DD/MM/AAAA) — confirma homônimos. */
  leadNascimento?: string
}

const last8 = (v: string | undefined) => {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.startsWith('888001')) return '' // sintético ManyChat não confirma ninguém
  return d.length >= 8 ? d.slice(-8) : ''
}

/** Normaliza data pra tupla comparável: aceita DD/MM/AAAA e AAAA-MM-DD. */
const dateKey = (v: string | undefined): string => {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  return ''
}

type Ranked = ShospPatientCandidate & { hits: string[]; score: number }

/**
 * Vínculo manual lead ↔ paciente Shosp. Necessário porque a maioria dos leads do
 * WhatsApp tem telefone sintético do ManyChat e não casa sozinho no sync.
 * Busca AUTOMÁTICA ao abrir + ranking: candidatos com CPF/telefone/nascimento
 * iguais aos do lead sobem com selo verde — vincular vira um clique consciente.
 */
export function ShospLinkSection({ leadId, leadName, leadPhone, leadCpf, leadNascimento }: Props) {
  const [prontuario, setProntuario] = useState<string | null>(null)
  const [query, setQuery] = useState(leadName)
  const [results, setResults] = useState<Ranked[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [linking, setLinking] = useState(false)

  const rank = (list: ShospPatientCandidate[]): Ranked[] => {
    const cpfDigits = String(leadCpf ?? '').replace(/\D/g, '')
    const phone8 = last8(leadPhone)
    const nascKey = dateKey(leadNascimento)
    return list
      .map((c) => {
        const hits: string[] = []
        let score = 0
        if (cpfDigits.length === 11 && String(c.cpf ?? '').replace(/\D/g, '') === cpfDigits) {
          hits.push('CPF confere')
          score += 100
        }
        if (phone8 && (last8(c.celular) === phone8 || last8(c.telefone) === phone8)) {
          hits.push('Telefone confere')
          score += 80
        }
        if (nascKey && dateKey(c.dataNascimento) === nascKey) {
          hits.push('Nascimento confere')
          score += 60
        }
        return { ...c, hits, score }
      })
      .sort((a, b) => b.score - a.score)
  }

  const runSearch = async (term: string) => {
    const nome = term.trim()
    if (nome.length < 3 && String(leadCpf ?? '').replace(/\D/g, '').length !== 11) {
      toast.message('Digite ao menos 3 letras do nome.')
      return
    }
    setSearching(true)
    setSearched(false)
    try {
      const r = await searchShospPatients({ nome, cpf: leadCpf })
      setResults(rank(r))
      setSearched(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao buscar na Shosp.')
    } finally {
      setSearching(false)
    }
  }

  useEffect(() => {
    setQuery(leadName)
    setResults([])
    setSearched(false)
    let cancelled = false
    void getLeadShospProntuario(leadId).then((p) => {
      if (cancelled) return
      setProntuario(p)
      // Sem vínculo → já busca sozinho com o nome do lead (e CPF, se captado).
      if (!p && leadName.trim().length >= 3) void runSearch(leadName)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, leadName])

  const handleLink = async (c: ShospPatientCandidate) => {
    setLinking(true)
    try {
      await linkLeadToShospPatient(leadId, c.prontuario)
      setProntuario(c.prontuario)
      setResults([])
      setSearched(false)
      toast.success(`Paciente vinculado (prontuário ${c.prontuario}). A agenda sincroniza em até 15 min.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao vincular.')
    } finally {
      setLinking(false)
    }
  }

  const handleUnlink = async () => {
    setLinking(true)
    try {
      await unlinkLeadShospPatient(leadId)
      setProntuario(null)
      toast.success('Vínculo removido.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover vínculo.')
    } finally {
      setLinking(false)
    }
  }

  return (
    <section
      aria-labelledby="lead-shosp-link-heading"
      className="rounded-md border border-border/80 bg-muted/10 p-3"
    >
      <h2
        id="lead-shosp-link-heading"
        className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
      >
        Vínculo com a Shosp
      </h2>

      {prontuario ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-0.5 text-sm font-medium text-emerald-600">
            <Link2 className="size-4" /> Vinculado — prontuário {prontuario}
          </span>
          <Button variant="ghost" size="sm" disabled={linking} onClick={() => void handleUnlink()}>
            <Link2Off className="size-4 mr-1.5" /> Desvincular
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome do paciente na Shosp"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch(query)
              }}
            />
            <Button type="button" size="sm" disabled={searching} onClick={() => void runSearch(query)}>
              <Search className="size-4 mr-1.5" /> {searching ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          {results.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {results.map((c) => (
                <li
                  key={c.prontuario}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                    c.score >= 80
                      ? 'border-emerald-500/50 bg-emerald-500/5'
                      : 'border-border/60 bg-card/40',
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {c.nome || '(sem nome)'}
                      {c.hits.map((h) => (
                        <span
                          key={h}
                          className="ml-1.5 inline-flex rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
                        >
                          ✓ {h}
                        </span>
                      ))}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      Prontuário {c.prontuario}
                      {c.celular ? ` · ${c.celular}` : ''}
                      {c.dataNascimento ? ` · nasc. ${c.dataNascimento}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant={c.score >= 80 ? 'default' : 'outline'}
                    size="sm"
                    disabled={linking}
                    onClick={() => void handleLink(c)}
                  >
                    Vincular
                  </Button>
                </li>
              ))}
            </ul>
          ) : searched && !searching ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nenhum paciente encontrado. Tente só o primeiro nome, ou o nome como está na Shosp
              (a busca ignora acentos e a ordem das palavras).
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
