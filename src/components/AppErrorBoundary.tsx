import { Component, type ErrorInfo, type ReactNode } from 'react'

import { registrarErroDeTela } from '@/lib/erroDeTela'

type Props = { children: ReactNode }
type State = { erro: Error | null }

/**
 * Nenhuma tela quebrada vira página em branco (17/set/2026).
 *
 * Sem isto, qualquer exceção ao desenhar derrubava o app inteiro e sobrava o fundo vazio, sem
 * mensagem, sem botão e sem registro. A pessoa só conseguia dizer "tá dando tela branca". Agora
 * ela vê o que quebrou, pode recarregar ou voltar ao painel, e o erro fica gravado com a pilha.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { erro: null }

  static getDerivedStateFromError(erro: Error): State {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    void registrarErroDeTela('render', erro, info.componentStack)
  }

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f6f5f3',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          color: '#1f1f1f',
        }}
      >
        <div
          style={{
            maxWidth: 460,
            width: '100%',
            background: '#fff',
            border: '1px solid #e7e2dc',
            borderRadius: 16,
            padding: 24,
            boxShadow: '0 1px 2px rgba(0,0,0,.04)',
          }}
        >
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#b85c3c', letterSpacing: '.04em' }}>
            ALGO QUEBROU NESTA TELA
          </p>
          <h1 style={{ margin: '8px 0 4px', fontSize: 18 }}>O CRM encontrou um erro ao abrir</h1>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: '#555' }}>
            O erro já foi registrado para a equipe técnica. Tente recarregar; se voltar a acontecer, voltar ao
            painel costuma resolver.
          </p>
          <pre
            style={{
              margin: '0 0 16px',
              padding: 10,
              fontSize: 12,
              background: '#f6f5f3',
              borderRadius: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 140,
              overflow: 'auto',
            }}
          >
            {erro.message}
          </pre>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: 0,
                background: '#b85c3c',
                color: '#fff',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Recarregar
            </button>
            <button
              type="button"
              onClick={() => {
                window.location.href = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/dashboard`
              }}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid #e7e2dc',
                background: '#fff',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Voltar ao painel
            </button>
          </div>
        </div>
      </div>
    )
  }
}
