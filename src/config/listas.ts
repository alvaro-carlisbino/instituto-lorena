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
  | 'venda_status_estorno'
  | 'nota_clinica_categoria'
  | 'financeiro_motivo_exclusao'
  | 'financeiro_grupo_centro'

export type ModuloLista = 'Vendas' | 'Funil e follow-up' | 'Financeiro' | 'Clínica'

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
  /**
   * A opção tem CÓDIGO próprio: o registro guarda o código e a tela mostra o rótulo
   * (`clinical_notes.category` guarda 'consulta', não 'Consulta'). Renomear vira cosmético, que
   * é justamente a graça: trocar o nome que aparece não pode reescrever nota clínica.
   */
  comCodigo?: boolean
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
      'De onde veio o paciente, na palavra de quem fechou. É a única fonte que sabe, porque o Ads identifica anúncio em pouquíssimas vendas.',
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
    chave: 'venda_status_estorno',
    modulo: 'Vendas',
    titulo: 'Status de estorno',
    ondeAparece: 'Central de Vendas → cancelar venda ou cirurgia',
    explicacao:
      'Em que pé está a devolução do que o paciente pagou. Era campo livre, e uma venda chegou a ter uma frase inteira gravada como status; a explicação do caso vai na observação do cancelamento.',
    arrastaHistorico: true,
    padrao: [
      'Em avaliação',
      'Estorno aprovado',
      'Estornado',
      'Sem estorno',
      'Não pagou',
      'Crédito para outra data',
    ],
  },
  {
    chave: 'lead_motivo_perda',
    modulo: 'Funil e follow-up',
    titulo: 'Motivos de perda',
    ondeAparece: 'Quadro → mover para perdido · ficha do paciente',
    explicacao:
      'Por que o paciente não fechou. Alimenta o ranking de motivos na análise do funil, e por isso a lista precisa ser curta: dez motivos parecidos viram dez linhas de 10%.',
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
    chave: 'nota_clinica_categoria',
    modulo: 'Clínica',
    titulo: 'Categorias de nota clínica',
    ondeAparece: 'Notas clínicas → nova nota',
    explicacao:
      'Que tipo de anotação é. A nota guarda o código, então renomear muda só o que aparece na tela.',
    arrastaHistorico: false,
    comCodigo: true,
    padrao: ['Consulta', 'Observação', 'Encaminhamento', 'Plano / conduta', 'Recepção / Aline'],
  },
  {
    chave: 'financeiro_grupo_centro',
    modulo: 'Financeiro',
    titulo: 'Grupos de centro de custo',
    ondeAparece: 'Configuração do financeiro → centros de custo',
    explicacao:
      'Junta os centros no relatório de gastos. O grupo “Não é gasto” é o que tira o centro do total, então errar uma letra aqui muda o total do mês.',
    arrastaHistorico: true,
    padrao: ['Pessoas', 'Operação', 'Estrutura', 'Comercial', 'Impostos e sócios', 'Não é gasto'],
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

export const MODULOS_DE_LISTA: ModuloLista[] = ['Vendas', 'Funil e follow-up', 'Clínica', 'Financeiro']
