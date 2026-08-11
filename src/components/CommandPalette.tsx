import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { RefreshCw, Star, User } from 'lucide-react'

import { NAV_GROUPS, groupedDestinations, visibleDestinations } from '@/config/navigation'
import { useCrm } from '@/context/CrmContext'
import { useNavContext } from '@/hooks/useNavContext'
import { useNavPrefs } from '@/hooks/useNavPrefs'
import { onOpenCommandPalette } from '@/lib/commandPalette'
import { cn } from '@/lib/utils'
import { CRM_ASSISTANT_PATH } from '@/services/crmAiAssistant'
import { buscarPacientes, rotaDoPaciente, type PacienteEncontrado } from '@/services/pacienteBusca'

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground'

/**
 * Paleta de comandos (⌘K).
 *
 * Antes trazia ~20 telas escritas à mão que já não batiam com a barra lateral — oferecia
 * /visoes (escondida) e chamava /tarefas de "Tarefas e NPS" depois da migração do NPS.
 * Agora lê o mesmo registro da navegação, então acha qualquer tela que o usuário
 * enxergue, com os apelidos do dia a dia ("quadro", "pdv", "boleto", "leitor").
 *
 * E busca GENTE, não só tela. Até aqui o sistema inteiro não tinha um lugar para
 * procurar paciente: quem atendia no telefone precisava adivinhar em qual tela
 * aquela pessoa estaria. Agora nome, telefone, CPF e prontuário caem todos aqui.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [termo, setTermo] = useState('')
  const [pacientes, setPacientes] = useState<PacienteEncontrado[]>([])
  const navigate = useNavigate()
  const crm = useCrm()
  const navContext = useNavContext()
  const canSync = crm.currentPermission.canRouteLeads || crm.currentPermission.canManageUsers

  const available = useMemo(() => visibleDestinations(navContext), [navContext])
  const groups = useMemo(() => groupedDestinations(navContext), [navContext])
  const { favorites, isFavorite, toggleFavorite } = useNavPrefs(available)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => onOpenCommandPalette(() => setOpen(true)), [])

  // Some com o resultado velho ao fechar, senão a paleta reabre mostrando a busca anterior.
  useEffect(() => {
    if (!open) { setTermo(''); setPacientes([]) }
  }, [open])

  // Debounce: sem ele, "maria" dispara 5 buscas e a última a responder ganha,
  // que nem sempre é a da palavra inteira.
  useEffect(() => {
    const t = termo.trim()
    if (t.length < 2) { setPacientes([]); return }
    let vivo = true
    const id = setTimeout(() => {
      buscarPacientes(t, 8)
        .then((r) => { if (vivo) setPacientes(r) })
        .catch(() => { if (vivo) setPacientes([]) })
    }, 220)
    return () => { vivo = false; clearTimeout(id) }
  }, [termo])

  const go = (path: string) => {
    navigate(path)
    setOpen(false)
  }

  // O assistente carrega o lead aberto no momento, então não é um link fixo.
  const goAiAssistant = () => {
    const lead = crm.selectedLeadId
    go(lead ? `${CRM_ASSISTANT_PATH}?leadId=${encodeURIComponent(lead)}&focus=lead` : CRM_ASSISTANT_PATH)
  }

  const groupLabel = (id: string) => NAV_GROUPS.find((g) => g.id === id)?.label ?? id

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Menu rápido"
      overlayClassName="fixed inset-0 z-50 bg-black/40 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
      contentClassName={cn(
        'fixed left-[50%] top-[12%] z-50 max-h-[min(70vh,32rem)] w-[min(100%-2rem,32rem)] -translate-x-1/2',
        'overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg',
        'data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
      )}
      className="[&_[cmdk-group-heading]]:select-none [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      <Command.Input
        value={termo}
        onValueChange={setTermo}
        // O que dá para digitar precisa estar escrito: ninguém tenta o número do pedido
        // num campo que promete só "paciente".
        placeholder="Nome, telefone, CPF, e-mail, pedido… ou uma tela"
        className="flex h-11 w-full border-b border-border bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-[min(60vh,28rem)] overflow-y-auto p-1">
        <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum resultado.</Command.Empty>

        {/* "Pessoas", não "Pacientes": a mesma busca acha o paciente da clínica e o
            cliente da loja, e chamar tudo de paciente escondia metade do resultado. */}
        {pacientes.length > 0 ? (
          <Command.Group heading="Pessoas">
            {pacientes.map((p) => {
              // O que a pessoa tem, resumido: quem atende sabe na hora se tem
              // cirurgia e exame ou se é só um lead sem histórico.
              const selos = [
                p.consultas ? `${p.consultas} consulta${p.consultas > 1 ? 's' : ''}` : '',
                p.cirurgias ? `${p.cirurgias} cirurgia${p.cirurgias > 1 ? 's' : ''}` : '',
                p.exames ? `${p.exames} exame${p.exames > 1 ? 's' : ''}` : '',
                p.vendas ? `${p.vendas} compra${p.vendas > 1 ? 's' : ''}` : '',
              ].filter(Boolean).join(' · ')
              return (
                <Command.Item
                  key={`pac-${p.leadId}`}
                  className={ITEM_CLASS}
                  // O termo digitado entra como keyword para o filtro do cmdk não
                  // descartar um resultado que o BANCO já disse que casa.
                  keywords={[termo, p.telefone ?? '', p.prontuario ?? '', p.cpf ?? '']}
                  onSelect={() => go(rotaDoPaciente(p.tipo, p.ref))}
                >
                  <User className="size-4 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">
                    {p.nome}
                    {selos ? <span className="ml-2 text-xs text-muted-foreground">{selos}</span> : null}
                  </span>
                  {p.tipo !== 'lead' && (
                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {p.tipo === 'shosp' ? 'sem card' : 'tricoscopia'}
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-muted-foreground">por {p.achadoPor}</span>
                </Command.Item>
              )
            })}
          </Command.Group>
        ) : null}

        {favorites.length > 0 ? (
          <Command.Group heading="Favoritos">
            {favorites.map((destination) => {
              const { icon: NavIcon } = destination
              return (
                <Command.Item
                  key={`fav-${destination.id}`}
                  className={ITEM_CLASS}
                  keywords={destination.keywords}
                  onSelect={() => go(destination.path)}
                >
                  <NavIcon className="size-4 shrink-0 opacity-70" />
                  {destination.label}
                </Command.Item>
              )
            })}
          </Command.Group>
        ) : null}

        {groups.map((group) => (
          <Command.Group key={group.id} heading={groupLabel(group.id)}>
            {group.items.map((destination) => {
              const { icon: NavIcon } = destination
              const favorited = isFavorite(destination.id)
              return (
                <Command.Item
                  key={destination.id}
                  className={ITEM_CLASS}
                  keywords={destination.keywords}
                  onSelect={() =>
                    destination.id === 'assistente' ? goAiAssistant() : go(destination.path)
                  }
                >
                  <NavIcon className="size-4 shrink-0 opacity-70" />
                  <span className="flex-1 truncate">{destination.label}</span>
                  {/* Fixar sem sair da paleta: o clique não deve navegar junto. */}
                  <button
                    type="button"
                    aria-label={favorited ? `Desafixar ${destination.label}` : `Fixar ${destination.label}`}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleFavorite(destination.id)
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Star className={cn('size-3.5', favorited && 'fill-current text-primary')} aria-hidden />
                  </button>
                </Command.Item>
              )
            })}
          </Command.Group>
        ))}

        <Command.Group heading="Ações">
          <Command.Item
            className={ITEM_CLASS}
            disabled={crm.isLoading || !canSync}
            keywords={['sincronizar', 'recarregar', 'refresh']}
            onSelect={() => {
              if (!crm.isLoading && canSync) void crm.syncFromSupabase()
              setOpen(false)
            }}
          >
            <RefreshCw className={cn('size-4 shrink-0 opacity-70', crm.isLoading && 'animate-spin')} />
            Atualizar dados
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  )
}
