import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function AdminLabPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canManageUsers) {
    return (
      <AppLayout title="Admin Lab" subtitle="Sem permissao para rotas administrativas.">
        <section className="panel">
          <p>Apenas administradores podem acessar esta area.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Admin Lab" subtitle="Ferramentas de suporte para homologacao e manutencao.">
      <section className="panel-grid two-col">
        <article className="panel">
          <h2>Seed de dados</h2>
          <p>Popula usuarios, pipelines e configuracoes iniciais para ambiente de homologacao.</p>
          <button className="primary" onClick={() => void crm.seedSupabase()} disabled={crm.isLoading}>
            Seed dados
          </button>
        </article>

        <article className="panel">
          <h2>Usuarios auth de teste</h2>
          <p>Cria usuarios padrao de SDR para demos controladas.</p>
          <button onClick={() => void crm.createTestAuthUsers()} disabled={crm.isLoading}>
            Criar auth teste
          </button>
        </article>

        <article className="panel">
          <h2>Replay webhook</h2>
          <p>Dispara replay manual para fila de webhooks.</p>
          <button onClick={() => void crm.runWebhookReplay()} disabled={crm.isLoading}>
            Reprocessar webhook
          </button>

          <ul className="editable-list">
            {crm.queueJobs.slice(0, 10).map((job) => (
              <li key={job.id}>
                <div className="item-main">
                  <strong>{job.source}</strong>
                  <small>{new Date(job.createdAt).toLocaleString('pt-BR')}</small>
                  <span>{job.note}</span>
                </div>
                <span className={`status-pill ${job.status}`}>{job.status}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel">
          <h2>Sincronizacao</h2>
          <p>Forca leitura completa do estado atual do Supabase.</p>
          <button onClick={() => void crm.syncFromSupabase()} disabled={crm.isLoading}>
            Sincronizar agora
          </button>
        </article>
      </section>
    </AppLayout>
  )
}
