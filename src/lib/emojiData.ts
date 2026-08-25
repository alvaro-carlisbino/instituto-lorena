/**
 * Emojis do compositor, por categoria e com busca em português.
 *
 * Antes eram 40 fixos numa grelha só — a atendente que queria um 🩺 ou um 🎉 ia buscar ao
 * telemóvel e colava. A lista aqui cobre o que se usa numa conversa de atendimento, e a
 * busca é em PORTUGUÊS: procurar "coracao" tem de achar ❤️, e não devolver nada porque o
 * nome interno do Unicode é "red heart".
 *
 * Não é a tabela Unicode inteira de propósito. Uma lista de 3.800 emojis pesa mais de
 * 100 KB no bundle e ninguém rola até ao fim; esta cobre o que aparece de facto.
 */

export type EmojiCategory = {
  id: string
  label: string
  /** Ícone da aba (um emoji da própria categoria). */
  icon: string
  emojis: string[]
}

/**
 * Palavras de busca em pt-BR, sem acento (a busca normaliza dos dois lados). Só os
 * emojis mais procurados têm entrada; o resto encontra-se navegando pela categoria.
 */
export const EMOJI_KEYWORDS: Record<string, string> = {
  '😀': 'sorriso feliz alegre riso',
  '😂': 'chorando de rir risada gargalhada kkk',
  '🤣': 'rolando de rir gargalhada kkk',
  '😊': 'sorriso timido feliz fofo',
  '😍': 'apaixonado coracao amor olhos',
  '🥰': 'apaixonado amor coracoes carinho',
  '😘': 'beijo carinho',
  '😉': 'piscada piscadinha',
  '🙂': 'sorriso leve',
  '😅': 'alivio suor riso nervoso',
  '🤔': 'pensando duvida hmm',
  '😐': 'neutro sem expressao',
  '😔': 'triste desanimado',
  '😢': 'chorando triste lagrima',
  '😭': 'chorando muito triste',
  '😡': 'raiva bravo irritado',
  '🥳': 'festa comemorar aniversario',
  '😴': 'dormindo sono',
  '🤗': 'abraco acolher',
  '🙏': 'obrigado por favor oracao gratidao agradecer',
  '👍': 'joia positivo ok legal curtir concordo',
  '👎': 'negativo nao ruim',
  '👏': 'palmas parabens aplausos',
  '🙌': 'comemorar maos ao alto oba',
  '💪': 'forca musculo firme',
  '🤝': 'aperto de mao acordo negocio parceria',
  '✌️': 'paz vitoria',
  '👋': 'oi tchau ola aceno',
  '❤️': 'coracao amor vermelho',
  '🧡': 'coracao laranja',
  '💛': 'coracao amarelo',
  '💚': 'coracao verde',
  '💙': 'coracao azul',
  '💜': 'coracao roxo',
  '🖤': 'coracao preto',
  '💔': 'coracao partido',
  '✨': 'brilho estrelas novo',
  '🎉': 'festa comemorar parabens',
  '🎊': 'festa confete',
  '🔥': 'fogo top demais quente',
  '⭐': 'estrela favorito',
  '💯': 'cem nota maxima perfeito',
  '✅': 'certo confirmado ok feito',
  '❌': 'errado cancelar nao',
  '⚠️': 'atencao aviso cuidado',
  '📅': 'agenda calendario data',
  '⏰': 'hora horario alarme',
  '📍': 'localizacao endereco lugar',
  '📞': 'telefone ligar',
  '📱': 'celular whatsapp',
  '💬': 'mensagem conversa balao',
  '📷': 'foto camera',
  '📎': 'anexo clipe arquivo',
  '💳': 'cartao pagamento credito',
  '💰': 'dinheiro valor pagamento',
  '🧾': 'recibo nota comprovante',
  '🚚': 'entrega envio frete transporte',
  '📦': 'pacote encomenda caixa envio',
  '💊': 'remedio comprimido medicamento',
  '💉': 'injecao vacina aplicacao',
  '🩺': 'consulta medico estetoscopio saude',
  '🏥': 'hospital clinica',
  '🦷': 'dente dentista',
  '💇': 'cabelo corte salao',
  '💇‍♂️': 'cabelo homem corte transplante',
  '🧴': 'frasco produto shampoo locao',
  '🧬': 'dna genetica',
  '🔬': 'microscopio exame analise',
  '📊': 'grafico resultado relatorio',
  '📈': 'crescimento subiu melhora resultado',
  '📉': 'queda caiu piora',
  '🎯': 'meta alvo objetivo',
  '🚀': 'lancamento crescer rapido',
  '☕': 'cafe',
  '🍽️': 'refeicao comida jantar',
  '😷': 'mascara doente gripe',
  '🤒': 'febre doente',
  '🤧': 'espirro resfriado alergia',
  '🥵': 'calor quente',
  '🥶': 'frio',
  '🎁': 'presente brinde',
  '🏷️': 'etiqueta preco promocao',
  '🔔': 'lembrete notificacao sino aviso',
  '🔒': 'seguro cadeado privado',
  '📝': 'anotar escrever cadastro formulario',
  '✍️': 'assinar escrever',
  '👀': 'olhando ver atencao',
  '🤷': 'nao sei sei la ombros',
  '🫶': 'coracao com as maos carinho',
  '😎': 'oculos estiloso de boa',
  '🤩': 'maravilhado incrivel estrelas',
  '😱': 'susto choque assustado',
  '🥺': 'pidao carinha suplicar',
  '😬': 'constrangido nervoso',
  '🙈': 'macaco vergonha nao vi',
  '💤': 'sono dormindo zzz',
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'recentes',
    label: 'Recentes',
    icon: '🕘',
    emojis: [],
  },
  {
    id: 'rostos',
    label: 'Rostos e pessoas',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '😊',
      '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙',
      '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎',
      '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁',
      '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
      '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥',
      '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬',
      '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪',
      '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑',
      '🤠', '😈', '👿', '👻', '💀', '☠️', '👽', '🤖', '💩', '🤡',
      '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧓', '👴', '👵',
      '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷',
      '👨‍⚕️', '👩‍⚕️', '👨‍💼', '👩‍💼', '👨‍🔬', '👩‍🔬', '💇', '💇‍♂️', '💇‍♀️', '💆',
      '🧑‍🤝‍🧑', '👫', '👪', '🤰', '🤱', '👼', '🎅', '🦸', '🦹', '🧘',
    ],
  },
  {
    id: 'gestos',
    label: 'Gestos e corpo',
    icon: '👍',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
      '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍',
      '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲',
      '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦶', '👂',
      '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄',
    ],
  },
  {
    id: 'coracoes',
    label: 'Corações e símbolos',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️',
      '✨', '⭐', '🌟', '💫', '⚡', '🔥', '💥', '💢', '💦', '💨',
      '🎉', '🎊', '🎈', '🎁', '🎀', '🏆', '🥇', '🥈', '🥉', '🏅',
      '✅', '☑️', '✔️', '❌', '❎', '⭕', '🚫', '⚠️', '❗', '❓',
      '💯', '🔝', '🆕', '🆗', '🆙', '🔴', '🟠', '🟡', '🟢', '🔵',
    ],
  },
  {
    id: 'atendimento',
    label: 'Atendimento e saúde',
    icon: '🩺',
    emojis: [
      '🩺', '💊', '💉', '🩹', '🩸', '🧬', '🔬', '🧪', '🌡️', '🏥',
      '🚑', '⚕️', '🧴', '🧼', '🪥', '🦷', '🧻', '🪒', '💆', '💇',
      '📅', '🗓️', '⏰', '⏱️', '⌚', '🕐', '📍', '🗺️', '🏠', '🏢',
      '📞', '☎️', '📱', '💬', '💭', '🗨️', '📧', '✉️', '📨', '📩',
      '📷', '📸', '🎥', '🎬', '🎤', '🎧', '🔊', '🔔', '🔕', '📢',
      '📎', '📌', '📋', '📝', '✍️', '📄', '📃', '📑', '🗂️', '📁',
      '📊', '📈', '📉', '🎯', '🚀', '💡', '🔎', '🔍', '👀', '🔒',
    ],
  },
  {
    id: 'compras',
    label: 'Compras e envio',
    icon: '📦',
    emojis: [
      '💰', '💵', '💴', '💶', '💷', '🪙', '💳', '🧾', '🏦', '🏧',
      '🛒', '🛍️', '🏷️', '🎫', '🎟️', '📦', '📬', '📮', '🚚', '🚛',
      '✈️', '🛵', '🏍️', '🚲', '🛴', '⛽', '🗳️', '🔖', '📕', '📗',
      '🖨️', '💻', '🖥️', '⌨️', '🖱️', '💾', '📀', '🔌', '🔋', '🪪',
    ],
  },
  {
    id: 'comida',
    label: 'Comida e bebida',
    icon: '☕',
    emojis: [
      '☕', '🍵', '🧃', '🥤', '🧋', '🍺', '🍻', '🥂', '🍷', '🥃',
      '💧', '🍽️', '🍴', '🥄', '🍕', '🍔', '🌭', '🥪', '🌮', '🍟',
      '🥗', '🥘', '🍝', '🍜', '🍲', '🍣', '🍱', '🍚', '🍞', '🥐',
      '🧀', '🥚', '🥩', '🍗', '🍖', '🍎', '🍌', '🍓', '🍇', '🍉',
      '🥑', '🥦', '🥕', '🌽', '🍫', '🍰', '🎂', '🍪', '🍩', '🍦',
    ],
  },
  {
    id: 'natureza',
    label: 'Natureza e clima',
    icon: '🌿',
    emojis: [
      '🌿', '🍀', '🌱', '🌳', '🌴', '🌵', '🌸', '🌺', '🌻', '🌹',
      '🌷', '💐', '🍂', '🍁', '☀️', '🌤️', '⛅', '🌧️', '⛈️', '🌈',
      '❄️', '🌙', '🌛', '🌞', '🌍', '🌊', '🏖️', '⛰️', '🐶', '🐱',
      '🐭', '🐰', '🦊', '🐻', '🐼', '🐨', '🦁', '🐮', '🐷', '🐸',
      '🐵', '🙈', '🙉', '🙊', '🐔', '🐦', '🦋', '🐝', '🐢', '🐬',
    ],
  },
]

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Todos os emojis, sem repetir, na ordem das categorias (a de recentes fica de fora). */
export const TODOS_OS_EMOJIS: string[] = Array.from(
  new Set(EMOJI_CATEGORIES.filter((c) => c.id !== 'recentes').flatMap((c) => c.emojis)),
)

/**
 * Busca por palavra em português. Quem tem keyword casa pela keyword; o resto fica fora do
 * resultado de propósito — devolver 400 emojis "porque nenhum bateu" não ajuda ninguém.
 */
export function buscarEmojis(termo: string): string[] {
  const t = semAcento(termo.trim())
  if (!t) return []
  const resultado: string[] = []
  for (const emoji of TODOS_OS_EMOJIS) {
    const kw = EMOJI_KEYWORDS[emoji]
    if (kw && semAcento(kw).includes(t)) resultado.push(emoji)
  }
  return resultado
}

const CHAVE_RECENTES = 'crm.chat.emojis-recentes'

export function lerEmojisRecentes(): string[] {
  try {
    const raw = window.localStorage.getItem(CHAVE_RECENTES)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, 32) : []
  } catch {
    return []
  }
}

export function guardarEmojiRecente(emoji: string): string[] {
  const atuais = lerEmojisRecentes().filter((e) => e !== emoji)
  const proximos = [emoji, ...atuais].slice(0, 32)
  try {
    window.localStorage.setItem(CHAVE_RECENTES, JSON.stringify(proximos))
  } catch {
    /* modo privado do browser: sem recentes, o resto continua a funcionar */
  }
  return proximos
}
