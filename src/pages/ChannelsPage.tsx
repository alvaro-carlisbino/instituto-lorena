import { AppLayout } from '../layouts/AppLayout'
import { useCrm } from '../context/CrmContext'

export function ChannelsPage() {
  const crm = useCrm()

  if (!crm.currentPermission.canRouteLeads) {
    return (
      <AppLayout title="Canais Configuraveis" subtitle="Sem permissao para editar canais no perfil atual.">
        <section className="panel">
          <p>Seu perfil pode visualizar canais, mas nao pode alterar configuracoes.</p>
        </section>
      </AppLayout>
    )
  }

  return (
    <AppLayout title="Canais Configuraveis" subtitle="Ative canais, ajuste prioridade, SLA e resposta automatica.">
      <section className="panel toolbar">
        <button className="primary" onClick={crm.addChannel}>
          Novo canal
        </button>
      </section>

      <section className="panel-grid two-col">
        {crm.channels.map((channel) => (
          <article key={channel.id} className="panel">
            <header>
              <input value={channel.name} onChange={(event) => crm.updateChannel(channel.id, { name: event.target.value })} />
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={channel.enabled}
                  onChange={(event) => crm.updateChannel(channel.id, { enabled: event.target.checked })}
                />
                Ativo
              </label>
            </header>

            <div className="form-grid">
              <label>
                SLA (min)
                <input
                  type="number"
                  min={1}
                  value={channel.slaMinutes}
                  onChange={(event) => crm.updateChannel(channel.id, { slaMinutes: Number(event.target.value) })}
                />
              </label>

              <label>
                Prioridade
                <div className="inline-actions">
                  <button onClick={() => crm.moveChannelPriority(channel.id, 'up')}>Subir</button>
                  <button onClick={() => crm.moveChannelPriority(channel.id, 'down')}>Descer</button>
                  <span className="badge">{channel.priority}</span>
                </div>
              </label>

              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={channel.autoReply}
                  onChange={(event) => crm.updateChannel(channel.id, { autoReply: event.target.checked })}
                />
                Resposta automatica
              </label>

              <button className="danger" onClick={() => crm.removeChannel(channel.id)}>
                Remover canal
              </button>
            </div>
          </article>
        ))}
      </section>
    </AppLayout>
  )
}
