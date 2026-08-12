import { supabase } from '@/lib/supabaseClient'

/**
 * "Puxar o cliente que já comprou": acha o cadastro/endereço que a MESMA pessoa já deixou em
 * OUTRO lead, pra ninguém redigitar nome/CPF/nascimento/endereço a cada compra.
 *
 * Por que existe: o cadastro da venda mora em `leads.custom_fields.cadastro/.entrega`, ou seja,
 * é por LEAD — e a mesma pessoa entra de novo como lead novo com frequência (medido em ago/26:
 * 64 telefones e 15 CPFs repetidos em mais de um lead). Quando isso acontece, o lead novo nasce
 * vazio e a atendente pede tudo outra vez, mesmo com o dado salvo no lead antigo.
 *
 * Casamento: telefone pelos ÚLTIMOS 8 DÍGITOS (imune ao 9º dígito e ao +55 — mesma ideia do
 * `brPhoneVariants`) e CPF nas duas formas em que ele foi gravado historicamente (só dígitos em
 * 168 leads, pontuado em 58). Escolhe o candidato MAIS COMPLETO e, no empate, o mais recente.
 */

export type CadastroAnterior = {
  /** custom_fields cru do lead de origem — use readCadastro/readEntrega pra ler. */
  customFields: Record<string, unknown>
  fonte: { leadId: string; nome: string; criadoEm: string | null }
}

const onlyDigits = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '')

const fmtCpf = (d: string) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`

export type LeadCandidato = {
  id: string
  patient_name: string | null
  created_at: string | null
  custom_fields: Record<string, unknown> | null
}

/** Quanto de cadastro útil o candidato tem — é o que decide qual lead antigo vale puxar. */
export function completudeCadastro(cf: Record<string, unknown> | null): number {
  const cad = ((cf ?? {}).cadastro ?? {}) as Record<string, unknown>
  const ent = ((cf ?? {}).entrega ?? {}) as Record<string, unknown>
  const s = (v: unknown) => String(v ?? '').trim()
  let n = 0
  if (s(cad.nomeCompleto).split(/\s+/).filter(Boolean).length >= 2) n += 2
  if (onlyDigits(s(cad.cpf)).length === 11) n += 2
  if (s(cad.dataNascimento)) n += 1
  if (s(cad.email)) n += 1
  if (onlyDigits(s(ent.cep)).length === 8) n += 2
  if (s(ent.numero)) n += 2
  if (s(ent.logradouro)) n += 1
  if (s(ent.cidade)) n += 1
  return n
}

export async function fetchCadastroDeCompraAnterior(input: {
  leadId: string
  phone?: string | null
  cpf?: string | null
}): Promise<CadastroAnterior | null> {
  if (!supabase) return null
  const fone8 = onlyDigits(input.phone).slice(-8)
  const cpf = onlyDigits(input.cpf)
  if (fone8.length < 8 && cpf.length !== 11) return null

  const select = 'id, patient_name, created_at, custom_fields'
  const buscas: Array<PromiseLike<{ data: unknown }>> = []
  if (fone8.length === 8) {
    buscas.push(
      supabase
        .from('leads')
        .select(select)
        .is('deleted_at', null)
        .neq('id', input.leadId)
        .ilike('phone', `%${fone8}%`)
        .order('created_at', { ascending: false })
        .limit(30),
    )
  }
  if (cpf.length === 11) {
    // CPF foi gravado das duas formas ao longo do tempo; procura pelas duas.
    buscas.push(
      supabase
        .from('leads')
        .select(select)
        .is('deleted_at', null)
        .neq('id', input.leadId)
        .or(`custom_fields->cadastro->>cpf.eq.${cpf},custom_fields->cadastro->>cpf.eq.${fmtCpf(cpf)}`)
        .order('created_at', { ascending: false })
        .limit(30),
    )
  }

  const respostas = await Promise.all(buscas.map((p) => Promise.resolve(p).catch(() => ({ data: [] }))))
  const vistos = new Set<string>()
  const candidatos: LeadCandidato[] = []
  for (const r of respostas) {
    for (const row of (r.data ?? []) as LeadCandidato[]) {
      if (!row?.id || vistos.has(row.id)) continue
      vistos.add(row.id)
      candidatos.push(row)
    }
  }
  return escolheMelhorCadastro(candidatos)
}

/**
 * Entre os leads da mesma pessoa, qual cadastro vale puxar: o MAIS COMPLETO e, no empate, o mais
 * recente. Descarta quem tem quase nada (só o primeiro nome, por exemplo) — puxar meio cadastro
 * dá mais trabalho do que digitar e, pior, faz a atendente achar que já conferiu o endereço.
 */
export function escolheMelhorCadastro(candidatos: LeadCandidato[]): CadastroAnterior | null {
  const melhor = candidatos
    .map((row) => ({ row, peso: completudeCadastro(row.custom_fields) }))
    // Só vale puxar quem tem cadastro de verdade: metade do peso máximo (12) é o corte.
    .filter((c) => c.peso >= 6)
    .sort((a, b) => b.peso - a.peso || String(b.row.created_at ?? '').localeCompare(String(a.row.created_at ?? '')))[0]

  if (!melhor) return null
  return {
    customFields: (melhor.row.custom_fields ?? {}) as Record<string, unknown>,
    fonte: {
      leadId: String(melhor.row.id),
      nome: String(melhor.row.patient_name ?? 'cliente'),
      criadoEm: melhor.row.created_at ?? null,
    },
  }
}
