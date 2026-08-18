import { poloFixoDoDeploy } from './poloFixo'

/**
 * O polo que ESTA tela está servindo, para as consultas que não podem misturar.
 *
 * A RLS decide o que cada pessoa lê e continua sendo a autoridade. Isto aqui é o segundo
 * cinto da conversa: até 17/ago/2026 as policies de leitura abriam exceção para
 * `is_super_admin()`, e as duas contas de dono são super admin — o histórico de um lead
 * que fala nas duas linhas chegava inteiro, clínica e Tricopill no mesmo fio. A exceção
 * caiu, e este filtro fica para que uma policy nova nascida folgada não embaralhe a tela
 * de novo.
 *
 * Começa valendo o polo do endereço (`VITE_POLO_FIXO`), que é síncrono e já vale no
 * primeiro fetch. Quando o boot descobre o polo ativo de verdade pela RPC
 * `current_tenant_id`, ele confirma aqui. Enquanto ninguém souber, devolve `null` e a
 * consulta sai sem filtro — quem manda continua sendo a RLS.
 */
let poloConhecido: string | null = poloFixoDoDeploy()

/** Polo desta tela, ou `null` quando ainda não se sabe. */
export function poloDaTela(): string | null {
  return poloConhecido
}

/** Chamado pelo boot com o polo ativo do login (RPC `current_tenant_id`). */
export function lembrarPoloDaTela(tenantId: string | null | undefined): void {
  const limpo = typeof tenantId === 'string' ? tenantId.trim() : ''
  if (limpo) poloConhecido = limpo
}
