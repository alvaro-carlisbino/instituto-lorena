/**
 * Sub-abas compartilhadas entre telas irmãs.
 *
 * As abas de Relatórios estavam escritas à mão em três arquivos (/resultados,
 * /analytics, /metricas) e já tinham divergido — a tela nova do centro cirúrgico
 * teria virado a quarta cópia. Mesmo motivo do registro único de navegação: lista
 * duplicada é lista que envelhece em ordens diferentes.
 *
 * Fica em `config/` e não dentro de uma das páginas porque cada página é um chunk
 * lazy: importar a constante da vizinha arrastaria a tela inteira dela junto.
 */

export const resultadosTabs = [
  { to: '/resultados', label: 'Resultados' },
  { to: '/analytics', label: 'Análise do funil' },
  { to: '/cirurgias/producao', label: 'Centro cirúrgico' },
  { to: '/cirurgias/equipe', label: 'Equipe da sala' },
  { to: '/metricas', label: 'Metas' },
]
