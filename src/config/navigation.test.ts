// Guarda de polo da NAVEGAÇÃO.
//
// Desde que cada negócio ganhou o seu endereço (VITE_POLO_FIXO), uma tela do outro polo no
// menu não é mais um item inútil: é um beco. Não existe mais seletor de workspace para onde
// mandar a pessoa — ela clica, lê "troque para o workspace X" e não tem o botão.
//
// Foi exatamente o que aconteceu com /nfe: a entrada nasceu só com `canRoute`, virou a única
// tela do grupo Vendas visível no CRM da CLÍNICA, e fez o grupo "VENDAS" inteiro aparecer lá
// dentro. Este teste existe para que a próxima tela nova esbarre aqui e não na recepção.
import { describe, expect, it } from 'vitest'

import { NAV_DESTINATIONS, type NavContext } from '@/config/navigation'

/** Permissões no máximo de propósito: aqui só se mede o POLO, não o cargo. */
const podeTudo = {
  canEditBoards: true,
  canRouteLeads: true,
  canManageUsers: true,
  canViewTvPanel: true,
  canViewFinance: true,
}

const clinica: NavContext = { permissions: podeTudo, isSalesPolo: false }
const vendas: NavContext = { permissions: podeTudo, isSalesPolo: true }

const enxerga = (ctx: NavContext) =>
  NAV_DESTINATIONS.filter((d) => (d.visible ? d.visible(ctx) : true)).map((d) => d.path)

describe('navegação por polo', () => {
  it('nenhuma tela do grupo Vendas aparece no CRM da clínica', () => {
    const vazando = NAV_DESTINATIONS.filter(
      (d) => d.group === 'vendas' && (d.visible ? d.visible(clinica) : true),
    ).map((d) => d.path)

    expect(vazando).toEqual([])
  })

  it('nenhuma tela do grupo Clínica aparece no CRM do Tricopill', () => {
    const vazando = NAV_DESTINATIONS.filter(
      (d) => d.group === 'clinica' && (d.visible ? d.visible(vendas) : true),
    ).map((d) => d.path)

    expect(vazando).toEqual([])
  })

  it('emissão de NF-e é do Tricopill: some na clínica, continua no polo de vendas', () => {
    // O outro lado do teste importa tanto quanto: esconder demais tira a tela de quem emite.
    expect(enxerga(clinica)).not.toContain('/nfe')
    expect(enxerga(vendas)).toContain('/nfe')
  })

  it('telas só da clínica seguem só na clínica', () => {
    expect(enxerga(clinica)).toContain('/agenda')
    expect(enxerga(vendas)).not.toContain('/agenda')
  })
})
