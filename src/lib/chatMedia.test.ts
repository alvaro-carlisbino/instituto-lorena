import { describe, expect, it } from 'vitest'

import { isMediaOnlyLabel, kindFromMime, nomeSeguroDeArquivo } from './chatMedia'
import { buscarEmojis } from './emojiData'

describe('kindFromMime', () => {
  it('manda cada mídia pela rota certa da W-API', () => {
    expect(kindFromMime('image/jpeg', 'foto.jpg')).toBe('image')
    expect(kindFromMime('video/mp4', 'clipe.mp4')).toBe('video')
    expect(kindFromMime('audio/ogg', 'audio.ogg')).toBe('audio')
    expect(kindFromMime('application/pdf', 'laudo.pdf')).toBe('document')
  })

  it('áudio gravado no browser (webm/opus) continua sendo ÁUDIO', () => {
    // Se cair em `document`, a paciente recebe um ficheiro para baixar em vez da bolha
    // de voz — que é o motivo de existir o gravador.
    expect(kindFromMime('audio/webm;codecs=opus', 'audio-123.webm')).toBe('audio')
  })

  it('sem mime, a extensão decide', () => {
    expect(kindFromMime('', 'exame.PNG')).toBe('image')
    expect(kindFromMime('', 'consulta.MOV')).toBe('video')
    expect(kindFromMime('', 'recado.m4a')).toBe('audio')
    expect(kindFromMime('', 'contrato.docx')).toBe('document')
  })

  it('o que não se reconhece vira documento, nunca some', () => {
    expect(kindFromMime('application/x-coisa-nova', 'coisa.xyz')).toBe('document')
    expect(kindFromMime('', '')).toBe('document')
  })
})

describe('isMediaOnlyLabel', () => {
  it('reconhece o marcador que pusemos em mídia sem legenda', () => {
    expect(isMediaOnlyLabel('📷 Foto')).toBe(true)
    expect(isMediaOnlyLabel('🎤 Áudio')).toBe(true)
    expect(isMediaOnlyLabel('📎 Documento')).toBe(true)
  })

  it('não confunde uma mensagem de verdade que começa com emoji', () => {
    // Encaminhar isto como "só marcador" apagaria o texto que a pessoa escreveu.
    expect(isMediaOnlyLabel('📷 Foto do resultado, olha como ficou')).toBe(false)
    expect(isMediaOnlyLabel('Segue a foto')).toBe(false)
    expect(isMediaOnlyLabel('')).toBe(false)
  })
})

describe('nomeSeguroDeArquivo', () => {
  it('tira acento e espaço, que o Storage recusa', () => {
    expect(nomeSeguroDeArquivo('Exame Tricoscopia.pdf')).toBe('Exame-Tricoscopia.pdf')
    expect(nomeSeguroDeArquivo('avaliação médica.png')).toBe('avaliacao-medica.png')
  })

  it('preserva a extensão mesmo num nome enorme', () => {
    const gigante = `${'a'.repeat(300)}.pdf`
    expect(nomeSeguroDeArquivo(gigante).endsWith('.pdf')).toBe(true)
  })

  it('nome que vira nada tem um fallback', () => {
    expect(nomeSeguroDeArquivo('///')).toBe('arquivo')
  })
})

describe('buscarEmojis', () => {
  it('acha pelo nome em PORTUGUÊS, com e sem acento', () => {
    // O nome interno do Unicode é "red heart": buscar "coracao" tinha de devolver nada
    // até existir esta tabela.
    expect(buscarEmojis('coracao')).toContain('❤️')
    expect(buscarEmojis('coração')).toContain('❤️')
    expect(buscarEmojis('obrigado')).toContain('🙏')
    expect(buscarEmojis('agenda')).toContain('📅')
  })

  it('acha pelo apelido que a equipe usa', () => {
    expect(buscarEmojis('kkk')).toContain('😂')
    expect(buscarEmojis('joia')).toContain('👍')
  })

  it('termo vazio não devolve a lista inteira', () => {
    expect(buscarEmojis('')).toEqual([])
    expect(buscarEmojis('   ')).toEqual([])
  })

  it('termo sem correspondência devolve vazio em vez de tudo', () => {
    expect(buscarEmojis('zzzzqqq')).toEqual([])
  })
})
