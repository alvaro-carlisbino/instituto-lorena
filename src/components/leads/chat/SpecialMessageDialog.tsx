import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { SpecialWhatsappMessage } from '@/services/crmWhatsapp'

export type SpecialKind = SpecialWhatsappMessage['type']

type Props = {
  kind: SpecialKind | null
  onClose: () => void
  onSend: (mensagem: SpecialWhatsappMessage) => void | Promise<void>
  enviando: boolean
  /** Nome do polo, para pré-preencher o beneficiário do Pix. */
  nomeDoPolo?: string
}

const TITULOS: Record<SpecialKind, { titulo: string; descricao: string }> = {
  location: {
    titulo: 'Enviar localização',
    descricao:
      'Chega como o mapinha do WhatsApp: a pessoa toca e abre a rota no telemóvel. Endereço escrito no texto não faz isso.',
  },
  contact: {
    titulo: 'Enviar contato',
    descricao: 'Cartão de visita do WhatsApp. Quem recebe salva na agenda com um toque.',
  },
  poll: {
    titulo: 'Enviar enquete',
    descricao: 'A pessoa responde tocando numa opção — útil para escolher horário sem trocar dez mensagens.',
  },
  pix: {
    titulo: 'Enviar chave Pix',
    descricao:
      'Botão de Pix nativo: abre o app do banco com a chave preenchida. Não confirma pagamento de volta — para isso, use o link de pagamento.',
  },
  link: {
    titulo: 'Enviar link com prévia',
    descricao: 'O card vem montado por nós (título, descrição, imagem), em vez do que o WhatsApp conseguir raspar.',
  },
}

/**
 * As mensagens do WhatsApp que não são texto nem ficheiro, num diálogo só.
 *
 * Quem monta este componente passa `key={kind}`: trocar de tipo REMONTA o formulário, e é
 * assim que ele nasce limpo. Limpar campo a campo num efeito era o mesmo resultado com
 * mais código — e com o risco de esquecer um campo e mandar a localização de ontem para a
 * paciente de hoje.
 *
 * Cinco formulários pequenos em cinco componentes seria mais bonito e mais difícil de
 * manter: eles partilham o mesmo enquadramento, o mesmo rodapé e a mesma regra de "só
 * envia quando está válido". O que muda é o miolo.
 */
export function SpecialMessageDialog({ kind, onClose, onSend, enviando, nomeDoPolo }: Props) {
  // Localização
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [nomeLocal, setNomeLocal] = useState('')
  const [endereco, setEndereco] = useState('')
  // Contato
  const [contatos, setContatos] = useState<Array<{ name: string; phone: string; description: string }>>([
    { name: '', phone: '', description: '' },
  ])
  // Enquete
  const [pergunta, setPergunta] = useState('')
  const [opcoes, setOpcoes] = useState<string[]>(['', ''])
  const [multipla, setMultipla] = useState(false)
  // Pix
  const [beneficiario, setBeneficiario] = useState(nomeDoPolo ?? '')
  const [chavePix, setChavePix] = useState('')
  const [tipoChave, setTipoChave] = useState<'cpf' | 'cnpj' | 'phone' | 'email' | 'random'>('cnpj')
  const [valor, setValor] = useState('')
  // Link
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTexto, setLinkTexto] = useState('')
  const [linkTitulo, setLinkTitulo] = useState('')
  const [linkDescricao, setLinkDescricao] = useState('')


  if (!kind) return null

  const opcoesValidas = opcoes.map((o) => o.trim()).filter(Boolean)
  const contatosValidos = contatos.filter((c) => c.name.trim() && c.phone.replace(/\D/g, '').length >= 10)

  const valido =
    kind === 'location'
      ? Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && lat.trim() !== '' && lng.trim() !== ''
      : kind === 'contact'
        ? contatosValidos.length > 0
        : kind === 'poll'
          ? pergunta.trim().length > 0 && opcoesValidas.length >= 2
          : kind === 'pix'
            ? beneficiario.trim().length > 0 && chavePix.trim().length > 0
            : /^https?:\/\/\S+$/i.test(linkUrl.trim())

  const montar = (): SpecialWhatsappMessage => {
    switch (kind) {
      case 'location':
        return {
          type: 'location',
          latitude: lat.trim(),
          longitude: lng.trim(),
          name: nomeLocal.trim() || undefined,
          address: endereco.trim() || undefined,
        }
      case 'contact':
        return {
          type: 'contact',
          contacts: contatosValidos.map((c) => ({
            name: c.name.trim(),
            phone: c.phone.replace(/\D/g, ''),
            description: c.description.trim() || undefined,
          })),
        }
      case 'poll':
        return {
          type: 'poll',
          message: pergunta.trim(),
          options: opcoesValidas,
          maxOptions: multipla ? opcoesValidas.length : 1,
        }
      case 'pix': {
        // O CRM inteiro fala em centavos; digitar "199,90" tem de virar 19990 aqui e não
        // 199 lá na frente.
        const centavos = Math.round(Number(valor.replace(/\./g, '').replace(',', '.')) * 100)
        return {
          type: 'pix',
          merchantName: beneficiario.trim(),
          pixKey: chavePix.trim(),
          keyType: tipoChave,
          amount: Number.isFinite(centavos) && centavos > 0 ? centavos : undefined,
        }
      }
      default:
        return {
          type: 'link',
          message: linkTexto.trim(),
          linkUrl: linkUrl.trim(),
          title: linkTitulo.trim() || undefined,
          description: linkDescricao.trim() || undefined,
        }
    }
  }

  const { titulo, descricao } = TITULOS[kind]

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
          {kind === 'location' ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="esp-lat">Latitude</Label>
                  <Input id="esp-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="-23.5505" />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="esp-lng">Longitude</Label>
                  <Input id="esp-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-46.6333" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                No Google Maps: clique com o botão direito no ponto e copie os dois números que aparecem.
              </p>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-nome-local">Nome do lugar</Label>
                <Input
                  id="esp-nome-local"
                  value={nomeLocal}
                  onChange={(e) => setNomeLocal(e.target.value)}
                  placeholder="Instituto Lorena"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-endereco">Endereço</Label>
                <Input
                  id="esp-endereco"
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  placeholder="Av. Exemplo, 123 — Maringá/PR"
                />
              </div>
            </>
          ) : null}

          {kind === 'contact'
            ? contatos.map((c, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-border p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-muted-foreground">Contato {i + 1}</span>
                    {contatos.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setContatos((atuais) => atuais.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        <span className="sr-only">Remover contato {i + 1}</span>
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      setContatos((atuais) => atuais.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                    }
                    placeholder="Nome"
                    aria-label={`Nome do contato ${i + 1}`}
                  />
                  <Input
                    value={c.phone}
                    onChange={(e) =>
                      setContatos((atuais) => atuais.map((x, idx) => (idx === i ? { ...x, phone: e.target.value } : x)))
                    }
                    placeholder="Telefone com DDD"
                    aria-label={`Telefone do contato ${i + 1}`}
                  />
                </div>
              ))
            : null}
          {kind === 'contact' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setContatos((atuais) => [...atuais, { name: '', phone: '', description: '' }])}
            >
              <Plus className="size-4" aria-hidden />
              Outro contato
            </Button>
          ) : null}

          {kind === 'poll' ? (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-pergunta">Pergunta</Label>
                <Textarea
                  id="esp-pergunta"
                  value={pergunta}
                  onChange={(e) => setPergunta(e.target.value)}
                  placeholder="Qual horário fica melhor pra você?"
                  rows={2}
                />
              </div>
              {opcoes.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={o}
                    onChange={(e) => setOpcoes((atuais) => atuais.map((x, idx) => (idx === i ? e.target.value : x)))}
                    placeholder={`Opção ${i + 1}`}
                    aria-label={`Opção ${i + 1}`}
                  />
                  {opcoes.length > 2 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setOpcoes((atuais) => atuais.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      <span className="sr-only">Remover opção {i + 1}</span>
                    </Button>
                  ) : null}
                </div>
              ))}
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={opcoes.length >= 12}
                  onClick={() => setOpcoes((atuais) => [...atuais, ''])}
                >
                  <Plus className="size-4" aria-hidden />
                  Opção
                </Button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={multipla}
                    onChange={(e) => setMultipla(e.target.checked)}
                    className="size-3.5"
                  />
                  Deixar marcar mais de uma
                </label>
              </div>
            </>
          ) : null}

          {kind === 'pix' ? (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-benef">Beneficiário</Label>
                <Input
                  id="esp-benef"
                  value={beneficiario}
                  onChange={(e) => setBeneficiario(e.target.value)}
                  placeholder="Instituto Lorena"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-tipo-chave">Tipo da chave</Label>
                <Select value={tipoChave} onValueChange={(v) => setTipoChave(v as typeof tipoChave)}>
                  <SelectTrigger id="esp-tipo-chave">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cnpj">CNPJ</SelectItem>
                    <SelectItem value="cpf">CPF</SelectItem>
                    <SelectItem value="phone">Telefone</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="random">Aleatória</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-chave">Chave</Label>
                <Input id="esp-chave" value={chavePix} onChange={(e) => setChavePix(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-valor">Valor (opcional)</Label>
                <Input id="esp-valor" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="199,90" />
              </div>
            </>
          ) : null}

          {kind === 'link' ? (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-url">Link</Label>
                <Input
                  id="esp-url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-link-texto">Mensagem</Label>
                <Textarea
                  id="esp-link-texto"
                  value={linkTexto}
                  onChange={(e) => setLinkTexto(e.target.value)}
                  rows={2}
                  placeholder="Olha aqui o que combinamos:"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-link-titulo">Título do card</Label>
                <Input id="esp-link-titulo" value={linkTitulo} onChange={(e) => setLinkTitulo(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="esp-link-desc">Descrição do card</Label>
                <Input id="esp-link-desc" value={linkDescricao} onChange={(e) => setLinkDescricao(e.target.value)} />
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="button" disabled={!valido || enviando} onClick={() => void onSend(montar())}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
