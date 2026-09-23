import { supabase } from '@/lib/supabaseClient'

import type { ClinicSaleKind } from './clinicSales'

/**
 * Quanto o médico e a anestesia recebem por venda.
 *
 * CIRURGIA segue a política da clínica (16/09/2026, Luana), não a pessoa: 13% quando o médico
 * atendeu, vendeu e opera; R$ 3.200 fixo quando só opera, mais R$ 500 de indicação para quem
 * atendeu; anestesia pelo procedimento. Os valores moram em `clinic_payout_policy` e a conta roda
 * no banco (gatilho da venda). O formulário pede a prévia ao banco em vez de repetir a conta.
 *
 * PROTOCOLO continua com a regra por pessoa (`clinic_payout_rules`). As funções puras de pessoa
 * repetem aquela conta só para a prévia do formulário; quem grava é o banco.
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

// ─────────────────────────────────────────────────── cirurgia: política da clínica

export type PoliticaRepasse = {
  tenantId: string
  /** Médico que atendeu, vendeu e opera: % do valor. */
  medicoMesmoPct: number
  /** Médico que só opera (a venda veio de outro médico). */
  medicoCirurgiaoCents: number
  /** Para quem atendeu e passou a cirurgia para outro médico. */
  medicoIndicacaoCents: number
  anestSobrancelhaCents: number
  /** Feminina, masculina sem raspagem e masculina com raspagem acima do limite de UF. */
  anestPadraoCents: number
  /** Masculina com raspagem abaixo do limite de UF. */
  anestMascPequenaCents: number
  anestLimiteUf: number
  /** Soma ao procedimento. */
  anestNanofatCents: number
}

const POLITICA_COLS =
  'tenant_id, medico_mesmo_pct, medico_cirurgiao_cents, medico_indicacao_cents, anest_sobrancelha_cents, ' +
  'anest_padrao_cents, anest_masc_pequena_cents, anest_limite_uf, anest_nanofat_cents'

export async function getPoliticaRepasse(): Promise<PoliticaRepasse | null> {
  const { data, error } = await assertClient().from('clinic_payout_policy').select(POLITICA_COLS).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as unknown as Record<string, unknown>
  return {
    tenantId: String(r.tenant_id),
    medicoMesmoPct: Number(r.medico_mesmo_pct ?? 0),
    medicoCirurgiaoCents: Number(r.medico_cirurgiao_cents ?? 0),
    medicoIndicacaoCents: Number(r.medico_indicacao_cents ?? 0),
    anestSobrancelhaCents: Number(r.anest_sobrancelha_cents ?? 0),
    anestPadraoCents: Number(r.anest_padrao_cents ?? 0),
    anestMascPequenaCents: Number(r.anest_masc_pequena_cents ?? 0),
    anestLimiteUf: Number(r.anest_limite_uf ?? 0),
    anestNanofatCents: Number(r.anest_nanofat_cents ?? 0),
  }
}

/** Salvar recalcula todas as cirurgias do polo que não tiveram o valor digitado à mão. */
export async function salvarPoliticaRepasse(p: PoliticaRepasse): Promise<void> {
  const { data, error } = await assertClient()
    .from('clinic_payout_policy')
    .update({
      medico_mesmo_pct: p.medicoMesmoPct,
      medico_cirurgiao_cents: Math.max(0, Math.round(p.medicoCirurgiaoCents)),
      medico_indicacao_cents: Math.max(0, Math.round(p.medicoIndicacaoCents)),
      anest_sobrancelha_cents: Math.max(0, Math.round(p.anestSobrancelhaCents)),
      anest_padrao_cents: Math.max(0, Math.round(p.anestPadraoCents)),
      anest_masc_pequena_cents: Math.max(0, Math.round(p.anestMascPequenaCents)),
      anest_limite_uf: Math.max(1, Math.round(p.anestLimiteUf)),
      anest_nanofat_cents: Math.max(0, Math.round(p.anestNanofatCents)),
    })
    .eq('tenant_id', p.tenantId)
    .select('tenant_id')
  if (error) throw new Error(traduzErro(error.message))
  // A RLS filtra a gravação sem erro: zero linhas é "sem permissão", não sucesso.
  if (!data || data.length === 0) throw new Error('Só o financeiro e a gerência alteram a política de repasse.')
}

export type RegraMedicoCirurgia = 'mesmo_medico' | 'outro_cirurgiao' | 'sem_cirurgiao'

export type PreviaCirurgia = {
  temPolitica: boolean
  medicoCents: number | null
  cirurgiaoCents: number | null
  indicacaoCents: number
  medicoPct: number | null
  medicoRegra: RegraMedicoCirurgia | null
  /** O que a clínica ainda paga: a política menos a entrada que o paciente já pagou. null = o nome do procedimento não diz qual anestesia é. */
  anestesiaCents: number | null
  anestesiaRegra: string | null
  /** O que a política manda, antes de abater a entrada. */
  anestesiaPoliticaCents: number | null
  /** Quanto da entrada do paciente já cobriu a anestesia. */
  anestesiaEntradaCents: number
  /** UF que valeu na conta: da sala quando ligada, senão a previsão. */
  uf: number | null
  ufDaSala: boolean
}

export async function previaRepasseCirurgia(input: {
  procedimento: string
  atendeu: string
  opera: string
  valorCents: number
  semRaspagem: boolean
  uf: number | null
  srgSurgeryId: number | null
  /** Entrada do paciente: no transplante ela já é o pagamento do anestesista. */
  entradaCents: number
}): Promise<PreviaCirurgia> {
  const { data, error } = await assertClient().rpc('clinic_repasse_previa', {
    p_procedimento: input.procedimento,
    p_atendeu: input.atendeu || null,
    p_opera: input.opera || null,
    p_valor: Math.max(0, Math.round(input.valorCents)),
    p_sem_raspagem: input.semRaspagem,
    p_uf: input.uf,
    p_srg: input.srgSurgeryId,
    p_entrada: Math.max(0, Math.round(input.entradaCents)),
  })
  if (error) throw new Error(error.message)
  const r = ((data ?? []) as Array<Record<string, unknown>>)[0] ?? {}
  const n = (v: unknown) => (v == null ? null : Number(v))
  const regra = r.medico_regra
  return {
    temPolitica: r.tem_politica === true,
    medicoCents: n(r.medico_cents),
    cirurgiaoCents: n(r.cirurgiao_cents),
    indicacaoCents: Number(r.indicacao_cents ?? 0),
    medicoPct: n(r.medico_pct),
    medicoRegra:
      regra === 'mesmo_medico' || regra === 'outro_cirurgiao' || regra === 'sem_cirurgiao' ? regra : null,
    anestesiaCents: n(r.anestesia_cents),
    anestesiaRegra: r.anestesia_regra != null ? String(r.anestesia_regra) : null,
    anestesiaPoliticaCents: n(r.anestesia_politica_cents),
    anestesiaEntradaCents: Number(r.anestesia_entrada_cents ?? 0),
    uf: n(r.uf),
    ufDaSala: r.uf_da_sala === true,
  }
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

/** De onde saiu o repasse do médico, na linha curta embaixo do campo. */
export function descreverMedicoCirurgia(p: PreviaCirurgia, atendeu: string, opera: string): string {
  if (!p.temPolitica) return 'sem política de repasse'
  if (p.medicoRegra === 'sem_cirurgiao' || p.medicoRegra == null) return 'escolha quem opera'
  if (p.medicoRegra === 'mesmo_medico') {
    return `${(p.medicoPct ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}% do valor: atendeu, vendeu e opera`
  }
  const cirurgiao = `${brl(p.cirurgiaoCents ?? 0)} para ${opera || 'quem opera'}`
  return p.indicacaoCents > 0 && atendeu
    ? `${cirurgiao} + ${brl(p.indicacaoCents)} de indicação para ${atendeu}`
    : cirurgiao
}

export function descreverAnestesiaCirurgia(p: PreviaCirurgia): string {
  if (!p.temPolitica) return 'sem política de repasse'
  if (p.anestesiaCents == null) return 'o procedimento não diz qual anestesia'
  const regra = p.ufDaSala ? `${p.anestesiaRegra ?? ''} (UF da sala)` : (p.anestesiaRegra ?? '')
  // A entrada do transplante É o pagamento do anestesista. Sem dizer isso aqui, o campo
  // zerado vira mistério e alguém digita o valor cheio por cima.
  // O campo mostra a anestesia cheia (lib/valorDaCirurgia); a frase diz quem pagou.
  if (p.anestesiaEntradaCents > 0) {
    return p.anestesiaCents === 0
      ? `${regra}: paga com a entrada do paciente`
      : `${regra}: ${brl(p.anestesiaEntradaCents)} da entrada + ${brl(p.anestesiaCents)} da clínica`
  }
  return regra
}
