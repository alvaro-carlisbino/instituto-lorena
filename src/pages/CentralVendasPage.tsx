import { useState } from 'react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { CirurgiasTab } from '@/components/vendas/CirurgiasTab'
import { FollowUpTab } from '@/components/vendas/FollowUpTab'
import { PosConsultaTab } from '@/components/vendas/PosConsultaTab'
import { VendasTab } from '@/components/vendas/VendasTab'
import type { ClinicSaleKind } from '@/services/clinicSales'

export const centralVendasTabs = [
  { to: '/central-vendas', label: 'Vendas' },
  { to: '/central-vendas/follow-up', label: 'Follow-up' },
  { to: '/central-vendas/pos-consulta', label: 'Pós-consulta' },
  { to: '/central-vendas/cirurgias', label: 'Cirurgias' },
]

export type CentralVendasTab = 'vendas' | 'follow-up' | 'pos-consulta' | 'cirurgias'

const TITULO: Record<CentralVendasTab, { title: string; subtitle: string }> = {
  vendas: {
    title: 'Central de Vendas',
    subtitle: 'O que fechou, por quem, por quanto e para quando.',
  },
  'follow-up': {
    title: 'Follow-up',
    subtitle: 'Quem precisa de contato hoje e quem já passou da data.',
  },
  'pos-consulta': {
    title: 'Pós-consulta',
    subtitle: 'Paciente que saiu da consulta e ainda não tem funil.',
  },
  cirurgias: {
    title: 'Cirurgias agendadas',
    subtitle: 'Fila do próximo mês, documentação pendente e avisos ao paciente.',
  },
}

export function CentralVendasPage({ tab }: { tab: CentralVendasTab }) {
  const [kind, setKind] = useState<ClinicSaleKind>('cirurgia')
  const cabecalho = TITULO[tab]

  return (
    <AppLayout
      title={cabecalho.title}
      subtitle={cabecalho.subtitle}
      actions={
        tab === 'vendas' ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={kind === 'cirurgia' ? 'default' : 'outline'}
              onClick={() => setKind('cirurgia')}
            >
              Transplante
            </Button>
            <Button
              size="sm"
              variant={kind === 'protocolo' ? 'default' : 'outline'}
              onClick={() => setKind('protocolo')}
            >
              Protocolos e spa
            </Button>
          </div>
        ) : undefined
      }
    >
      <SubTabs tabs={centralVendasTabs} />
      {tab === 'vendas' && <VendasTab kind={kind} />}
      {tab === 'follow-up' && <FollowUpTab />}
      {tab === 'pos-consulta' && <PosConsultaTab />}
      {tab === 'cirurgias' && <CirurgiasTab />}
    </AppLayout>
  )
}

// O lazyPage() do App.tsx só sabe montar componente sem prop, então cada aba tem
// a sua porta de entrada. Todas moram no mesmo chunk.
export const CentralVendasVendasPage = () => <CentralVendasPage tab="vendas" />
export const CentralVendasFollowUpPage = () => <CentralVendasPage tab="follow-up" />
export const CentralVendasPosConsultaPage = () => <CentralVendasPage tab="pos-consulta" />
export const CentralVendasCirurgiasPage = () => <CentralVendasPage tab="cirurgias" />
