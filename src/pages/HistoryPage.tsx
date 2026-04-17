import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'
import { sourceLabel } from '../hooks/useCrmState'
import { useMemo, useState } from 'react'
import { SkeletonBlocks } from '../components/SkeletonBlocks'

export function HistoryPage() {
  const crm = useCrm()
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const pageSize = 6

  const visibleLeads = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return crm.leads.filter((lead) => {
      if (!normalized) return true
      return lead.patientName.toLowerCase().includes(normalized) || lead.summary.toLowerCase().includes(normalized)
    })
  }, [crm.leads, searchTerm])

  const totalPages = Math.max(1, Math.ceil(visibleLeads.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const paginatedLeads = visibleLeads.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return (
    <AppLayout title="Historico Unificado" subtitle="Timeline centralizada por paciente com canais e IA.">
      <section className="history-screen">
        {crm.isLoading ? <SkeletonBlocks rows={5} /> : null}
        <section className="panel toolbar history-filters">
          <input
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value)
              setPage(1)
            }}
            placeholder="Buscar paciente"
          />
          <div className="inline-actions">
            <button onClick={() => setPage((previous) => Math.max(1, previous - 1))}>Anterior</button>
            <span className="badge">
              {currentPage}/{totalPages}
            </span>
            <button onClick={() => setPage((previous) => Math.min(totalPages, previous + 1))}>Próxima</button>
          </div>
        </section>

        <div className="history-layout">
          <aside>
            {paginatedLeads.map((lead) => (
              <button
                key={lead.id}
                className={crm.selectedLeadId === lead.id ? 'active' : ''}
                onClick={() => crm.setSelectedLeadId(lead.id)}
              >
                <span>{lead.patientName}</span>
                <small>{sourceLabel[lead.source]}</small>
              </button>
            ))}
          </aside>

          <article>
            <h3>{crm.selectedLead?.patientName ?? 'Sem lead selecionado'}</h3>
            <ul>
              {crm.selectedLeadHistory.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.author}</strong>
                    <small>{new Date(item.happenedAt).toLocaleString('pt-BR')}</small>
                  </div>
                  <p>{item.content}</p>
                  <span>
                    {item.channel} | {item.direction}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>
    </AppLayout>
  )
}
