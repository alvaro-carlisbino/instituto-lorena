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

/**
 * Chamado pelo boot com o polo ativo do login (RPC `current_tenant_id`).
 *
 * **No endereço travado, quem manda é o ENDEREÇO.** O `active_tenant_id` é por PESSOA e
 * vive no banco: quem acabou de usar o CRM do Tricopill chega ao CRM da clínica com
 * `tricopill` guardado lá, e o `TenantProvider` leva alguns fetches até realinhar. O boot
 * do CRM roda em PARALELO (o `useCrmState` monta fora do provider) e chegava antes,
 * carimbando aqui o polo VELHO por cima do polo do endereço — e ficava assim até a aba
 * recarregar.
 *
 * O estrago aparecia no envio, 17/set/2026: a tela já era a da clínica e listava os números
 * dela, mas a mensagem saía declarando `senderTenantId: 'tricopill'`. Com a guarda de linha
 * isso vira `linha_indisponivel` na cara de quem atende ("o número wa-wapi-mu4jwsjf não está
 * ativo no polo 'tricopill'"); ANTES dela, a resposta saía calada pelo número do outro
 * negócio. Valor que desmente o endereço é banco atrasado, não notícia: ignora.
 */
export function lembrarPoloDaTela(tenantId: string | null | undefined): void {
  const limpo = typeof tenantId === 'string' ? tenantId.trim() : ''
  if (!limpo) return
  const fixo = poloFixoDoDeploy()
  if (fixo && limpo !== fixo) return
  poloConhecido = limpo
}
