-- Conta bancária só entra no financeiro depois que alguém disser que ela é da casa.
--
-- 17/09/2026: o extrato da clínica ganhou seis contas Itaú que não são dela — duas contas
-- correntes pessoais e quatro cartões. Na manhã seguinte elas despejaram 420 lançamentos
-- (R$ 479.822,50 de saída, R$ 449.124,79 de entrada) na fila de classificar, e a conciliação
-- automática ainda deu baixa em três contas a pagar da clínica por coincidência de valor: um
-- "Pix enviado" de conta pessoal quitando NF de fornecedor. O financeiro passou a manhã caçando
-- no extrato do Itaú Empresas lançamento que nunca esteve lá.
--
-- Ninguém errou de botão. O cron de hora em hora chama `crm-banco-mcp` com action "link", e o
-- link ADOTA toda conexão que existir naquele login da MCP.AI — conectar uma conta pessoal lá
-- bastava para ela virar conta da clínica, com 90 dias de histórico junto. O link varre tudo de
-- propósito (é assim que reconexão, que cria item_id novo, se conserta sozinha), então a trava
-- não pode ser "varrer menos": tem que ser conta nova nascer CALADA.
--
-- Daqui em diante: conta desconhecida nasce PENDENTE, não sincroniza lançamento nenhum e não
-- aparece como conta ativa até o financeiro aprovar. Conta já aprovada continua religando
-- sozinha na reconexão, porque o of_account_id é o mesmo.

alter table public.fin_accounts
  add column if not exists of_approval text not null default 'pendente',
  add column if not exists of_approval_at timestamptz,
  add column if not exists of_approval_by uuid references auth.users (id);

alter table public.fin_accounts drop constraint if exists fin_accounts_of_approval_check;
alter table public.fin_accounts
  add constraint fin_accounts_of_approval_check
  check (of_approval in ('pendente', 'aprovada', 'recusada'));

comment on column public.fin_accounts.of_approval is
  'pendente = conexão trouxe a conta e ninguém confirmou que é da casa (não sincroniza); aprovada = entra no financeiro; recusada = vista e rejeitada, não volta a pedir.';

-- O que já estava no ar antes do incidente continua valendo: Itaú Empresas, caixa em dinheiro,
-- contas manuais, Tricopill. Só o que nasceu de 17/09 em diante precisa passar pela aprovação.
update public.fin_accounts
   set of_approval = 'aprovada', of_approval_at = now()
 where created_at < '2026-09-17'::date;

-- A fila de aprovação é lida por data de chegada, e o sync filtra por ela em toda rodada.
create index if not exists fin_accounts_approval_idx
  on public.fin_accounts (tenant_id, of_approval)
  where of_provider is not null;

-- Aprovar/recusar é ato do financeiro, não de quem tem o link da tela.
create or replace function public.crm_conta_aprovar(p_account uuid, p_aprovar boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  update public.fin_accounts
     set of_approval = case when p_aprovar then 'aprovada' else 'recusada' end,
         of_approval_at = now(),
         of_approval_by = auth.uid(),
         -- Recusada não fica ligada ocupando linha na tela de contas nem somando saldo.
         active = p_aprovar,
         updated_at = now()
   where id = p_account
     and tenant_id = public.current_tenant_id();

  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.crm_conta_aprovar(uuid, boolean) from public, anon;
grant execute on function public.crm_conta_aprovar(uuid, boolean) to authenticated;
