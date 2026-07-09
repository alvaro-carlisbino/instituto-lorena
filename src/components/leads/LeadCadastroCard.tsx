import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  CadastroEnderecoForm,
  mergeCadastroEntrega,
  readCadastro,
  readEntrega,
} from '@/components/leads/CadastroEnderecoForm'
import { syncLeadContato } from '@/services/crmBling'
import type { Lead } from '@/mocks/crmMock'

// Cartão de "Cadastro de venda / entrega" da ficha do lead: exibe e (para quem pode rotear
// leads) permite EDITAR nome/CPF/nascimento/e-mail + endereço, e sincronizar com o Bling
// (cria/atualiza o contato e conserta o pedido vinculado). Grava em custom_fields.cadastro/entrega.

type Props = {
  lead: Lead
  onPatch: (next: Lead) => void
  canEdit: boolean
  /** Habilita o botão "Atualizar no Bling" (só no modo Supabase). */
  canSyncBling: boolean
}

export function LeadCadastroCard({ lead, onPatch, canEdit, canSyncBling }: Props) {
  const [editing, setEditing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const cf = (lead.customFields ?? {}) as Record<string, unknown>
  const cadastro = readCadastro(cf)
  const entrega = readEntrega(cf)

  const enderecoLinha = [entrega.logradouro, entrega.numero].filter(Boolean).join(', ')
  const cidadeLinha = [entrega.bairro, [entrega.cidade, entrega.uf].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' · ')
  const hasAny =
    cadastro.nomeCompleto || cadastro.cpf || entrega.cep || entrega.numero || entrega.logradouro || entrega.cidade

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const r = await syncLeadContato(lead.id)
      setSyncMsg({
        ok: true,
        text: r.orderUpdated
          ? `Contato #${r.contatoId} atualizado no Bling e pedido vinculado corrigido.`
          : `Contato #${r.contatoId} criado/atualizado no Bling.`,
      })
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof Error ? e.message : 'Falha ao sincronizar com o Bling.' })
    } finally {
      setSyncing(false)
    }
  }

  const Row = ({ label, value }: { label: string; value: string }) =>
    value ? (
      <div className="flex flex-col">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="break-words">{value}</dd>
      </div>
    ) : null

  return (
    <section aria-labelledby="lead-cadastro-heading" className="rounded-md border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="lead-cadastro-heading" className="text-sm font-semibold">
          Cadastro de venda / entrega
        </h2>
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Concluir' : hasAny ? 'Editar' : 'Preencher'}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <CadastroEnderecoForm
          cadastro={cadastro}
          entrega={entrega}
          onCadastroChange={(next) =>
            onPatch({ ...lead, customFields: mergeCadastroEntrega(cf, next, entrega) })
          }
          onEntregaChange={(next) =>
            onPatch({ ...lead, customFields: mergeCadastroEntrega(cf, cadastro, next) })
          }
        />
      ) : hasAny ? (
        <dl className="grid gap-1.5 text-sm sm:grid-cols-2">
          <Row label="Nome completo" value={cadastro.nomeCompleto} />
          <Row label="CPF" value={cadastro.cpf} />
          <Row label="CEP" value={entrega.cep} />
          <Row label="Endereço" value={enderecoLinha} />
          <Row label="Complemento" value={entrega.complemento} />
          <Row label="Bairro / Cidade" value={cidadeLinha} />
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Sem cadastro de venda ainda.</p>
      )}

      {canSyncBling ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="outline" size="sm" onClick={() => void handleSync()} disabled={syncing || !cadastro.nomeCompleto}>
            {syncing ? 'Sincronizando…' : 'Atualizar no Bling'}
          </Button>
          {!cadastro.nomeCompleto ? (
            <span className="text-xs text-muted-foreground">Preencha o nome completo para sincronizar.</span>
          ) : null}
          {syncMsg ? (
            <span className={syncMsg.ok ? 'text-xs text-emerald-600 dark:text-emerald-400' : 'text-xs text-destructive'}>
              {syncMsg.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
