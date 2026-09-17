import { useNavigate, useParams } from 'react-router-dom'

import { AppLayout } from '@/layouts/AppLayout'
import { RegistrarUso } from '@/components/kits/RegistrarUso'
import { EstadoDaTela, VoltarParaKits } from '@/components/kits/TelaDoKit'
import { LISTA_DE_KITS, useKitDaTela, voltarDaTela } from '@/components/kits/navegacaoDoKit'

/** /kits/:kitId/uso: registrar o uso do kit montado, ou corrigir o de um kit já usado. */
export function KitUsoPage() {
  const { kitId = '' } = useParams()
  const navigate = useNavigate()
  const { kit, items, consumo, setor, carregando, erro, trocarItem } = useKitDaTela(kitId, { comConsumo: true })
  const corrigindo = kit?.status === 'consumido'

  return (
    <AppLayout
      title={corrigindo ? 'Corrigir uso do kit' : 'Registrar uso do kit'}
      subtitle={kit ? [kit.patientName, kit.name].filter(Boolean).join(' · ') : undefined}
    >
      <VoltarParaKits />
      <EstadoDaTela
        carregando={carregando}
        erro={erro}
        vazio={!kit ? 'Kit não encontrado' : kit.status === 'cancelado' ? 'Este kit foi cancelado' : null}
      >
        {kit ? (
          <RegistrarUso
            key={kit.id}
            kit={kit}
            items={items}
            consumo={consumo}
            setor={setor}
            voltarPara={LISTA_DE_KITS}
            onItemAtualizado={trocarItem}
            onFeito={() => voltarDaTela(navigate)}
          />
        ) : null}
      </EstadoDaTela>
    </AppLayout>
  )
}
