/**
 * CATÁLOGO DAS LISTAS CONFIGURÁVEIS.
 *
 * Cada entrada aqui é um vocabulário que o sistema oferece para escolher: procedimento da
 * cirurgia, protocolo, tipo de consulta, forma de pagamento, origem, motivo de perda, canal do
 * follow-up. Todos eram array `const` dentro de `src/services` — trocar uma palavra pedia
 * deploy, e quem sabe a palavra certa é quem atende, não quem programa.
 *
 * As opções de verdade moram em `app_list_options` (migration 20260918200000). O que fica no
 * fonte é o CATÁLOGO: onde a lista aparece, se renomear arrasta histórico, e o `padrao` — que
 * serve de duas coisas ao mesmo tempo: semente da migration e rede de segurança se o banco não
 * responder, para o dialog abrir com opção em vez de abrir vazio.
 *
 * Só strings, de propósito: este arquivo é importado por telas lazy e não pode arrastar service
 * nenhum junto (mesmo motivo de `config/subTabs.ts`).
 */

export type ChaveLista =
  | 'venda_procedimento'
  | 'venda_protocolo'
  | 'venda_tipo_consulta'
  | 'venda_forma_pagamento'
  | 'venda_origem'
  | 'venda_motivo_cancelamento'
  | 'lead_motivo_perda'
  | 'followup_canal'
  | 'followup_resultado'
  | 'atendimento_origem'
  | 'financeiro_motivo_exclusao'

export type ModuloLista = 'Vendas' | 'Funil e follow-up' | 'Financeiro'

export type DefinicaoLista = {
  chave: ChaveLista
  modulo: ModuloLista
  titulo: string
  /** Em que tela a pessoa encontra esta lista. */
  ondeAparece: string
  /** Uma frase sobre o que a escolha significa — vira a explicação da tela. */
  explicacao: string
  /**
   * Se o texto escolhido fica gravado no registro. Quando fica, renomear PRECISA arrastar o
   * histórico, e a tela avisa quantos registros vão junto antes de deixar salvar.
   */
  arrastaHistorico: boolean
  padrao: string[]
}

export const LISTAS: DefinicaoLista[] = [
  {
    chave: 'venda_procedimento',
    modulo: 'Vendas',
    titulo: 'Procedimentos de cirurgia',
    ondeAparece: 'Central de Vendas → nova venda de cirurgia',
    explicacao: 'O que foi vendido. Entra no relatório de produção e no resultado por procedimento.',
    arrastaHistorico: true,
    padrao: [
      'Tc Frontal/ Coroa',
      'Tc Frontal',
      'Tc Frontal/ Coroa/ Barba',
      'Tc masculino/ Barba',
      'Barba',
      'Sobrancelha',
      'Sobrancelha + Nanofat',
      'TC Feminino',
      'TC Feminino + Nanofat',
      'TC Feminino + Sobrancelha',
    ],
  },
  {
    chave: 'venda_protocolo',
    modulo: 'Vendas',
    titulo: 'Protocolos e tratamentos',
    ondeAparece: 'Central de Vendas → nova venda de protocolo',
    explicacao: 'O tratamento vendido fora do centro cirúrgico.',
    arrastaHistorico: true,
    padrao: [
      'Protocolo pós TC',
      'Protocolo convencional',
      'Protocolo inicial 3 sessões',
      'Pacote 3 sessões de tratamento',
      'Pacote terapia',
      'Exossomos',
      'Células',
      'MMP',
      'Mesoject',
    ],
  },
  {
    chave: 'venda_tipo_consulta',
    modulo: 'Vendas',
    titulo: 'Tipos de consulta',
    ondeAparece: 'Central de Vendas → venda',
    explicacao: 'Consulta que originou a venda. Separa primeira consulta de retorno na conversão.',
    arrastaHistorico: true,
    padrao: ['Consulta clínica', 'Retorno 1 mês', 'Retorno clínico', 'Consulta TC'],
  },
  {
    chave: 'venda_forma_pagamento',
    modulo: 'Vendas',
    titulo: 'Formas de pagamento da venda',
    ondeAparece: 'Central de Vendas → venda',
    explicacao: 'Como o paciente pagou. É o que o financeiro procura quando vai conciliar.',
    arrastaHistorico: true,
    padrao: ['Dinheiro', 'Pix', 'Cartão de crédito', 'Cartão de débito', 'Boleto', 'Transferência', 'Misto'],
  },
  {
    chave: 'venda_origem',
    modulo: 'Vendas',
    titulo: 'Origem da venda',
    ondeAparece: 'Central de Vendas → venda',
    explicacao:
      'De onde veio o paciente, na palavra de quem fechou. É a única fonte que sabe — o Ads identifica anúncio em pouquíssimas vendas.',
    arrastaHistorico: true,
    padrao: [
      'Indicação de paciente ou conhecido',
      'Indicação de outro médico',
      'Já era paciente da casa',
      'Viu anúncio no Instagram ou Facebook',
      'Achou o Instagram sem ser anúncio',
      'Google, site ou busca',
      'Outro',
      'Não perguntei',
    ],
  },
  {
    chave: 'venda_motivo_cancelamento',
    modulo: 'Vendas',
    titulo: 'Motivos de cancelamento',
    ondeAparece: 'Quadro → mover para cancelado · Central de Vendas → cancelar venda',
    explicacao: 'Por que a cirurgia ou o protocolo não aconteceu.',
    arrastaHistorico: true,
    padrao: [
      'Financeiro / forma de pagamento',
      'Remarcou / vai reagendar',
      'Medo / insegurança',
      'Motivo de saúde',
      'Problema de agenda',
      'Fez em outra clínica',
      'Desistiu do tratamento',
    ],
  },
  {
    chave: 'lead_motivo_perda',
    modulo: 'Funil e follow-up',
    titulo: 'Motivos de perda',
    ondeAparece: 'Quadro → mover para perdido · ficha do paciente',
    explicacao:
      'Por que o paciente não fechou. Alimenta o ranking de motivos na análise do funil — e por isso a lista precisa ser curta: dez motivos parecidos viram dez linhas de 10%.',
    arrastaHistorico: true,
    padrao: [
      'Preço / Orçamento alto',
      'Distância / Localização',
      'Indecisão do paciente',
      'Fez em outra clínica',
      'Falta de agenda / horário',
      'Apenas curiosidade',
      'Não respondeu o follow-up',
      'Sem orçamento',
      'Sem interesse',
      'Já fechou em outro lugar',
      'Conta errada / contato inválido',
      'Equipe / fornecedor',
      'Outro',
    ],
  },
  {
    chave: 'followup_canal',
    modulo: 'Funil e follow-up',
    titulo: 'Canais de follow-up',
    ondeAparece: 'Central de Vendas → follow-up',
    explicacao: 'Por onde a tentativa de contato foi feita.',
    arrastaHistorico: true,
    padrao: ['WhatsApp', 'Ligação', 'E-mail', 'Presencial'],
  },
  {
    chave: 'followup_resultado',
    modulo: 'Funil e follow-up',
    titulo: 'Resultados do follow-up',
    ondeAparece: 'Central de Vendas → follow-up',
    explicacao: 'O que o paciente respondeu. É o que decide se a próxima tentativa é agendada.',
    arrastaHistorico: true,
    padrao: [
      'Sem resposta',
      'Vai pensar',
      'Pediu para chamar depois',
      'Sem condições agora',
      'Quer remarcar a consulta',
      'Fechou',
      'Não fechou',
    ],
  },
  {
    chave: 'atendimento_origem',
    modulo: 'Funil e follow-up',
    titulo: 'Origem do atendimento',
    ondeAparece: 'Central de Vendas → novo atendimento',
    explicacao: 'De onde veio quem chegou para consulta, na hora de registrar o atendimento.',
    arrastaHistorico: true,
    padrao: ['Indicação', 'Já é paciente', 'Instagram', 'Google', 'Facebook', 'Site'],
  },
  {
    chave: 'financeiro_motivo_exclusao',
    modulo: 'Financeiro',
    titulo: 'Motivos para excluir um lançamento',
    ondeAparece: 'Gastos e Contas a pagar → excluir',
    explicacao:
      'Por que a conta saiu do financeiro. Fica gravado no registro de exclusão, que é o que responde depois "cadê aquele boleto?".',
    arrastaHistorico: false,
    padrao: [
      'Não foi compra: proposta comercial',
      'Boleto falso ou golpe',
      'Nota lançada em duplicidade',
      'Outro',
    ],
  },
]

const POR_CHAVE = new Map<ChaveLista, DefinicaoLista>(LISTAS.map((l) => [l.chave, l]))

export function definicaoDaLista(chave: ChaveLista): DefinicaoLista {
  const d = POR_CHAVE.get(chave)
  if (!d) throw new Error(`lista desconhecida: ${chave}`)
  return d
}

/** Opções escritas no fonte — semente da migration e rede de segurança se o banco falhar. */
export function padraoDaLista(chave: ChaveLista): string[] {
  return POR_CHAVE.get(chave)?.padrao ?? []
}

export const MODULOS_DE_LISTA: ModuloLista[] = ['Vendas', 'Funil e follow-up', 'Financeiro']
