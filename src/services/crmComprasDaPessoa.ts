import { supabase } from '@/lib/supabaseClient'

/**
 * Compras da mesma pessoa FORA do lead que está aberto — inclusive em outro polo.
 *
 * 12/ago: a paciente consultou na clínica pelo ManyChat, comprou no site do Tricopill na mesma
 * tarde (o checkout do site criou um lead novo, em outro polo) e no dia da entrega perguntou no
 * WhatsApp da CLÍNICA "não veio nota fiscal?". A atendente abriu a ficha e não viu pedido,
 * rastreio nem nota — e não tinha como ver: o pedido mora em outro lead, de outro polo, e todas
 * as seções do 360 casam por `lead_id` único.
 *
 * Todo o casamento de identidade fica no banco, em `crm_compras_da_pessoa`: telefone por DDD +
 * últimos 8 dígitos (o site grava sem o 55), CPF nas duas formas, e-mail, e descarte do telefone
 * sintético do ManyChat (888…), que colide com qualquer um. Aqui é SÓ LEITURA — nada nesta
 * camada muda tenant_id de lead nem move venda de polo.
 *
 * A RPC é `security definer` e levanta 42501 para quem não é da equipe. Erro chega como erro,
 * não como lista vazia: vazio quer dizer "esta pessoa não comprou em outro cadastro", que é uma
 * resposta legítima, e as duas coisas não podem ficar iguais na tela.
 */

export type ItemDaCompra = { id?: string; nome?: string; qty?: number; precoCents?: number }

export type CompraDaPessoa = {
  /** Tabela de onde a compra saiu. `asaas_payments` e `pagbank_checkouts` não têm itens nem NF-e. */
  origem: 'rede_payments' | 'asaas_payments' | 'pagbank_checkouts'
  pagamentoId: string
  /** Polo DONO da compra. É o que etiqueta a linha — clínica e vendas nunca se somam sem etiqueta. */
  tenantId: string
  poloNome: string | null
  /** Lead dono do pedido. Pode ser nulo, ou o sintético 'site-…' que nem existe em `leads`. */
  leadId: string | null
  /** `true` quando a compra já é do lead aberto: o 360 e a lista de pedidos já mostram essa. */
  mesmoLead: boolean
  /** Por que esta compra entrou: 'lead', 'CPF do pagamento' ou 'telefone do pagamento'. */
  casouPor: string
  clienteNome: string | null
  descricao: string | null
  kit: string | null
  /** `null` (não `[]`) quando a tabela de origem nem tem a coluna. */
  itens: ItemDaCompra[] | null
  valorCentavos: number | null
  freteCentavos: number | null
  descontoCentavos: number | null
  parcelas: number | null
  /** Status cru do gateway ('paid', 'pending'…), sem tradução. */
  status: string | null
  metodo: string | null
  /** Origem do pedido: 'site', 'whatsapp'… */
  origin: string | null
  criadoEm: string | null
  pagoEm: string | null
  /** Rastreio do lead DONO do pedido, não do lead aberto — e só na compra MAIS RECENTE dele: a
   *  entrega é um objeto por lead, sobrescrito a cada envio, então o pedido antigo viria com o
   *  código do novo. Vazio aqui é "não sabemos deste pedido", não "não foi enviado". */
  rastreioCodigo: string | null
  rastreioServico: string | null
  rastreioStatus: string | null
  /** ISO cru em texto, do mesmo jeito que `EntregaPaciente` — parsear aqui, não no banco. */
  rastreioAtualizadoEm: string | null
  nfeNumero: string | null
  /** Cru. `null` NÃO é "sem nota", é "não sabemos" — ver `nfeSelo` em @/lib/nfeSelo. */
  nfeStatus: string | null
  pedidoBling: string | null
}

const texto = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

const numero = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mapear(r: Record<string, unknown>): CompraDaPessoa {
  return {
    origem: (String(r.origem ?? 'rede_payments') as CompraDaPessoa['origem']),
    pagamentoId: String(r.pagamento_id ?? ''),
    tenantId: String(r.tenant_id ?? ''),
    poloNome: texto(r.polo_nome),
    leadId: texto(r.lead_id),
    mesmoLead: r.mesmo_lead === true,
    casouPor: String(r.casou_por ?? ''),
    clienteNome: texto(r.cliente_nome),
    descricao: texto(r.descricao),
    kit: texto(r.kit),
    itens: Array.isArray(r.itens) ? (r.itens as ItemDaCompra[]) : null,
    valorCentavos: numero(r.valor_centavos),
    freteCentavos: numero(r.frete_centavos),
    descontoCentavos: numero(r.desconto_centavos),
    parcelas: numero(r.parcelas),
    status: texto(r.status),
    metodo: texto(r.metodo),
    origin: texto(r.origin),
    criadoEm: texto(r.criado_em),
    pagoEm: texto(r.pago_em),
    rastreioCodigo: texto(r.rastreio_codigo),
    rastreioServico: texto(r.rastreio_servico),
    rastreioStatus: texto(r.rastreio_status),
    rastreioAtualizadoEm: texto(r.rastreio_atualizado_em),
    nfeNumero: texto(r.nfe_numero),
    nfeStatus: texto(r.nfe_status),
    pedidoBling: texto(r.pedido_bling),
  }
}

/**
 * Cache curto por lead.
 *
 * O bloco aparece na coluna direita do /chat, e ali a atendente pula de conversa o tempo todo —
 * esse painel não fazia NENHUMA ida ao banco antes desta seção. Um minuto de cache troca a
 * ida repetida por nada e ainda dedupe a chamada quando a ficha e a coluna montam juntas.
 * Compra fechada não muda de status a cada segundo; um minuto é curto o bastante.
 * Erro nunca entra no cache: senão a ficha ficaria um minuto insistindo na mesma falha.
 */
const TTL_MS = 60_000
const cache = new Map<string, { em: number; dados: CompraDaPessoa[] }>()
const emVoo = new Map<string, Promise<CompraDaPessoa[]>>()

export async function carregarComprasDaPessoa(leadId: string, limite = 50): Promise<CompraDaPessoa[]> {
  const id = leadId.trim()
  if (!id) return []
  // Sem Supabase (base de demonstração) não há compra a conferir: vazio, não erro — a ficha não
  // pode piscar "não deu para conferir" onde nem existe banco.
  const sb = supabase
  if (!sb) return []

  const chave = `${id}:${limite}`
  const guardado = cache.get(chave)
  if (guardado && Date.now() - guardado.em < TTL_MS) return guardado.dados
  const andando = emVoo.get(chave)
  if (andando) return andando

  const pedido = (async () => {
    const { data, error } = await sb.rpc('crm_compras_da_pessoa', { p_lead_id: id, p_limit: limite })
    if (error) throw new Error(error.message)
    const linhas = ((data ?? []) as Record<string, unknown>[]).map(mapear)
    cache.set(chave, { em: Date.now(), dados: linhas })
    return linhas
  })()

  emVoo.set(chave, pedido)
  return pedido.finally(() => {
    emVoo.delete(chave)
  })
}

/**
 * Espia o que já está guardado, sem ida ao banco.
 *
 * A tela usa isto para o estado INICIAL. O bloco remonta a cada conversa aberta no /chat e a cada
 * troca de aba da ficha (a Visão geral e o histórico mostram o mesmo bloco); sem esta espiada, a
 * linha "conferindo…" pisca de novo mesmo com a resposta já na memória.
 */
export function comprasEmCache(leadId: string, limite = 50): CompraDaPessoa[] | null {
  const guardado = cache.get(`${leadId.trim()}:${limite}`)
  if (!guardado || Date.now() - guardado.em >= TTL_MS) return null
  return guardado.dados
}

/** Esquece o que está guardado (usado em teste; a tela não precisa chamar). */
export function limparCacheDeCompras(): void {
  cache.clear()
  emVoo.clear()
}
