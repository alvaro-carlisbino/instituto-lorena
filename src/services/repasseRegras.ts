import { supabase } from '@/lib/supabaseClient'

import type { ClinicSaleKind } from './clinicSales'

/**
 * Regra de repasse: quanto o médico que opera e a anestesia recebem por venda.
 *
 * Não existia regra em lugar nenhum até 16/09/2026, e por isso "os repasses não calculavam": o
 * campo era digitado, e ninguém digitou em 441 vendas. A conta de verdade roda no banco
 * (`clinic_payout_cents`, trigger da venda). As funções puras daqui repetem a mesma conta só
 * para o formulário mostrar o valor enquanto a Aline digita; quem grava é o banco.
 */

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

export type PapelRepasse = 'medico' | 'anestesia'
export type ModoRepasse = 'percentual' | 'fixo'

export type RegraRepasse = {
  id: string
  papel: PapelRepasse
  pessoa: string
  kind: ClinicSaleKind
  modo: ModoRepasse
  /** 0..100, quando o modo é percentual. */
  percentual: number | null
  /** Valor fixo por venda, quando o modo é fixo. */
  fixoCents: number | null
}

/** Mesma chave do índice único do banco: sem caixa e sem espaço nas pontas. */
export const chavePessoa = (nome: string | null | undefined) => (nome ?? '').trim().toLowerCase()

export function acharRegra(
  regras: RegraRepasse[],
  papel: PapelRepasse,
  kind: ClinicSaleKind,
  pessoa: string | null | undefined,
): RegraRepasse | null {
  const chave = chavePessoa(pessoa)
  if (!chave) return null
  return regras.find((r) => r.papel === papel && r.kind === kind && chavePessoa(r.pessoa) === chave) ?? null
}

/** Arredonda igual ao `round()` do Postgres: meio centavo sobe. */
export function calcularRepasse(regra: RegraRepasse | null, valorCents: number): number {
  if (!regra) return 0
  if (regra.modo === 'fixo') return Math.max(0, regra.fixoCents ?? 0)
  return Math.round((Math.max(0, valorCents) * (regra.percentual ?? 0)) / 100)
}

export function descreverRegra(regra: RegraRepasse): string {
  if (regra.modo === 'fixo') {
    return `${((regra.fixoCents ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por venda`
  }
  return `${(regra.percentual ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}% do valor`
}

function daLinha(r: Record<string, unknown>): RegraRepasse {
  return {
    id: String(r.id),
    papel: r.role === 'anestesia' ? 'anestesia' : 'medico',
    pessoa: String(r.person_name ?? ''),
    kind: r.kind === 'protocolo' ? 'protocolo' : 'cirurgia',
    modo: r.mode === 'fixo' ? 'fixo' : 'percentual',
    percentual: r.percent != null ? Number(r.percent) : null,
    fixoCents: r.fixed_cents != null ? Number(r.fixed_cents) : null,
  }
}

export async function listRegrasRepasse(): Promise<RegraRepasse[]> {
  const { data, error } = await assertClient()
    .from('clinic_payout_rules')
    .select('id, role, person_name, kind, mode, percent, fixed_cents')
    .order('person_name', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>).map(daLinha)
}

export type RegraRepasseInput = Omit<RegraRepasse, 'id'>

const traduzErro = (msg: string) =>
  /row-level security|violates row-level/i.test(msg)
    ? 'Só o financeiro e a gerência alteram regra de repasse.'
    : msg

/**
 * Grava a regra da pessoa. Não usa upsert: o índice único é de expressão (lower/btrim) e o
 * PostgREST não casa `onConflict` com ele. Quem chama passa o id da regra que já existe.
 */
export async function salvarRegraRepasse(id: string | null, input: RegraRepasseInput): Promise<void> {
  const row = {
    role: input.papel,
    person_name: input.pessoa.trim(),
    kind: input.kind,
    mode: input.modo,
    percent: input.modo === 'percentual' ? input.percentual : null,
    fixed_cents: input.modo === 'fixo' ? Math.max(0, Math.round(input.fixoCents ?? 0)) : null,
  }
  const client = assertClient()
  const { error } = id
    ? await client.from('clinic_payout_rules').update(row).eq('id', id)
    : await client.from('clinic_payout_rules').insert(row)
  if (error) throw new Error(traduzErro(error.message))
}

export async function apagarRegraRepasse(id: string): Promise<void> {
  const { error } = await assertClient().from('clinic_payout_rules').delete().eq('id', id)
  if (error) throw new Error(traduzErro(error.message))
}
