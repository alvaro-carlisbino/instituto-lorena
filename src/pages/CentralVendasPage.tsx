import { useState } from 'react'

import { AppLayout } from '@/layouts/AppLayout'
import { SubTabs } from '@/components/page/SubTabs'
import { Button } from '@/components/ui/button'
import { CirurgiasTab } from '@/components/vendas/CirurgiasTab'
import { ConferenciaTab } from '@/components/vendas/ConferenciaTab'
import { FollowUpTab } from '@/components/vendas/FollowUpTab'
import { PosConsultaTab } from '@/components/vendas/PosConsultaTab'
import { VendasTab } from '@/components/vendas/VendasTab'
import type { ClinicSaleKind } from '@/services/clinicSales'

export const centralVendasTabs = [
  { to: '/central-vendas', label: 'Vendas' },
  { to: '/central-vendas/follow-up', label: 'Follow-up' },
  { to: '/central-vendas/pos-consulta', label: 'Pós-consulta' },
  { to: '/central-vendas/cirurgias', label: 'Cirurgias' },
  { to: '/central-vendas/conferencia', label: 'Conferência' },
]

export type CentralVendasTab =
  | 'vendas'
  | 'follow-up'
  | 'pos-consulta'
  | 'cirurgias'
  | 'conferencia'

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
  conferencia: {
    title: 'Conferência com a sala',
    subtitle: 'O que a venda afirma contra o que o centro cirúrgico registrou.',
  },
}

export function CentralVendasPage({ tab }: { tab: CentralVendasTab }) {
  const [kind, setKind] = useState<ClinicSaleKind>('cirurgia')
  const cabecalho = TITULO[tab]
  // O follow-up é quadro: precisa da altura da tela para cada coluna rolar por
  // dentro. As outras abas são tabela e rolam a página inteira, como sempre.
  const quadro = tab === 'follow-up'

  return (
    <AppLayout
      title={cabecalho.title}
      subtitle={cabecalho.subtitle}
      fullHeight={quadro}
      mainClassName={
        quadro ? 'min-h-0 px-3 py-4 sm:px-6 sm:py-5 lg:px-8' : undefined
      }
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
      <div className="shrink-0">
        <SubTabs tabs={centralVendasTabs} />
      </div>
      {tab === 'vendas' && <VendasTab kind={kind} />}
      {tab === 'follow-up' && <FollowUpTab />}
      {tab === 'pos-consulta' && <PosConsultaTab />}
      {tab === 'cirurgias' && <CirurgiasTab />}
      {tab === 'conferencia' && <ConferenciaTab />}
    </AppLayout>
  )
}

// O lazyPage() do App.tsx só sabe montar componente sem prop, então cada aba tem
// a sua porta de entrada. Todas moram no mesmo chunk.
export const CentralVendasVendasPage = () => <CentralVendasPage tab="vendas" />
export const CentralVendasFollowUpPage = () => <CentralVendasPage tab="follow-up" />
export const CentralVendasPosConsultaPage = () => <CentralVendasPage tab="pos-consulta" />
export const CentralVendasCirurgiasPage = () => <CentralVendasPage tab="cirurgias" />
export const CentralVendasConferenciaPage = () => <CentralVendasPage tab="conferencia" />
