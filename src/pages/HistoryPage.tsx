import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'
import { sourceLabel } from '../hooks/useCrmState'

export function HistoryPage() {
  const crm = useCrm()

  return (
    <AppLayout title="Historico Unificado" subtitle="Timeline centralizada por paciente com canais e IA.">
      <section className="history-screen">
        <div className="history-layout">
          <aside>
            {crm.leads.map((lead) => (
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
