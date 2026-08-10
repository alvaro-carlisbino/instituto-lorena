-- Banco automático (Open Finance) — fase "não precisa de ninguém":
--   (a) guarda o SALDO e a saúde da conexão em fin_accounts, pra tela mostrar o número do
--       banco sem ninguém clicar em nada;
--   (b) alerta no sino quando o extrato para de entrar (a falha era 100% silenciosa: a edge
--       engolia o erro por conta e devolvia ok:true — ver [[crm_sistema_no_ar_e_morto]]);
--   (c) sincroniza 3x/dia em vez de 1x, e trocando `sync` por `link`, que também RELIGA
--       conta nova/reconexão sozinho (item novo do banco criava conta nova e o `sync`
--       antigo, que só varre o que já está ligado, nunca a enxergava).

-- ── (a) saldo + saúde da conexão ────────────────────────────────────────────
alter table public.fin_accounts
  add column if not exists of_balance_cents bigint,
  add column if not exists of_balance_at timestamptz,
  add column if not exists of_status text,
  add column if not exists of_last_error text,
  add column if not exists of_meta jsonb;

comment on column public.fin_accounts.of_balance_cents is
  'Saldo lido do banco no último sync. Em conta CRÉDITO é o valor da fatura em aberto.';
comment on column public.fin_accounts.of_last_error is
  'Motivo do último sync que falhou; null quando o último rodou limpo. É o que dispara o alerta.';
comment on column public.fin_accounts.of_meta is
  'Extra do provedor: subtipo, titular e, no cartão, fechamento/vencimento/limite da fatura.';

-- ── (b) alerta quando o extrato para de entrar ──────────────────────────────
-- SQL + pg_cron (sem edge) pelo mesmo motivo do crm_estoque_alerts: cron→edge esbarra nos
-- gotchas de verify_jwt/401 (ver [[crm_cron_auth_gotcha]]).
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
      a.of_last_sync_at,
      -- 3 syncs/dia: passar de 30h sem sincronizar significa que pulou 3 rodadas seguidas.
      (a.of_last_sync_at is null or a.of_last_sync_at < now() - interval '30 hours') as atrasada
    from fin_accounts a
    where a.active
      and a.of_provider is not null
      and a.of_account_id is not null
      and (
        a.of_last_error is not null
        or a.of_last_sync_at is null
        or a.of_last_sync_at < now() - interval '30 hours'
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
        when d.of_last_sync_at is null then 'nunca sincronizou'
        else 'sem extrato novo desde ' || to_char(d.of_last_sync_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      end ||
      '. Abra a Conciliação e reautorize o banco.',
      jsonb_build_object(
        'dedupeKey', 'bank_sync_down:' || d.account_id,
        'route', '/conciliacao',
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

-- ── (c) crons ──────────────────────────────────────────────────────────────
-- O job de sync já existe com o x-cron-secret embutido no command. ALTERAMOS ele em vez de
-- recriar de propósito: recriar exigiria repetir o secret aqui dentro do repositório.
do $$
declare
  j record;
begin
  select jobid, command into j from cron.job where jobname = 'crm-banco-mcp-sync-job';
  if found then
    perform cron.alter_job(
      job_id   := j.jobid,
      -- 08:20, 15:20 e 22:20 UTC = 05:20, 12:20 e 19:20 BRT.
      schedule := '20 8,15,22 * * *',
      command  := replace(j.command, '"action":"sync"', '"action":"link"')
    );
  end if;
end$$;

do $$
begin
  perform cron.unschedule('crm-banco-sync-health');
exception when others then null;
end$$;

-- Roda 1h depois do 1º sync do dia: se o das 05:20 não trouxe nada, às 06:30 o dono já sabe.
select cron.schedule(
  'crm-banco-sync-health',
  '30 9 * * *',
  $$select public.crm_banco_sync_health()$$
);
