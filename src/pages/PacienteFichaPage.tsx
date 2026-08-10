import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IdCard, Phone } from 'lucide-react'

import { AppLayout } from '@/layouts/AppLayout'
import { Badge } from '@/components/ui/badge'
import { Paciente360Panel } from '@/components/Paciente360Panel'
import { carregarPaciente360, type Paciente360, type TipoPaciente } from '@/services/pacienteBusca'

/**
 * Ficha de paciente que NÃO tem card no CRM.
 *
 * A tabela `leads` exige funil, etapa e responsável: não existe "cadastrar paciente"
 * sem criar card. Jogar os ~3.200 pacientes históricos do Shosp e do HairMetrix no
 * kanban comercial encheria o board de gente que operou em 2023 e não está em
 * negociação nenhuma.
 *
 * Então a pessoa é encontrada e aberta pela identidade que ela realmente tem:
 * prontuário do Shosp ou pasta do Mirror. Card só nasce quando alguém de fato
 * precisar trabalhar aquela pessoa no funil.
 */
export function PacienteFichaPage() {
  const { tipo, ref } = useParams<{ tipo: string; ref: string }>()
  const navigate = useNavigate()
  const [dados, setDados] = useState<Paciente360 | null>(null)

  const tipoValido: TipoPaciente = tipo === 'shosp' || tipo === 'mirror' ? tipo : 'lead'
  const refDecodificada = ref ? decodeURIComponent(ref) : ''

  useEffect(() => {
    if (!refDecodificada) return
    carregarPaciente360(tipoValido, refDecodificada).then(setDados).catch(() => setDados(null))
  }, [tipoValido, refDecodificada])

  // Paciente que já ganhou card em algum momento pertence à ficha completa,
  // que tem conversa e tarefas. Não duplicamos a ficha aqui.
  useEffect(() => {
    if (dados?.paciente?.lead_id) navigate(`/leads/${dados.paciente.lead_id}`, { replace: true })
  }, [dados, navigate])

  const p = dados?.paciente
  const origem = tipoValido === 'shosp' ? 'Cadastro do Shosp' : 'Pasta do HairMetrix'

  return (
    <AppLayout
      title={p?.nome ?? 'Paciente'}
      subtitle={`${origem}. Esta pessoa ainda não tem card no funil — o histórico abaixo vem do prontuário e dos exames.`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Badge variant="secondary">sem card no CRM</Badge>
        {p?.prontuario ? <span>Prontuário <strong className="text-foreground">{p.prontuario}</strong></span> : null}
        {p?.cpf ? (
          <span className="inline-flex items-center gap-1"><IdCard className="size-3.5" />{p.cpf}</span>
        ) : null}
        {p?.telefone ? (
          <span className="inline-flex items-center gap-1"><Phone className="size-3.5" />{p.telefone}</span>
        ) : null}
        {p?.email ? <span>{p.email}</span> : null}
      </div>

      {refDecodificada ? (
        <Paciente360Panel tipo={tipoValido} refId={refDecodificada} />
      ) : (
        <p className="text-sm text-muted-foreground">Referência de paciente ausente na URL.</p>
      )}
    </AppLayout>
  )
}
