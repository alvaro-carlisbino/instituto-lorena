import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Search, ShoppingCart, UserPlus } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  CadastroEnderecoForm,
  EMPTY_CADASTRO,
  EMPTY_ENTREGA,
  mergeCadastroEntrega,
  type CadastroValue,
  type EntregaValue,
} from '@/components/leads/CadastroEnderecoForm'
import { useCrm } from '@/context/CrmContext'
import { useTenant } from '@/context/TenantContext'
import { upsertPosLead } from '@/services/crmPos'
import { searchShospPatients, type ShospPatientCandidate } from '@/services/shosp'
import type { Lead } from '@/mocks/crmMock'

const onlyDigits = (v: string) => String(v ?? '').replace(/\D/g, '')

// Frente de Loja (PDV): busca/cadastra o cliente (Shosp por CPF/nome + leads existentes) e
// leva pro fechamento — reusa a tela de venda (/leads/:id/venda), que já monta o carrinho do
// Bling, recebe (PIX/cartão/já pago) e cria o pedido no Bling.
export function FrenteLojaPage() {
  const crm = useCrm()
  const { tenant } = useTenant()
  const navigate = useNavigate()

  const [term, setTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [shosp, setShosp] = useState<ShospPatientCandidate[]>([])
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [showNew, setShowNew] = useState(false)
  const [newPhone, setNewPhone] = useState('')
  const [cadastro, setCadastro] = useState<CadastroValue>(EMPTY_CADASTRO)
  const [entrega, setEntrega] = useState<EntregaValue>(EMPTY_ENTREGA)
  const [creating, setCreating] = useState(false)

  const termDigits = onlyDigits(term)
  const leadMatches: Lead[] =
    term.trim().length < 3
      ? []
      : crm.leads
          .filter((l) => {
            const name = l.patientName.toLowerCase()
            const cpf = onlyDigits(String((l.customFields?.cadastro as Record<string, unknown> | undefined)?.cpf ?? ''))
            return (
              name.includes(term.trim().toLowerCase()) ||
              (termDigits.length >= 3 && (onlyDigits(l.phone).includes(termDigits) || cpf.includes(termDigits)))
            )
          })
          .slice(0, 8)

  async function doSearch() {
    const q = term.trim()
    if (q.length < 3) {
      toast.error('Digite ao menos 3 caracteres (nome ou CPF).')
      return
    }
    setSearching(true)
    setSearched(false)
    setSearchError(null)
    try {
      // CPF puro → só busca por CPF (1 chamada ao Shosp). Nome → só por nome. Evita queimar o
      // limite da API do Shosp com buscas redundantes (CPF sendo procurado também como nome).
      const isCpf = termDigits.length === 11 && /^[\d.\s-]+$/.test(q)
      const res = await searchShospPatients(isCpf ? { nome: '', cpf: termDigits } : { nome: q })
      setShosp(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha na busca Shosp.'
      toast.error(msg)
      setShosp([])
      setSearchError(msg)
    } finally {
      setSearching(false)
      setSearched(true)
    }
  }

  async function goToSale(leadId: string) {
    // Garante que o lead recém-criado entrou no estado local antes de abrir a venda.
    try {
      await crm.syncFromSupabase()
    } catch {
      // segue mesmo assim — a tela de venda tenta resolver o lead
    }
    navigate(`/leads/${leadId}/venda`)
  }

  async function createLeadAndSell(input: {
    name: string
    phone: string
    cadastro: CadastroValue
    entrega: EntregaValue
    shospProntuario?: string | null
  }) {
    const owner = crm.sdrMembers[0]?.id
    const pipeline = crm.selectedPipeline
    const stage = pipeline?.stages?.[0]
    if (!owner || !pipeline || !stage) {
      toast.error('Funil ou equipe não configurados neste workspace.')
      return
    }
    if (!input.name.trim()) {
      toast.error('Informe o nome do cliente.')
      return
    }
    setCreating(true)
    try {
      const id = `lead-pdv-${Date.now()}`
      const customFields = mergeCadastroEntrega({ origin: 'pdv' }, input.cadastro, input.entrega)
      await upsertPosLead({
        id,
        patientName: input.name.trim(),
        phone: onlyDigits(input.phone),
        ownerId: owner,
        pipelineId: pipeline.id,
        stageId: stage.id,
        tenantId: tenant.id,
        customFields,
        shospProntuario: input.shospProntuario ?? null,
      })
      toast.success('Cliente pronto — abrindo a venda.')
      await goToSale(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao criar o cliente.')
    } finally {
      setCreating(false)
    }
  }

  function sellShosp(c: ShospPatientCandidate) {
    void createLeadAndSell({
      name: c.nome,
      phone: c.celular || c.telefone || '',
      cadastro: {
        nomeCompleto: c.nome,
        cpf: c.cpf ? onlyDigits(c.cpf) : '',
        dataNascimento: c.dataNascimento ?? '',
        email: '',
      },
      entrega: EMPTY_ENTREGA,
      shospProntuario: c.prontuario,
    })
  }

  return (
    <AppLayout
      title="Frente de Loja"
      subtitle="Venda de balcão — busca o cliente e leva pro fechamento com pedido no Bling."
    >
      <div className="grid gap-4">
        {tenant.poloType !== 'sales' ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            A Frente de Loja é do workspace <strong>Tricopill</strong>. Troque de polo no topo da barra lateral para vender aqui.
          </div>
        ) : null}

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">1. Buscar cliente</h2>
          <div className="flex gap-2">
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch()
              }}
              placeholder="Nome ou CPF do cliente"
            />
            <Button onClick={() => void doSearch()} disabled={searching}>
              <Search className="mr-1 size-4" /> {searching ? 'Buscando…' : 'Buscar'}
            </Button>
          </div>

          {leadMatches.length ? (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Já no CRM</p>
              <ul className="grid gap-1.5">
                {leadMatches.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{l.patientName}</span>
                      <span className="ml-2 text-muted-foreground">{l.phone}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => void goToSale(l.id)}>
                      <ShoppingCart className="mr-1 size-4" /> Vender
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {searched ? (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pacientes Shosp
              </p>
              {searchError ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700 dark:text-amber-300">
                  {searchError} Você ainda pode cadastrar o cliente na hora abaixo.
                </p>
              ) : shosp.length ? (
                <ul className="grid gap-1.5">
                  {shosp.map((c) => (
                    <li
                      key={c.prontuario}
                      className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{c.nome}</span>
                        <span className="ml-2 text-muted-foreground">
                          {c.celular || c.telefone || 'sem telefone'}
                          {c.cpf ? ` · ${c.cpf}` : ''}
                        </span>
                      </span>
                      <Button size="sm" variant="secondary" disabled={creating} onClick={() => sellShosp(c)}>
                        <ShoppingCart className="mr-1 size-4" /> Vender
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum paciente encontrado no Shosp.</p>
              )}
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">2. Cliente novo</h2>
            <Button variant={showNew ? 'ghost' : 'outline'} size="sm" onClick={() => setShowNew((v) => !v)}>
              <UserPlus className="mr-1 size-4" /> {showNew ? 'Fechar' : 'Cadastrar novo'}
            </Button>
          </div>
          {showNew ? (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor="new-phone">Telefone / WhatsApp</Label>
                <Input
                  id="new-phone"
                  value={newPhone}
                  inputMode="tel"
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="(44) 99999-9999"
                />
              </div>
              <CadastroEnderecoForm
                cadastro={cadastro}
                entrega={entrega}
                onCadastroChange={setCadastro}
                onEntregaChange={setEntrega}
              />
              <div>
                <Button
                  disabled={creating}
                  onClick={() =>
                    void createLeadAndSell({ name: cadastro.nomeCompleto, phone: newPhone, cadastro, entrega })
                  }
                >
                  <ShoppingCart className="mr-1 size-4" /> {creating ? 'Criando…' : 'Criar e ir para a venda'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Não achou o cliente? Cadastre na hora e siga para a venda.
            </p>
          )}
        </section>
      </div>
    </AppLayout>
  )
}
