import { Suspense, lazy } from 'react'

import { ehLandingDaClinica } from './lib/rotaPublica'

const App = lazy(() => import('./App.tsx'))
const ConsultaLandingPage = lazy(() => import('./pages/ConsultaLandingPage'))

/**
 * A landing pública NÃO passa pelo App.
 *
 * `App` chama `useCrmState()` na primeira linha, que autentica e baixa o retrato do
 * CRM. Quem chega pelo anúncio não tem login e não precisa de nada disso: pagaria o
 * boot inteiro do painel para ler uma página de vendas, e no celular do anúncio é
 * isso que decide se a pessoa fica. Separado aqui, cada lado baixa só o seu pedaço.
 *
 * O polo do endereço manda: no deploy do Tricopill esta rota não existe, porque a
 * clínica não aparece na tela do outro negócio.
 */
export function RootApp() {
  return <Suspense fallback={null}>{ehLandingDaClinica() ? <ConsultaLandingPage /> : <App />}</Suspense>
}

export default RootApp
