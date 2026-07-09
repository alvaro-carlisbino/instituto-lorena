import { useRef, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { lookupCep } from '@/lib/viacep'

// Formulário compartilhado de cadastro (nome/CPF/nascimento/e-mail) + endereço de entrega.
// Grava na estrutura canônica do lead: custom_fields.cadastro + custom_fields.entrega.
// Reusado na ficha do lead (LeadDetailPage) e na Frente de Loja (PDV).

export type CadastroValue = {
  nomeCompleto: string
  cpf: string
  dataNascimento: string
  email: string
}
export type EntregaValue = {
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
}

export const EMPTY_CADASTRO: CadastroValue = { nomeCompleto: '', cpf: '', dataNascimento: '', email: '' }
export const EMPTY_ENTREGA: EntregaValue = {
  cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
}

/** Lê cadastro/entrega de um custom_fields cru para os tipos do formulário. */
export function readCadastro(customFields: Record<string, unknown> | undefined | null): CadastroValue {
  const c = ((customFields ?? {}).cadastro ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    nomeCompleto: s(c.nomeCompleto),
    cpf: s(c.cpf),
    dataNascimento: s(c.dataNascimento),
    email: s(c.email ?? (customFields ?? {}).email),
  }
}
export function readEntrega(customFields: Record<string, unknown> | undefined | null): EntregaValue {
  const e = ((customFields ?? {}).entrega ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    cep: s(e.cep),
    logradouro: s(e.logradouro),
    numero: s(e.numero),
    complemento: s(e.complemento),
    bairro: s(e.bairro),
    cidade: s(e.cidade ?? e.municipio),
    uf: s(e.uf),
  }
}

type Props = {
  cadastro: CadastroValue
  entrega: EntregaValue
  onCadastroChange: (next: CadastroValue) => void
  onEntregaChange: (next: EntregaValue) => void
  /** Oculta a seção de endereço (ex.: venda de balcão só com retirada). */
  hideEndereco?: boolean
  disabled?: boolean
}

export function CadastroEnderecoForm({
  cadastro,
  entrega,
  onCadastroChange,
  onEntregaChange,
  hideEndereco,
  disabled,
}: Props) {
  const [cepLoading, setCepLoading] = useState(false)
  const lastCepLookup = useRef('')

  const setCad = (patch: Partial<CadastroValue>) => onCadastroChange({ ...cadastro, ...patch })
  const setEnt = (patch: Partial<EntregaValue>) => onEntregaChange({ ...entrega, ...patch })

  async function resolveCep(raw: string) {
    const cep = raw.replace(/\D/g, '')
    if (cep.length !== 8 || lastCepLookup.current === cep) return
    lastCepLookup.current = cep
    setCepLoading(true)
    try {
      const info = await lookupCep(cep)
      if (info) {
        // Só preenche o que estiver vazio — nunca sobrescreve o que o operador digitou.
        onEntregaChange({
          ...entrega,
          cep,
          logradouro: entrega.logradouro || info.logradouro,
          bairro: entrega.bairro || info.bairro,
          cidade: entrega.cidade || info.cidade,
          uf: entrega.uf || info.uf,
        })
      }
    } finally {
      setCepLoading(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="cad-nome">Nome completo</Label>
          <Input
            id="cad-nome"
            value={cadastro.nomeCompleto}
            disabled={disabled}
            onChange={(e) => setCad({ nomeCompleto: e.target.value })}
            placeholder="Nome do cliente (como sai na nota)"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cad-cpf">CPF</Label>
          <Input
            id="cad-cpf"
            value={cadastro.cpf}
            disabled={disabled}
            inputMode="numeric"
            onChange={(e) => setCad({ cpf: e.target.value })}
            placeholder="000.000.000-00"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cad-nasc">Nascimento</Label>
          <Input
            id="cad-nasc"
            value={cadastro.dataNascimento}
            disabled={disabled}
            onChange={(e) => setCad({ dataNascimento: e.target.value })}
            placeholder="dd/mm/aaaa"
          />
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="cad-email">E-mail</Label>
          <Input
            id="cad-email"
            type="email"
            value={cadastro.email}
            disabled={disabled}
            onChange={(e) => setCad({ email: e.target.value })}
            placeholder="email@exemplo.com (opcional)"
          />
        </div>
      </div>

      {hideEndereco ? null : (
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ent-cep">CEP {cepLoading ? <span className="text-xs text-muted-foreground">(buscando…)</span> : null}</Label>
            <Input
              id="ent-cep"
              value={entrega.cep}
              disabled={disabled}
              inputMode="numeric"
              onChange={(e) => setEnt({ cep: e.target.value })}
              onBlur={(e) => void resolveCep(e.target.value)}
              placeholder="00000-000"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-4">
            <Label htmlFor="ent-rua">Endereço</Label>
            <Input
              id="ent-rua"
              value={entrega.logradouro}
              disabled={disabled}
              onChange={(e) => setEnt({ logradouro: e.target.value })}
              placeholder="Rua / Avenida"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ent-num">Número</Label>
            <Input
              id="ent-num"
              value={entrega.numero}
              disabled={disabled}
              onChange={(e) => setEnt({ numero: e.target.value })}
              placeholder="123"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-4">
            <Label htmlFor="ent-comp">Complemento</Label>
            <Input
              id="ent-comp"
              value={entrega.complemento}
              disabled={disabled}
              onChange={(e) => setEnt({ complemento: e.target.value })}
              placeholder="Apto, bloco… (opcional)"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-3">
            <Label htmlFor="ent-bairro">Bairro</Label>
            <Input
              id="ent-bairro"
              value={entrega.bairro}
              disabled={disabled}
              onChange={(e) => setEnt({ bairro: e.target.value })}
              placeholder="Bairro"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="ent-cidade">Cidade</Label>
            <Input
              id="ent-cidade"
              value={entrega.cidade}
              disabled={disabled}
              onChange={(e) => setEnt({ cidade: e.target.value })}
              placeholder="Cidade"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-1">
            <Label htmlFor="ent-uf">UF</Label>
            <Input
              id="ent-uf"
              value={entrega.uf}
              disabled={disabled}
              maxLength={2}
              onChange={(e) => setEnt({ uf: e.target.value.toUpperCase() })}
              placeholder="PR"
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Monta o patch de custom_fields (cadastro/entrega/email) preservando o resto. */
export function mergeCadastroEntrega(
  current: Record<string, unknown> | undefined | null,
  cadastro: CadastroValue,
  entrega: EntregaValue,
): Record<string, unknown> {
  const base = { ...(current ?? {}) } as Record<string, unknown>
  const prevCad = (base.cadastro ?? {}) as Record<string, unknown>
  const prevEnt = (base.entrega ?? {}) as Record<string, unknown>
  const trim = (v: string) => v.trim()
  base.cadastro = {
    ...prevCad,
    nomeCompleto: trim(cadastro.nomeCompleto),
    cpf: trim(cadastro.cpf),
    dataNascimento: trim(cadastro.dataNascimento),
    ...(trim(cadastro.email) ? { email: trim(cadastro.email) } : {}),
  }
  base.entrega = {
    ...prevEnt,
    cep: trim(entrega.cep),
    logradouro: trim(entrega.logradouro),
    numero: trim(entrega.numero),
    complemento: trim(entrega.complemento),
    bairro: trim(entrega.bairro),
    cidade: trim(entrega.cidade),
    uf: trim(entrega.uf).toUpperCase(),
  }
  if (trim(cadastro.email)) base.email = trim(cadastro.email)
  return base
}
