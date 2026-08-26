import { describe, expect, it } from 'vitest'

import {
  amostrasDoPacoteOpus,
  empacotarOggOpus,
  lerWebmOpus,
  montarPaginaOgg,
  nomeComExtensao,
  remuxWebmOpusParaOgg,
} from './audioOpus'

/** Leitor de Ogg do tamanho de um teste: devolve os pacotes e o granule da última página. */
function lerOgg(bytes: Uint8Array): { pacotes: Uint8Array[]; ultimoGranule: bigint; paginas: number } {
  const pacotes: Uint8Array[] = []
  let parcial: number[] = []
  let ultimoGranule = 0n
  let paginas = 0
  let pos = 0
  while (pos < bytes.length) {
    expect(String.fromCharCode(...bytes.subarray(pos, pos + 4))).toBe('OggS')
    const dv = new DataView(bytes.buffer, bytes.byteOffset + pos)
    ultimoGranule = dv.getBigUint64(6, true)
    const nSeg = bytes[pos + 26]
    const lacing = bytes.subarray(pos + 27, pos + 27 + nSeg)
    let corpo = pos + 27 + nSeg
    for (const t of lacing) {
      parcial.push(...bytes.subarray(corpo, corpo + t))
      corpo += t
      if (t < 255) {
        pacotes.push(Uint8Array.from(parcial))
        parcial = []
      }
    }
    paginas++
    pos = corpo
  }
  return { pacotes, ultimoGranule, paginas }
}

// ── EBML de mentira, para exercitar o leitor de WebM ─────────────────────────

function vintTamanho(n: number): number[] {
  if (n < 0x7f) return [0x80 | n]
  if (n < 0x3fff) return [0x40 | (n >> 8), n & 0xff]
  return [0x20 | (n >> 16), (n >> 8) & 0xff, n & 0xff]
}

function elemento(id: number[], dados: number[]): number[] {
  return [...id, ...vintTamanho(dados.length), ...dados]
}

/** Elemento de tamanho desconhecido (0xFF), como o MediaRecorder escreve enquanto grava. */
function elementoAberto(id: number[], dados: number[]): number[] {
  return [...id, 0xff, ...dados]
}

function opusHeadFalso(canais = 1): number[] {
  const h = [...new TextEncoder().encode('OpusHead')]
  return [...h, 1, canais, 0x00, 0x0f, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0]
}

function simpleBlock(quadro: number[]): number[] {
  // trilha 1 (vint 0x81), timecode relativo 0, flags 0 (sem lacing)
  return elemento([0xa3], [0x81, 0x00, 0x00, 0x00, ...quadro])
}

function webmDeTeste(quadros: number[][]): Uint8Array {
  const tracks = elemento(
    [0x16, 0x54, 0xae, 0x6b],
    elemento(
      [0xae],
      [
        ...elemento([0x86], [...new TextEncoder().encode('A_OPUS')]),
        ...elemento([0x63, 0xa2], opusHeadFalso()),
        ...elemento([0xe1], elemento([0x9f], [0x01])),
      ],
    ),
  )
  const cluster = elementoAberto(
    [0x1f, 0x43, 0xb6, 0x75],
    [...elemento([0xe7], [0x00]), ...quadros.flatMap(simpleBlock)],
  )
  const segmento = elementoAberto([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster])
  const ebml = elemento([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x86, 0x81, 0x01])
  return Uint8Array.from([...ebml, ...segmento])
}

/** Pacote Opus plausível: TOC de 20 ms + carga. */
function pacoteOpus(tamanho: number, semente = 7): number[] {
  const p = [0x78] // config 15 (20 ms), code 0 → 1 quadro
  for (let i = 1; i < tamanho; i++) p.push((semente * i) % 251)
  return p
}

describe('amostrasDoPacoteOpus', () => {
  it('lê a duração no primeiro byte do pacote', () => {
    expect(amostrasDoPacoteOpus(Uint8Array.from([0x08]))).toBe(960) // config 1 → 20 ms
    expect(amostrasDoPacoteOpus(Uint8Array.from([0x00]))).toBe(480) // config 0 → 10 ms
    expect(amostrasDoPacoteOpus(Uint8Array.from([0x80]))).toBe(120) // config 16 → 2,5 ms
    expect(amostrasDoPacoteOpus(Uint8Array.from([0x09]))).toBe(1920) // code 1 → 2 quadros
    expect(amostrasDoPacoteOpus(Uint8Array.from([0x0b, 0x03]))).toBe(2880) // code 3 → 3 quadros
  })

  it('não estoura com pacote vazio', () => {
    expect(amostrasDoPacoteOpus(new Uint8Array())).toBe(0)
  })
})

describe('montarPaginaOgg', () => {
  it('escreve o cabeçalho, o CRC e a tabela de segmentos', () => {
    const pagina = montarPaginaOgg([Uint8Array.from(pacoteOpus(300))], 960n, 0x02, 0x1234, 0)
    expect(String.fromCharCode(...pagina.subarray(0, 4))).toBe('OggS')
    expect(pagina[5]).toBe(0x02)
    const dv = new DataView(pagina.buffer)
    expect(dv.getBigUint64(6, true)).toBe(960n)
    expect(dv.getUint32(14, true)).toBe(0x1234)
    expect(dv.getUint32(22, true)).not.toBe(0) // CRC preenchido
    // 300 bytes = 255 + 45: duas fatias, a última fecha o pacote.
    expect(pagina[26]).toBe(2)
    expect([pagina[27], pagina[28]]).toEqual([255, 45])
  })

  it('fecha com um zero o pacote de tamanho múltiplo de 255', () => {
    const pagina = montarPaginaOgg([new Uint8Array(255)], 0n, 0, 1, 0)
    expect(pagina[26]).toBe(2)
    expect([pagina[27], pagina[28]]).toEqual([255, 0])
  })
})

describe('empacotarOggOpus', () => {
  it('devolve os mesmos pacotes depois de embrulhar e desembrulhar', () => {
    const originais = [pacoteOpus(80, 3), pacoteOpus(120, 5), pacoteOpus(90, 11)]
    const ogg = empacotarOggOpus(
      originais.map((p) => Uint8Array.from(p)),
      Uint8Array.from(opusHeadFalso()),
    )
    const lido = lerOgg(ogg)
    // Primeiros dois pacotes são OpusHead e OpusTags.
    expect(String.fromCharCode(...lido.pacotes[0].subarray(0, 8))).toBe('OpusHead')
    expect(String.fromCharCode(...lido.pacotes[1].subarray(0, 8))).toBe('OpusTags')
    expect(lido.pacotes.slice(2).map((p) => [...p])).toEqual(originais)
    // 3 pacotes de 20 ms = 60 ms = 2880 amostras a 48 kHz.
    expect(lido.ultimoGranule).toBe(2880n)
  })

  it('marca a última página como fim do fluxo', () => {
    const ogg = empacotarOggOpus([Uint8Array.from(pacoteOpus(40))], Uint8Array.from(opusHeadFalso()))
    let pos = 0
    let ultimoTipo = -1
    while (pos < ogg.length) {
      ultimoTipo = ogg[pos + 5]
      const nSeg = ogg[pos + 26]
      let corpo = pos + 27 + nSeg
      for (const t of ogg.subarray(pos + 27, pos + 27 + nSeg)) corpo += t
      pos = corpo
    }
    expect(ultimoTipo).toBe(0x04)
  })

  it('recusa fluxo sem áudio', () => {
    expect(() => empacotarOggOpus([], Uint8Array.from(opusHeadFalso()))).toThrow()
  })
})

describe('lerWebmOpus', () => {
  it('acha os pacotes mesmo com Segment e Cluster de tamanho desconhecido', () => {
    const quadros = [pacoteOpus(60, 2), pacoteOpus(70, 4)]
    const lido = lerWebmOpus(webmDeTeste(quadros))
    expect(lido.ehOpus).toBe(true)
    expect(lido.canais).toBe(1)
    expect(lido.opusHead).not.toBeNull()
    expect(lido.pacotes.map((p) => [...p])).toEqual(quadros)
  })
})

describe('remuxWebmOpusParaOgg', () => {
  it('troca a caixa sem tocar nos pacotes', () => {
    const quadros = [pacoteOpus(60, 2), pacoteOpus(70, 4), pacoteOpus(50, 6)]
    const ogg = remuxWebmOpusParaOgg(webmDeTeste(quadros))
    expect(String.fromCharCode(...ogg.subarray(0, 4))).toBe('OggS')
    const lido = lerOgg(ogg)
    expect(lido.pacotes.slice(2).map((p) => [...p])).toEqual(quadros)
    // O OpusHead do WebM é reaproveitado — inclusive o pre-skip que o browser escreveu.
    expect([...lido.pacotes[0]]).toEqual(opusHeadFalso())
  })

  it('recusa gravação vazia em vez de subir um ficheiro mudo', () => {
    expect(() => remuxWebmOpusParaOgg(webmDeTeste([]))).toThrow(/vazia/i)
  })
})

describe('nomeComExtensao', () => {
  it('troca a extensão e sobrevive a nome sem ponto', () => {
    expect(nomeComExtensao('audio-1787750000761.webm', 'ogg')).toBe('audio-1787750000761.ogg')
    expect(nomeComExtensao('recado', 'ogg')).toBe('recado.ogg')
    expect(nomeComExtensao('', 'ogg')).toBe('audio.ogg')
  })
})
