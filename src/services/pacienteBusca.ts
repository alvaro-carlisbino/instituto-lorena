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
  /** ID do polo dono da pessoa (não o nome — é o que `switchTenant` recebe). A busca
   *  varre todos os polos de que o usuário é membro, e clínica e vendas não se misturam
   *  sem etiqueta. Null para paciente do Shosp sem card e para pasta de tricoscopia,
   *  que são da clínica por natureza. */
  polo: string | null
  consultas: number
  cirurgias: number
  exames: number
  vendas: number
  ultimoContato: string | null
}

/** Endereço + rastreio do último envio, como o bot de vendas grava em `custom_fields.entrega`. */
export type EntregaPaciente = {
  cep?: string; logradouro?: string; numero?: string; complemento?: string
  bairro?: string; cidade?: string; uf?: string
  service?: string; tracking?: string; status?: string
  me_status_raw?: string; tracking_updated_at?: string
}

export type Paciente360 = {
  paciente: {
    tipo: TipoPaciente
    ref: string
    lead_id: string | null
    tem_card: boolean
    nome: string | null
    /** Nome do cadastro de venda — costuma ser o nome inteiro, o do card é o do WhatsApp. */
    nome_completo: string | null
    telefone: string | null
    prontuario: string | null
    cpf: string | null
    email: string | null
    nascimento: string | null
    origem: string | null
    canal_atribuicao: string | null
    campanha: string | null
    temperatura: string | null
    criado_em: string | null
    ultimo_contato: string | null
    status_conversa: string | null
    funil: string | null
    etapa: string | null
    responsavel: string | null
    entrega: EntregaPaciente | null
    tags: Array<{ nome: string; cor: string | null }>
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
  /** Pedido da loja: cartão (Rede) e PIX (PagBank) na mesma lista. */
  pedidos: Array<{
    id: string; canal: 'cartao' | 'pix'; valor_centavos: number | null
    metodo: string | null; status: string | null; pago_em: string | null
    criado_em: string | null; descricao: string | null
    kit: string | null; itens: Array<{ nome?: string; qty?: number; precoCents?: number }> | null
    parcelas: number | null; cupom: string | null; desconto_centavos: number | null
    frete_centavos: number | null; origem: string | null
    pedido_bling: string | null; nfe_numero: string | null; nfe_status: string | null
    taxa_centavos: number | null; liquido_centavos: number | null
  }>
  /** Formato antigo, mantido para não quebrar quem já lia. Prefira `pedidos`. */
  pagamentos: Array<{
    id: string; valor_centavos: number | null; metodo: string | null; status: string | null
    pago_em: string | null; criado_em: string | null; descricao: string | null
  }>
  assinatura: {
    id: string; status: string | null; cadencia: string | null
    valor_mensal_centavos: number | null; frascos_por_envio: number | null
    ciclos_pagos: number | null; ultimo_ciclo_enviado: number | null; minimo_ciclos: number | null
    ultimo_envio_em: string | null; ultimo_envio_status: string | null; criada_em: string | null
  } | null
  protocolos: Array<{
    id: string; nome: string | null; status: string | null
    sessoes_previstas: number | null; sessoes_feitas: number; preco: number | null
    iniciado_em: string | null; concluido_em: string | null
  }>
  notas_clinicas: Array<{
    id: string; autor: string | null; papel: string | null
    categoria: string | null; nota: string | null; criada_em: string | null
  }>
  followups: Array<{
    id: string; tentativa: number | null; agendado_para: string | null
    feito_em: string | null; canal: string | null; desfecho: string | null; nota: string | null
  }>
  nps: Array<{
    enviado_em: string | null; canal: string | null
    nota: number | null; comentario: string | null; respondido_em: string | null
  }>
  tarefas_abertas: Array<{ id: string; titulo: string | null; vence_em: string | null; tipo: string | null }>
  conversa: {
    mensagens: number; recebidas: number; enviadas: number
    primeira_em: string | null; ultima_em: string | null
    linhas: Array<{ linha: string | null; dono: string | null; ia_ligada: boolean | null; ultima_resposta_humana: string | null }>
  } | null
  resumo: {
    consultas: number; cirurgias: number; exames_tricoscopia: number; vendas: number
    pedidos: number; pedidos_pagos: number
    faturado_centavos: number; pago_centavos: number; mensagens: number; nps_enviados: number
    nps_ultima_nota: number | null
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
    polo: (r.polo as string) ?? null,
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
