import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PatientSearchField, type PatientPick } from '@/components/PatientSearchField'
import {
  CONSULTATION_TYPES,
  DEPOSIT_PAYEE_LABEL,
  ORIGIN_OPTIONS,
  PAYMENT_METHODS,
  PROCEDURE_OPTIONS,
  PROTOCOL_OPTIONS,
  type AnesthesiaProvider,
  type ClinicSale,
  type ClinicSaleKind,
  type DepositPayee,
  type StaffMember,
  createClinicSale,
  listAnesthesiaProviders,
  listSellerNames,
  updateClinicSale,
} from '@/services/clinicSales'

const hojeIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const parseMoney = (v: string): number => {
  const limpo = v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

const showMoney = (cents: number | null | undefined) =>
  cents == null || cents === 0 ? '' : (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })

type Props = {
  open: boolean
  kind: ClinicSaleKind
  staff: StaffMember[]
  editing: ClinicSale | null
  onClose: () => void
  onSaved: () => void
}

/**
 * O formulário que substitui a linha da planilha.
 *
 * Dois campos existem por causa de erro que a célula deixava passar: "a definir"
 * no lugar de data em branco (a planilha escreve "definindo" e some no meio da
 * lista), e a checagem de data do procedimento anterior à venda, que produziu
 * pelo menos uma cirurgia registrada três meses no passado.
 */
export function VendaFormDialog({ open, kind, staff, editing, onClose, onSaved }: Props) {
  const cirurgia = kind === 'cirurgia'
  const medicos = useMemo(() => staff.filter((s) => s.tipo === 'MEDICO'), [staff])
  // A anestesia não sai do espelho da sala: ela tem empresa (Grupo Ingá, Loviderm),
  // e o espelho guarda quem já não atende. Ver listAnesthesiaProviders().
  const [anestesistas, setAnestesistas] = useState<AnesthesiaProvider[]>([])

  const [picked, setPicked] = useState<PatientPick | null>(null)
  const [nomeLivre, setNomeLivre] = useState('')
  const [cidade, setCidade] = useState('')
  const [origem, setOrigem] = useState('')
  const [dataVenda, setDataVenda] = useState(hojeIso())
  const [dataConsulta, setDataConsulta] = useState('')
  const [tipoConsulta, setTipoConsulta] = useState('')
  const [procedimento, setProcedimento] = useState('')
  const [vendedora, setVendedora] = useState('')
  const [sugestoesVendedora, setSugestoesVendedora] = useState<string[]>([])
  const [medicoAtendeu, setMedicoAtendeu] = useState('')
  const [medicoExecuta, setMedicoExecuta] = useState('')
  const [anestesista, setAnestesista] = useState('')
  const [valor, setValor] = useState('')
  const [entrada, setEntrada] = useState('')
  const [entradaData, setEntradaData] = useState('')
  const [entradaPara, setEntradaPara] = useState<'' | DepositPayee>('')
  const [custoMaterial, setCustoMaterial] = useState('')
  const [custoMedico, setCustoMedico] = useState('')
  const [imposto, setImposto] = useState('')
  const [custoOutros, setCustoOutros] = useState('')
  const [pagamento, setPagamento] = useState('')
  const [parcelas, setParcelas] = useState('')
  const [nf, setNf] = useState(false)
  const [dataProc, setDataProc] = useState('')
  const [horaProc, setHoraProc] = useState('07:00')
  const [aDefinir, setADefinir] = useState(false)
  const [hotel, setHotel] = useState(false)
  const [contrato, setContrato] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setPicked(editing.leadId ? { id: editing.leadId, name: editing.patientName, phone: editing.phone ?? '' } : null)
      setNomeLivre(editing.leadId ? '' : editing.patientName)
      setCidade(editing.city ?? '')
      setOrigem(editing.origin ?? '')
      setDataVenda(editing.soldAt)
      setDataConsulta(editing.consultationAt ?? '')
      setTipoConsulta(editing.consultationType ?? '')
      setProcedimento(editing.procedureLabel)
      setVendedora(editing.sellerName ?? '')
      setMedicoAtendeu(editing.attendingDoctor ?? '')
      setMedicoExecuta(editing.performingDoctor ?? '')
      setAnestesista(editing.anesthetist ?? '')
      setValor(showMoney(editing.valueCents))
      setEntrada(showMoney(editing.depositCents))
      setEntradaData(editing.depositAt ?? '')
      setEntradaPara(editing.depositPayee ?? '')
      setCustoMaterial(showMoney(editing.costMaterialsCents))
      setCustoMedico(showMoney(editing.costDoctorCents))
      setImposto(showMoney(editing.taxCents))
      setCustoOutros(showMoney(editing.costOtherCents))
      setPagamento(editing.paymentMethod ?? '')
      setParcelas(editing.installments ? String(editing.installments) : '')
      setNf(editing.invoiceIssued)
      setADefinir(editing.schedulePending && !editing.scheduledAt)
      if (editing.scheduledAt) {
        const d = new Date(editing.scheduledAt)
        setDataProc(
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        )
        setHoraProc(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
      } else {
        setDataProc('')
      }
      setHotel(editing.hotelNeeded)
      setContrato(editing.contractUrl ?? '')
      setObs(editing.note ?? '')
      return
    }
    setPicked(null)
    setNomeLivre('')
    setCidade('')
    setOrigem('')
    setDataVenda(hojeIso())
    setDataConsulta('')
    setTipoConsulta('')
    setProcedimento('')
    setVendedora('')
    setMedicoAtendeu('')
    setMedicoExecuta('')
    setAnestesista('')
    setValor('')
    setEntrada('')
    setEntradaData('')
    setEntradaPara('')
    setCustoMaterial('')
    setCustoMedico('')
    setImposto('')
    setCustoOutros('')
    setPagamento('')
    setParcelas('')
    setNf(false)
    setDataProc('')
    setHoraProc('07:00')
    setADefinir(false)
    setHotel(false)
    setContrato('')
    setObs('')
  }, [open, editing])

  useEffect(() => {
    if (!open) return
    listSellerNames()
      .then(setSugestoesVendedora)
      .catch(() => setSugestoesVendedora([]))
    listAnesthesiaProviders()
      .then(setAnestesistas)
      .catch(() => setAnestesistas([]))
  }, [open])

  // Sugere o mesmo médico para operar, que é o caso comum. Fica editável porque
  // a exceção é frequente: a Dra Lorena atende e fecha para o Dr Matheus operar
  // em boa parte das cirurgias dele.
  useEffect(() => {
    if (medicoAtendeu && !medicoExecuta) setMedicoExecuta(medicoAtendeu)
  }, [medicoAtendeu, medicoExecuta])

  // O lucro aparece enquanto ela digita: é a conta que hoje ela faz na
  // calculadora do celular depois de fechar a planilha.
  const valorCents = parseMoney(valor)
  const custoCents =
    parseMoney(custoMaterial) + parseMoney(custoMedico) + parseMoney(imposto) + parseMoney(custoOutros)
  const lucroCents = valorCents - custoCents

  const salvar = async () => {
    const nome = picked?.name ?? nomeLivre
    const scheduledAt = !aDefinir && dataProc ? new Date(`${dataProc}T${horaProc || '07:00'}:00`).toISOString() : null
    const payload = {
      kind,
      leadId: picked?.id ?? null,
      patientName: nome,
      phone: picked?.phone ?? null,
      city: cidade,
      origin: origem,
      soldAt: dataVenda,
      consultationAt: dataConsulta || null,
      consultationType: tipoConsulta || null,
      procedureLabel: procedimento,
      sellerName: vendedora || null,
      sellerDoctor: medicoAtendeu || null,
      attendingDoctor: medicoAtendeu || null,
      performingDoctor: medicoExecuta || null,
      anesthetist: anestesista || null,
      valueCents: parseMoney(valor),
      depositCents: entrada ? parseMoney(entrada) : null,
      depositAt: entradaData || null,
      depositPayee: entradaPara || null,
      costMaterialsCents: parseMoney(custoMaterial),
      costDoctorCents: parseMoney(custoMedico),
      taxCents: parseMoney(imposto),
      costOtherCents: parseMoney(custoOutros),
      paymentMethod: pagamento || null,
      installments: parcelas ? Number(parcelas) : null,
      invoiceIssued: nf,
      scheduledAt,
      schedulePending: aDefinir || !scheduledAt,
      hotelNeeded: hotel,
      contractUrl: contrato,
      note: obs,
    }
    setSalvando(true)
    try {
      if (editing) await updateClinicSale(editing.id, payload)
      else await createClinicSale(payload)
      toast.success(editing ? 'Venda atualizada.' : 'Venda registrada.')
      onSaved()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  const opcoesProcedimento = cirurgia ? PROCEDURE_OPTIONS : PROTOCOL_OPTIONS

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar venda' : cirurgia ? 'Nova venda cirúrgica' : 'Nova venda de protocolo'}</DialogTitle>
          <DialogDescription>
            {cirurgia
              ? 'Ao salvar com data, o paciente entra na fila de cirurgias e os lembretes de exame são armados sozinhos.'
              : 'Registro da venda de protocolo, com data de agendamento.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Paciente</Label>
            <PatientSearchField
              picked={picked}
              onPick={(p) => setPicked(p)}
              onClear={() => setPicked(null)}
              size="lg"
            />
            {!picked && (
              <Input
                value={nomeLivre}
                onChange={(e) => setNomeLivre(e.target.value)}
                placeholder="Ou digite o nome de quem ainda não está no sistema"
              />
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Data da venda</Label>
              <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data da consulta</Label>
              <Input type="date" value={dataConsulta} onChange={(e) => setDataConsulta(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Cidade</Label>
              <Input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Maringá" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{cirurgia ? 'Tipo de procedimento' : 'Protocolo'}</Label>
              <Input
                list="procedimentos-sugeridos"
                value={procedimento}
                onChange={(e) => setProcedimento(e.target.value)}
                placeholder={cirurgia ? 'Tc Frontal/ Coroa' : 'Protocolo pós TC'}
              />
              <datalist id="procedimentos-sugeridos">
                {opcoesProcedimento.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label>Origem</Label>
              <Input
                list="origens-sugeridas"
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                placeholder="Indicação"
              />
              <datalist id="origens-sugeridas">
                {ORIGIN_OPTIONS.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </div>
          </div>

          {!cirurgia && (
            <div className="space-y-1.5">
              <Label>Tipo de consulta</Label>
              <Input
                list="tipos-consulta"
                value={tipoConsulta}
                onChange={(e) => setTipoConsulta(e.target.value)}
                placeholder="Retorno 1 mês"
              />
              <datalist id="tipos-consulta">
                {CONSULTATION_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="venda-vendedora">Vendedora</Label>
            <Input
              id="venda-vendedora"
              list="vendedoras-sugestao"
              value={vendedora}
              onChange={(e) => setVendedora(e.target.value)}
              placeholder="Quem fechou esta venda"
            />
            <datalist id="vendedoras-sugestao">
              {sugestoesVendedora.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Quem fechou, não o médico da consulta — é o que separa o número da Aline do da Ingrid.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Médico que atendeu e vendeu</Label>
              <Select value={medicoAtendeu} onValueChange={(v) => setMedicoAtendeu(String(v ?? ''))}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolher" />
                </SelectTrigger>
                <SelectContent>
                  {medicos.map((m) => (
                    <SelectItem key={m.id} value={m.nome}>
                      {m.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cirurgia && (
              <div className="space-y-1.5">
                <Label>Médico que vai operar</Label>
                <Select value={medicoExecuta} onValueChange={(v) => setMedicoExecuta(String(v ?? ''))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Escolher" />
                  </SelectTrigger>
                  <SelectContent>
                    {medicos.map((m) => (
                      <SelectItem key={m.id} value={m.nome}>
                        {m.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Na planilha isto é a coluna MÉDICO, o "para quem fechou".
                </p>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Valor</Label>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="30.000,00" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label>Entrada</Label>
              <Input value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="2.500,00" inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label>Data da entrada</Label>
              <Input type="date" value={entradaData} onChange={(e) => setEntradaData(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Parcelas</Label>
              <Input
                value={parcelas}
                onChange={(e) => setParcelas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="10"
                inputMode="numeric"
              />
            </div>
          </div>

          {entrada && (
            <div className="space-y-1.5">
              <Label>A entrada foi paga para</Label>
              <div className="flex flex-wrap gap-1.5">
                {(['clinica', 'anestesista'] as const).map((quem) => (
                  <Button
                    key={quem}
                    type="button"
                    size="sm"
                    variant={entradaPara === quem ? 'default' : 'outline'}
                    onClick={() => setEntradaPara(entradaPara === quem ? '' : quem)}
                  >
                    {DEPOSIT_PAYEE_LABEL[quem]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Entrada que vai direto para o anestesista não passa pela conta da clínica. Sem essa
                marcação, o financeiro procura no extrato um Pix que nunca existiu.
              </p>
            </div>
          )}

          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Custos desta venda</Label>
              <span className="text-sm">
                Lucro:{' '}
                <span className={lucroCents < 0 ? 'font-medium text-destructive' : 'font-medium text-emerald-600'}>
                  {(lucroCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </span>
                {valorCents > 0 && custoCents > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {Math.round((lucroCents / valorCents) * 100)}% de margem
                  </span>
                )}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-normal text-muted-foreground">Material</Label>
                <Input value={custoMaterial} onChange={(e) => setCustoMaterial(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-normal text-muted-foreground">Repasse do médico</Label>
                <Input value={custoMedico} onChange={(e) => setCustoMedico(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-normal text-muted-foreground">Imposto</Label>
                <Input value={imposto} onChange={(e) => setImposto(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-normal text-muted-foreground">Outros</Label>
                <Input value={custoOutros} onChange={(e) => setCustoOutros(e.target.value)} placeholder="0,00" inputMode="decimal" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Pode ficar em branco agora e ser preenchido no fechamento — o painel mostra quantas vendas
              do mês ainda estão sem custo lançado.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Forma de pagamento</Label>
              <Input
                list="formas-pagamento"
                value={pagamento}
                onChange={(e) => setPagamento(e.target.value)}
                placeholder="Cartão de crédito"
              />
              <datalist id="formas-pagamento">
                {PAYMENT_METHODS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </div>
            {cirurgia && (
              <div className="space-y-1.5">
                <Label>Anestesista</Label>
                <Select value={anestesista} onValueChange={(v) => setAnestesista(String(v ?? ''))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Definir depois" />
                  </SelectTrigger>
                  <SelectContent>
                    {anestesistas.map((a) => (
                      <SelectItem key={a.id} value={a.nome}>
                        {a.nome}
                      </SelectItem>
                    ))}
                    {/* O que já está gravado entra como opção mesmo que tenha saído
                        da lista. Sem isto, abrir uma venda antiga mostraria o campo
                        vazio enquanto o banco guarda o nome — e salvar por cima
                        apagaria quem fez a anestesia. */}
                    {anestesista && !anestesistas.some((a) => a.nome === anestesista) && (
                      <SelectItem value={anestesista}>{anestesista} (fora da lista)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-border p-3">
            <Label>{cirurgia ? 'Data da cirurgia' : 'Data do agendamento'}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                type="date"
                value={dataProc}
                disabled={aDefinir}
                min={dataVenda}
                onChange={(e) => setDataProc(e.target.value)}
                className="w-44"
              />
              {cirurgia && (
                <Input
                  type="time"
                  value={horaProc}
                  disabled={aDefinir}
                  onChange={(e) => setHoraProc(e.target.value)}
                  className="w-32"
                />
              )}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={aDefinir}
                  onCheckedChange={(v) => {
                    setADefinir(v === true)
                    if (v === true) setDataProc('')
                  }}
                />
                A definir
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Sem data, o paciente vai para a coluna "Vendido sem data" em vez de sumir na lista.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={nf} onCheckedChange={(v) => setNf(v === true)} />
              Nota fiscal emitida
            </label>
            {cirurgia && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={hotel} onCheckedChange={(v) => setHotel(v === true)} />
                Precisa de hotel
              </label>
            )}
          </div>

          {cirurgia && (
            <div className="space-y-1.5">
              <Label>Link do contrato</Label>
              <Input value={contrato} onChange={(e) => setContrato(e.target.value)} placeholder="https://" />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : editing ? 'Salvar' : 'Registrar venda'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
