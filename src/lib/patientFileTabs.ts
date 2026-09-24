/** Abas da "Ficha do paciente" — une Resumo (/perfil), Notas clínicas e Prontuário
 *  num só item de menu. */
export function pacienteTabs(): Array<{ to: string; label: string }> {
  return [
    { to: '/perfil', label: 'Resumo' },
    { to: '/notas-clinicas', label: 'Notas clínicas' },
    { to: '/prontuario', label: 'Prontuário' },
  ]
}
