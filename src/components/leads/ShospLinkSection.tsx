import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LinkBreak, LinkSimple, MagnifyingGlass } from 'phosphor-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getLeadShospProntuario,
  linkLeadToShospPatient,
  searchShospPatients,
  unlinkLeadShospPatient,
  type ShospPatientCandidate,
} from '@/services/shosp'

type Props = { leadId: string; leadName: string }

/**
 * Vínculo manual lead ↔ paciente Shosp. Necessário porque a maioria dos leads do
 * WhatsApp tem telefone sintético do ManyChat e não casa sozinho no sync. Vinculado
 * o prontuário, as consultas do paciente passam a contar no funil real.
 */
export function ShospLinkSection({ leadId, leadName }: Props) {
  const [prontuario, setProntuario] = useState<string | null>(null)
  const [query, setQuery] = useState(leadName)
  const [results, setResults] = useState<ShospPatientCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    setQuery(leadName)
    setResults([])
    setSearched(false)
    let cancelled = false
    void getLeadShospProntuario(leadId).then((p) => {
      if (!cancelled) setProntuario(p)
    })
    return () => {
      cancelled = true
    }
  }, [leadId, leadName])

  const handleSearch = async () => {
    const nome = query.trim()
    if (nome.length < 3) {
      toast.message('Digite ao menos 3 letras do nome.')
      return
    }
    setSearching(true)
    setSearched(false)
    try {
      const r = await searchShospPatients({ nome })
      setResults(r)
      setSearched(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao buscar na Shosp.')
    } finally {
      setSearching(false)
    }
  }

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
            <LinkSimple className="size-4" /> Vinculado — prontuário {prontuario}
          </span>
          <Button variant="ghost" size="sm" disabled={linking} onClick={() => void handleUnlink()}>
            <LinkBreak className="size-4 mr-1.5" /> Desvincular
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Leads do WhatsApp não casam sozinhos com a Shosp (telefone do ManyChat). Busque o paciente pelo nome e
            vincule para as consultas dele entrarem no funil real.
          </p>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome do paciente na Shosp"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch()
              }}
            />
            <Button type="button" size="sm" disabled={searching} onClick={() => void handleSearch()}>
              <MagnifyingGlass className="size-4 mr-1.5" /> {searching ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          {results.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {results.map((c) => (
                <li
                  key={c.prontuario}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.nome || '(sem nome)'}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Prontuário {c.prontuario}
                      {c.celular ? ` · ${c.celular}` : ''}
                      {c.dataNascimento ? ` · nasc. ${c.dataNascimento}` : ''}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
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
              Nenhum paciente encontrado. Tente o nome completo como está cadastrado na Shosp.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
