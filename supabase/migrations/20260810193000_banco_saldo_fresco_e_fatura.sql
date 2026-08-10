-- Banco automático, parte 2: o número da tela para de mentir a idade, e o cartão passa a
-- ter fatura de verdade.
--
-- O que estava errado (medido em 10/ago/2026, conta Itaú Empresas da clínica):
--
--   (a) SALDO ATRASADO COM CARA DE NOVO. O sync lia /accounts/list (o retrato que o
--       provedor guardou da última atualização DELE) e só disparava /connections/sync no
--       fim, cujo refresh é assíncrono. Ou seja: cada rodada colhia o que a rodada
--       anterior mandou buscar. Pior, `of_balance_at` era carimbado com new Date(), a hora
--       em que a gente GRAVOU, então a tela jurava "agora" sobre número de horas atrás.
--       Na prática: banco com R$ 82.644,32, tela mostrando R$ 67.644,32, faltando dois PIX
--       (R$ 14.000 + R$ 1.000) que já estavam no extrato do Itaú.
--       Agora of_balance_at guarda o `lastUpdatedAt` do PROVEDOR. Se o dado é velho, a tela
--       diz que é velho. Ver [[crm_sistema_no_ar_e_morto]].
--
--   (b) FATURA DO CARTÃO ERA CHUTE. Em conta CREDIT o campo `balance` do provedor varia por
--       conector: uns mandam a fatura aberta, outros a dívida total com parcelas futuras.
--       O CRM chamava tudo de "fatura em aberto". No cartão da clínica ele batia com a
--       fatura FECHADA que vence dia 15, e o ciclo que está correndo (R$ 3.374,41 em
--       compras depois do fechamento) não aparecia em lugar nenhum.
--       Agora vem de /credit-card-bills/list, que devolve valor padronizado por conector.
--
--   (c) DEGRADAÇÃO DO PROVEDOR INVISÍVEL. A api.mcp.ai avisa quando tem incidente aberto
--       ("limite pode vir zerado, não é valor real") e a gente descartava o aviso. O
--       limite disponível do cartão chegava 0,00 com limite de R$ 94.000 e ninguém sabia
--       se era real. Agora o aviso é gravado e aparece na tela.

alter table public.fin_accounts
  add column if not exists of_bill_open_cents  bigint,
  add column if not exists of_bill_due_cents   bigint,
  add column if not exists of_debt_total_cents bigint,
  add column if not exists of_bill_close_date  date,
  add column if not exists of_bill_due_date    date,
  add column if not exists of_provider_note    text;

comment on column public.fin_accounts.of_balance_at is
  'Quando o BANCO foi lido, segundo o provedor (lastUpdatedAt da conexão). Não é a hora em '
  'que gravamos: é isso que permite a tela mostrar "saldo de 15h11" em vez de mentir "agora".';
comment on column public.fin_accounts.of_bill_open_cents is
  'Cartão: fatura do ciclo que ainda está aberto (compras após o fechamento).';
comment on column public.fin_accounts.of_bill_due_cents is
  'Cartão: fatura fechada esperando pagamento. É o valor que sai da conta no vencimento.';
comment on column public.fin_accounts.of_debt_total_cents is
  'Cartão: dívida total pendente, incluindo parcelas de meses seguintes.';
comment on column public.fin_accounts.of_provider_note is
  'Aviso do provedor (incidente aberto, dado degradado). Preenchido = não confie no número.';

-- O alerta de sync parado passa a olhar a idade do DADO, não a hora em que rodamos.
-- Antes, uma conexão que respondia mas devolvia sempre o mesmo retrato velho era "saudável":
-- of_last_sync_at avançava a cada rodada e o alerta nunca disparava.
create or replace function public.crm_banco_sync_health()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n int := 0;
begin
  with parada as (
    select
      a.id as account_id,
      a.tenant_id,
      a.name,
      a.of_last_error,
      -- 3 syncs/dia: passar de 30h sem dado novo do banco significa 3 rodadas seguidas
      -- sem novidade. `of_balance_at` é a idade do DADO; of_last_sync_at só prova que a
      -- edge rodou, e rodar sem trazer nada é exatamente a falha que queremos pegar.
      coalesce(a.of_balance_at, a.of_last_sync_at) as dado_em
    from fin_accounts a
    where a.active
      and a.of_provider is not null
      and a.of_account_id is not null
      and (
        a.of_last_error is not null
        or coalesce(a.of_balance_at, a.of_last_sync_at) is null
        or coalesce(a.of_balance_at, a.of_last_sync_at) < now() - interval '30 hours'
      )
  ),
  destinatarios as (
    select p.*, m.auth_user_id
    from parada p
    join tenant_members m on m.tenant_id = p.tenant_id and m.role in ('admin', 'gestor')
  ),
  ins as (
    insert into app_inbox_notifications (auth_user_id, tenant_id, kind, title, body, metadata)
    select
      d.auth_user_id,
      d.tenant_id,
      'urgent',
      'Banco parou de sincronizar',
      d.name || ': ' ||
      case
        when d.of_last_error is not null then 'o último sync falhou (' || left(d.of_last_error, 160) || ')'
        when d.dado_em is null then 'nunca sincronizou'
        else 'o banco não manda dado novo desde ' || to_char(d.dado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      end ||
      '. Abra Contas & caixa e reautorize o banco.',
      jsonb_build_object(
        'dedupeKey', 'bank_sync_down:' || d.account_id,
        'route', '/contas-caixa',
        'accountId', d.account_id
      )
    from destinatarios d
    where not exists (
      select 1 from app_inbox_notifications n
      where n.auth_user_id = d.auth_user_id
        and n.metadata->>'dedupeKey' = 'bank_sync_down:' || d.account_id
        and n.created_at > now() - interval '24 hours'
    )
    returning 1
  )
  select count(*) into n from ins;

  return n;
end;
$$;

revoke all on function public.crm_banco_sync_health() from public, anon, authenticated;
grant execute on function public.crm_banco_sync_health() to service_role;
