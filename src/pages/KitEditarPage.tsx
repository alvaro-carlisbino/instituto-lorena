import { useNavigate, useParams } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { EditarKit } from '@/components/kits/EditarKit'
import { EstadoDaTela, VoltarParaKits } from '@/components/kits/TelaDoKit'
import { LISTA_DE_KITS, useKitDaTela, voltarDaTela } from '@/components/kits/navegacaoDoKit'
import { useTenant } from '@/context/TenantContext'

/** /kits/:kitId/editar: paciente, venda, itens e cobranças do kit. É o link do Resultado por cirurgia. */
export function KitEditarPage() {
  const { kitId = '' } = useParams()
  const navigate = useNavigate()
  const { tenant } = useTenant()
  const { kit, items, lastCosts, carregando, erro, recarregarKit, trocarItem } = useKitDaTela(kitId, { comCustos: true })

  return (
    <AppLayout
      title={kit?.patientName ? `Kit de ${kit.patientName}` : 'Editar kit'}
      subtitle={kit ? [kit.name, kit.procedureLabel].filter(Boolean).join(' · ') : undefined}
    >
      <VoltarParaKits />
      <EstadoDaTela carregando={carregando} erro={erro} vazio={kit ? null : 'Kit não encontrado'}>
        {kit ? (
          <EditarKit
            key={kit.id}
            kit={kit}
            tenantId={tenant.id}
            items={items}
            lastCosts={lastCosts}
            onMudou={recarregarKit}
            onItemAtualizado={trocarItem}
            onConcluir={() => voltarDaTela(navigate)}
            onExcluido={() => navigate(LISTA_DE_KITS, { replace: true })}
          />
        ) : null}
      </EstadoDaTela>
    </AppLayout>
  )
}
