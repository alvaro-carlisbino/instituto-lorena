import { supabase } from '@/lib/supabaseClient'

const assertClient = () => {
  if (!supabase) throw new Error('Sistema não configurado.')
  return supabase
}

/**
 * Busca global de paciente e retrato 360.
 *
 * Antes disso o ⌘K procurava TELA, não gente, e a ficha só lia conversa e WhatsApp.
 * Consultas do Shosp, cirurgias, tricoscopia, vendas e pagamentos existiam no banco
 * com lead_id e não apareciam em lugar nenhum perto da pessoa.
 *
 * O 360 vem num jsonb só de propósito: a ficha abria com 4 chamadas e iria para 12.
 * Em conexão de recepção isso é meio segundo de tela pulando.
 */

/** Onde a pessoa existe. Nem todo paciente tem card: a tabela `leads` exige funil,
 *  etapa e responsável, e jogar 3 mil pacientes históricos no kanban comercial não
 *  serve a ninguém. A busca acha os três, a ficha abre os três. */
export type TipoPaciente = 'lead' | 'shosp' | 'mirror'

export type PacienteEncontrado = {
  tipo: TipoPaciente
  /** Chave para abrir a ficha: id do lead, prontuário do Shosp ou id da pasta do Mirror. */
  ref: string
  leadId: string | null
  nome: string
  telefone: string | null
  prontuario: string | null
  cpf: string | null
  /** Por que este resultado apareceu: 'telefone', 'CPF', 'nome'… Sem isso o resultado parece mágica. */
  achadoPor: string
  consultas: number
  cirurgias: number
  exames: number
  vendas: number
  ultimoContato: string | null
}

export type Paciente360 = {
  paciente: {
    tipo: TipoPaciente
    ref: string
    lead_id: string | null
    tem_card: boolean
    nome: string | null
    telefone: string | null
    prontuario: string | null
    cpf: string | null
    email: string | null
    origem: string | null
    canal_atribuicao: string | null
    campanha: string | null
    temperatura: string | null
    criado_em: string | null
    ultimo_contato: string | null
    status_conversa: string | null
  }
  consultas: Array<{
    codigo: string | null; data: string | null; horario: string | null
    servico: string | null; prestador: string | null; plano: string | null; status: string | null
  }>
  cirurgias: Array<{
    id: number; dia: string | null; status: string | null; sala: string | null
    meta: number | null; extraidos: number | null; implantados: number | null
  }>
  tricoscopia: Array<{
    regiao: string | null; capturado_em: string | null
    densidade_fios_cm2: number | null; espessura_media_um: number | null
    pct_fios_finos: number | null; fios_por_uf: number | null; exames_na_regiao: number
  }>
  vendas: Array<{
    id: string; tipo: string | null; procedimento: string | null; vendido_em: string | null
    valor_centavos: number | null; entrada_centavos: number | null; forma: string | null
    parcelas: number | null; status: string | null; medico: string | null
  }>
  pagamentos: Array<{
    id: string; valor_centavos: number | null; metodo: string | null; status: string | null
    pago_em: string | null; criado_em: string | null; descricao: string | null
  }>
  tarefas_abertas: Array<{ id: string; titulo: string | null; vence_em: string | null; tipo: string | null }>
  resumo: {
    consultas: number; cirurgias: number; exames_tricoscopia: number; vendas: number
    faturado_centavos: number; pago_centavos: number; mensagens: number; nps_enviados: number
    primeira_consulta: string | null; ultima_consulta: string | null
  }
}

export async function buscarPacientes(termo: string, limite = 20): Promise<PacienteEncontrado[]> {
  const t = termo.trim()
  // Menos de 2 caracteres varre a base inteira e devolve ruído.
  if (t.length < 2) return []

  const { data, error } = await assertClient().rpc('crm_buscar_pacientes', {
    p_termo: t,
    p_limit: limite,
  })
  if (error) throw new Error(error.message)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    tipo: (String(r.tipo ?? 'lead') as TipoPaciente),
    ref: String(r.ref ?? r.lead_id ?? ''),
    leadId: (r.lead_id as string) ?? null,
    nome: String(r.nome ?? '—'),
    telefone: (r.telefone as string) ?? null,
    prontuario: (r.prontuario as string) ?? null,
    cpf: (r.cpf as string) ?? null,
    achadoPor: String(r.achado_por ?? ''),
    consultas: Number(r.consultas ?? 0),
    cirurgias: Number(r.cirurgias ?? 0),
    exames: Number(r.exames ?? 0),
    vendas: Number(r.vendas ?? 0),
    ultimoContato: (r.ultimo_contato as string) ?? null,
  }))
}

export async function carregarPaciente360(tipo: TipoPaciente, ref: string): Promise<Paciente360 | null> {
  const { data, error } = await assertClient().rpc('crm_paciente_360_ref', {
    p_tipo: tipo,
    p_ref: ref,
  })
  if (error) throw new Error(error.message)
  return (data as Paciente360 | null) ?? null
}

/** Rota da ficha para cada tipo de identidade. */
export function rotaDoPaciente(tipo: TipoPaciente, ref: string): string {
  return tipo === 'lead' ? `/leads/${ref}` : `/paciente/${tipo}/${encodeURIComponent(ref)}`
}
