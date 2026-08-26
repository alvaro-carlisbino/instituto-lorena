/**
 * Mensagem de voz do WhatsApp é **Ogg/Opus**. O Chrome grava **WebM/Opus** — mesmo codec,
 * caixa diferente — e a W-API recusa antes de tentar entregar:
 *
 *   POST /message/send-audio → 500
 *   {"error":true,"message":"A URL do áudio deve ser nos formatos .mp3 ou .ogg."}
 *
 * Foi isso que aconteceu no primeiro teste real do gravador (26/ago/26, 10:13): o ficheiro
 * subiu para o bucket como `audio-….webm` e morreu na porta da W-API. Nenhum deploy de
 * back-end resolvia — quem escolhe o formato é o browser.
 *
 * Aqui trocamos a caixa **sem recodificar**: tiramos os pacotes Opus de dentro do WebM
 * (Matroska) e embrulhamos em páginas Ogg. Não há perda, não há encoder, e o resultado é o
 * mesmo ficheiro que o telemóvel produziria — a bolha chega como mensagem de voz, não como
 * anexo para baixar.
 *
 * O que o browser grava, por browser:
 *   • Chrome/Edge → audio/webm;codecs=opus  → remux (este ficheiro)
 *   • Firefox     → audio/ogg;codecs=opus   → já serve, só garantimos o nome .ogg
 *   • Safari      → audio/mp4 (AAC)         → codec diferente: precisa recodificar
 *
 * Ver [[crm_chat_whatsapp_completo]] e [[crm_midia_chat]].
 */

// ── Ogg: escrita de páginas ──────────────────────────────────────────────────

/**
 * CRC do Ogg é o "CRC-32 cru" (polinómio 0x04C11DB7, sem reflexão, sem xor final) — NÃO é
 * o CRC-32 do zip/PNG. Trocar um pelo outro dá um ficheiro que abre em alguns players e é
 * recusado noutros, que é o pior tipo de erro para depurar.
 */
const TABELA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

function crcOgg(dados: Uint8Array): number {
  let c = 0
  for (let i = 0; i < dados.length; i++) {
    c = ((c << 8) ^ TABELA_CRC[((c >>> 24) ^ dados[i]) & 0xff]) >>> 0
  }
  return c >>> 0
}

const CABECALHO_INICIO = 0x02 // primeira página do fluxo (BOS)
const CABECALHO_FIM = 0x04 // última página do fluxo (EOS)

/**
 * Uma página Ogg: cabeçalho de 27 bytes + tabela de segmentos + os pacotes.
 *
 * A tabela de segmentos conta cada pacote em fatias de 255 bytes; uma fatia menor que 255
 * FECHA o pacote. Por isso um pacote de tamanho múltiplo de 255 precisa de um zero no fim,
 * senão o leitor acha que ele continua na página seguinte.
 */
export function montarPaginaOgg(
  pacotes: Uint8Array[],
  granule: bigint,
  tipo: number,
  serial: number,
  sequencia: number,
): Uint8Array {
  const lacing: number[] = []
  for (const p of pacotes) {
    let restante = p.length
    while (restante >= 255) {
      lacing.push(255)
      restante -= 255
    }
    lacing.push(restante)
  }
  if (lacing.length > 255) throw new Error('ogg: página com mais de 255 segmentos')

  const corpo = pacotes.reduce((n, p) => n + p.length, 0)
  const pagina = new Uint8Array(27 + lacing.length + corpo)
  const dv = new DataView(pagina.buffer)
  pagina[0] = 0x4f // O
  pagina[1] = 0x67 // g
  pagina[2] = 0x67 // g
  pagina[3] = 0x53 // S
  pagina[4] = 0 // versão
  pagina[5] = tipo
  dv.setBigUint64(6, granule, true)
  dv.setUint32(14, serial, true)
  dv.setUint32(18, sequencia, true)
  dv.setUint32(22, 0, true) // CRC entra zerado no cálculo e é preenchido no fim
  pagina[26] = lacing.length
  pagina.set(lacing, 27)
  let off = 27 + lacing.length
  for (const p of pacotes) {
    pagina.set(p, off)
    off += p.length
  }
  dv.setUint32(22, crcOgg(pagina), true)
  return pagina
}

/** Cabeçalho de identificação do Opus (RFC 7845), usado quando o WebM não trouxe o dele. */
function montarOpusHead(canais: number, preSkip = 3840): Uint8Array {
  const h = new Uint8Array(19)
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0) // "OpusHead"
  h[8] = 1 // versão
  h[9] = Math.max(1, Math.min(2, canais))
  const dv = new DataView(h.buffer)
  dv.setUint16(10, preSkip, true)
  dv.setUint32(12, 48000, true) // taxa de entrada original
  dv.setUint16(16, 0, true) // ganho
  h[18] = 0 // mapeamento 0 = mono/estéreo simples
  return h
}

function montarOpusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('instituto-lorena-crm')
  const t = new Uint8Array(8 + 4 + vendor.length + 4)
  t.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0) // "OpusTags"
  const dv = new DataView(t.buffer)
  dv.setUint32(8, vendor.length, true)
  t.set(vendor, 12)
  dv.setUint32(12 + vendor.length, 0, true) // nenhum comentário
  return t
}

/**
 * Quantas amostras (a 48 kHz) um pacote Opus carrega. Está tudo no primeiro byte (TOC): a
 * configuração diz a duração do quadro e os dois últimos bits dizem quantos quadros vêm no
 * pacote. É isto que alimenta o `granule` das páginas — errar aqui faz o WhatsApp mostrar
 * "0:00" num áudio de meio minuto.
 */
export function amostrasDoPacoteOpus(pacote: Uint8Array): number {
  if (pacote.length < 1) return 0
  const toc = pacote[0]
  const config = toc >> 3
  const codigo = toc & 0x03
  const ms =
    config < 12
      ? [10, 20, 40, 60][config % 4]
      : config < 16
        ? [10, 20][config % 2]
        : [2.5, 5, 10, 20][config % 4]
  let quadros = 1
  if (codigo === 1 || codigo === 2) quadros = 2
  else if (codigo === 3) quadros = pacote.length >= 2 ? (pacote[1] & 0x3f) || 1 : 1
  return Math.round(ms * 48) * quadros
}

/** Embrulha pacotes Opus num fluxo Ogg completo (cabeçalho, tags, áudio, fim). */
export function empacotarOggOpus(pacotes: Uint8Array[], opusHead: Uint8Array): Uint8Array {
  if (pacotes.length === 0) throw new Error('ogg: nenhum pacote de áudio')
  const serial = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1
  const paginas: Uint8Array[] = []
  let seq = 0
  paginas.push(montarPaginaOgg([opusHead], 0n, CABECALHO_INICIO, serial, seq++))
  paginas.push(montarPaginaOgg([montarOpusTags()], 0n, 0, serial, seq++))

  let granule = 0n
  let lote: Uint8Array[] = []
  let segmentosDoLote = 0
  const fechar = (ultima: boolean) => {
    if (lote.length === 0) return
    paginas.push(montarPaginaOgg(lote, granule, ultima ? CABECALHO_FIM : 0, serial, seq++))
    lote = []
    segmentosDoLote = 0
  }
  for (const p of pacotes) {
    const segmentos = Math.floor(p.length / 255) + 1
    // 255 é o teto de segmentos por página; passar disso corrompe a tabela de lacing.
    if (segmentosDoLote + segmentos > 255) fechar(false)
    lote.push(p)
    segmentosDoLote += segmentos
    granule += BigInt(amostrasDoPacoteOpus(p))
  }
  fechar(true)

  const total = paginas.reduce((n, p) => n + p.length, 0)
  const saida = new Uint8Array(total)
  let off = 0
  for (const p of paginas) {
    saida.set(p, off)
    off += p.length
  }
  return saida
}

// ── WebM/Matroska: leitura ───────────────────────────────────────────────────

type Vint = { valor: number; tamanho: number }

function lerVint(b: Uint8Array, pos: number, manterMarcador: boolean): Vint | null {
  const primeiro = b[pos]
  if (primeiro === undefined) return null
  let tamanho = 1
  let mascara = 0x80
  while (tamanho <= 8 && !(primeiro & mascara)) {
    mascara >>= 1
    tamanho++
  }
  if (tamanho > 8 || pos + tamanho > b.length) return null
  let valor = manterMarcador ? primeiro : primeiro & (mascara - 1)
  for (let i = 1; i < tamanho; i++) valor = valor * 256 + b[pos + i]
  return { valor, tamanho }
}

const EBML_SEGMENT = 0x18538067
const EBML_CLUSTER = 0x1f43b675
const EBML_TRACKS = 0x1654ae6b
const EBML_TRACK_ENTRY = 0xae
const EBML_AUDIO = 0xe1
const EBML_BLOCK_GROUP = 0xa0
const EBML_CODEC_PRIVATE = 0x63a2
const EBML_CODEC_ID = 0x86
const EBML_CHANNELS = 0x9f
const EBML_SIMPLE_BLOCK = 0xa3
const EBML_BLOCK = 0xa1

const CONTENEDORES = new Set([
  EBML_SEGMENT,
  EBML_CLUSTER,
  EBML_TRACKS,
  EBML_TRACK_ENTRY,
  EBML_AUDIO,
  EBML_BLOCK_GROUP,
])

/**
 * Percorre o EBML descendo nos contentores que interessam. O WebM do MediaRecorder é
 * "streaming": Segment e Cluster vêm com **tamanho desconhecido**, porque o browser não
 * sabe o fim enquanto grava. Nesse caso o elemento vale até ao fim do pai — e como aqui só
 * colecionamos blocos, o aninhamento a mais é inofensivo.
 */
function percorrerEbml(
  b: Uint8Array,
  inicio: number,
  fim: number,
  visitar: (id: number, dados: Uint8Array) => void,
): void {
  let pos = inicio
  while (pos < fim) {
    const id = lerVint(b, pos, true)
    if (!id) return
    pos += id.tamanho
    const tam = lerVint(b, pos, false)
    if (!tam) return
    pos += tam.tamanho
    const desconhecido = tam.valor >= Math.pow(2, 7 * tam.tamanho) - 1
    const dadosFim = desconhecido ? fim : Math.min(fim, pos + tam.valor)
    if (CONTENEDORES.has(id.valor)) percorrerEbml(b, pos, dadosFim, visitar)
    else visitar(id.valor, b.subarray(pos, dadosFim))
    pos = dadosFim
  }
}

/** Os quadros de um SimpleBlock/Block. O Chrome não usa lacing em áudio, mas isso não é lei. */
function quadrosDoBloco(b: Uint8Array): Uint8Array[] {
  const trilha = lerVint(b, 0, false)
  if (!trilha) return []
  const posFlags = trilha.tamanho + 2 // 2 bytes de timecode relativo
  if (posFlags >= b.length) return []
  const lacing = (b[posFlags] >> 1) & 0x03
  let pos = posFlags + 1
  if (lacing === 0) return [b.subarray(pos)]

  const quantos = b[pos] + 1
  pos += 1
  if (lacing === 2) {
    // fixo: todos os quadros do mesmo tamanho
    const tamanho = Math.floor((b.length - pos) / quantos)
    const out: Uint8Array[] = []
    for (let i = 0; i < quantos; i++) out.push(b.subarray(pos + i * tamanho, pos + (i + 1) * tamanho))
    return out
  }
  if (lacing === 1) {
    // Xiph: tamanhos em somas de 255
    const tamanhos: number[] = []
    for (let i = 0; i < quantos - 1; i++) {
      let t = 0
      while (b[pos] === 255) {
        t += 255
        pos++
      }
      t += b[pos]
      pos++
      tamanhos.push(t)
    }
    const out: Uint8Array[] = []
    for (const t of tamanhos) {
      out.push(b.subarray(pos, pos + t))
      pos += t
    }
    out.push(b.subarray(pos))
    return out
  }
  throw new Error('webm: lacing EBML não suportado')
}

export type WebmOpus = { pacotes: Uint8Array[]; opusHead: Uint8Array | null; canais: number; ehOpus: boolean }

/** Tira do WebM os pacotes Opus e o cabeçalho que o browser já escreveu. */
export function lerWebmOpus(bytes: Uint8Array): WebmOpus {
  const pacotes: Uint8Array[] = []
  let opusHead: Uint8Array | null = null
  let canais = 1
  let ehOpus = false
  const decodificador = new TextDecoder()
  percorrerEbml(bytes, 0, bytes.length, (id, dados) => {
    if (id === EBML_SIMPLE_BLOCK || id === EBML_BLOCK) {
      for (const q of quadrosDoBloco(dados)) if (q.length > 0) pacotes.push(q)
    } else if (id === EBML_CODEC_PRIVATE) {
      if (dados.length >= 19 && decodificador.decode(dados.subarray(0, 8)) === 'OpusHead') {
        opusHead = dados.slice()
      }
    } else if (id === EBML_CODEC_ID) {
      if (decodificador.decode(dados).replace(/\0+$/, '').toUpperCase().includes('OPUS')) ehOpus = true
    } else if (id === EBML_CHANNELS) {
      let v = 0
      for (const byte of dados) v = v * 256 + byte
      if (v > 0) canais = v
    }
  })
  return { pacotes, opusHead, canais, ehOpus }
}

/** WebM/Opus → Ogg/Opus, sem recodificar. */
export function remuxWebmOpusParaOgg(bytes: Uint8Array): Uint8Array {
  const { pacotes, opusHead, canais, ehOpus } = lerWebmOpus(bytes)
  if (!ehOpus && !opusHead) throw new Error('Este áudio não está em Opus, e o WhatsApp não aceita.')
  if (pacotes.length === 0) throw new Error('Gravação vazia: nenhum trecho de áudio foi lido.')
  return empacotarOggOpus(pacotes, opusHead ?? montarOpusHead(canais))
}

// ── Entrada única ────────────────────────────────────────────────────────────

/** Troca (ou põe) a extensão do nome do ficheiro — é ela que a W-API lê da URL. */
export function nomeComExtensao(nome: string, extensao: string): string {
  const base = (nome || 'audio').replace(/\.[a-z0-9]{1,8}$/i, '')
  return `${base || 'audio'}.${extensao}`
}

function ext(nome: string): string {
  return (nome.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] ?? '').toLowerCase()
}

/**
 * Recodifica para Opus quando o codec de origem não é Opus (Safari grava AAC). Usa o
 * decodificador do próprio browser (que abre tudo o que ele toca) e o `AudioEncoder` do
 * WebCodecs. Onde não houver WebCodecs, é melhor dizer isso do que mandar um ficheiro que
 * a paciente não consegue ouvir.
 */
async function recodificarParaOpus(file: File): Promise<Uint8Array> {
  const Encoder = (globalThis as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder
  const Dado = (globalThis as { AudioData?: typeof AudioData }).AudioData
  if (!Encoder || !Dado) {
    throw new Error('Este navegador não converte áudio para o formato do WhatsApp. Use o Chrome ou o Edge.')
  }
  const bruto = await file.arrayBuffer()
  const ctx = new AudioContext()
  let decodificado: AudioBuffer
  try {
    decodificado = await ctx.decodeAudioData(bruto)
  } finally {
    void ctx.close()
  }
  const canais = Math.min(2, decodificado.numberOfChannels) || 1
  // O Opus só fala 48 kHz: rendemos nessa taxa antes de codificar.
  const offline = new OfflineAudioContext(
    canais,
    Math.max(1, Math.ceil((decodificado.duration || 0) * 48000)),
    48000,
  )
  const fonte = offline.createBufferSource()
  fonte.buffer = decodificado
  fonte.connect(offline.destination)
  fonte.start()
  const em48k = await offline.startRendering()

  const pacotes: Uint8Array[] = []
  let falha: Error | null = null
  const enc = new Encoder({
    output: (chunk) => {
      const u = new Uint8Array(chunk.byteLength)
      chunk.copyTo(u)
      pacotes.push(u)
    },
    error: (e) => {
      falha = e instanceof Error ? e : new Error(String(e))
    },
  })
  enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: canais, bitrate: 32000 })

  const planos: Float32Array[] = []
  for (let c = 0; c < canais; c++) planos.push(em48k.getChannelData(c))
  const BLOCO = 4800 // 100 ms
  for (let inicio = 0; inicio < em48k.length; inicio += BLOCO) {
    const quadros = Math.min(BLOCO, em48k.length - inicio)
    const dados = new Float32Array(quadros * canais)
    for (let c = 0; c < canais; c++) dados.set(planos[c].subarray(inicio, inicio + quadros), c * quadros)
    enc.encode(
      new Dado({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: quadros,
        numberOfChannels: canais,
        timestamp: Math.round((inicio / 48000) * 1_000_000),
        data: dados,
      }),
    )
  }
  await enc.flush()
  enc.close()
  if (falha) throw falha
  return empacotarOggOpus(pacotes, montarOpusHead(canais))
}

/**
 * Deixa qualquer áudio pronto para a rota `/message/send-audio` da W-API: ficheiro **.ogg**
 * (ou .mp3, que ela também aceita) e, por dentro, Opus de verdade.
 *
 * Ficheiro que já serve passa direto — só garantimos o nome, porque a W-API decide pelo
 * fim da URL e um `.opus` ou `.oga` é recusado do mesmo jeito que o `.webm` foi.
 */
export async function prepararAudioParaWhatsApp(file: File): Promise<File> {
  const mime = (file.type || '').toLowerCase()
  const extensao = ext(file.name)

  if (mime.includes('mpeg') || mime.includes('mp3') || extensao === 'mp3') {
    return extensao === 'mp3' ? file : new File([file], nomeComExtensao(file.name, 'mp3'), { type: 'audio/mpeg' })
  }
  if (mime.includes('ogg') || extensao === 'ogg' || extensao === 'oga' || extensao === 'opus') {
    return extensao === 'ogg' ? file : new File([file], nomeComExtensao(file.name, 'ogg'), { type: 'audio/ogg' })
  }

  let ogg: Uint8Array
  if (mime.includes('webm') || extensao === 'webm') {
    try {
      ogg = remuxWebmOpusParaOgg(new Uint8Array(await file.arrayBuffer()))
    } catch {
      // WebM que não é Opus (ou que veio de um gravador estranho): sobra recodificar.
      ogg = await recodificarParaOpus(file)
    }
  } else {
    ogg = await recodificarParaOpus(file)
  }
  return new File([ogg as BlobPart], nomeComExtensao(file.name, 'ogg'), { type: 'audio/ogg' })
}
