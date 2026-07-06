-- Estoque FASE 4: alertas PROATIVOS (aparecem no sino/Inbox mesmo sem ninguém abrir
-- a tela de Estoque). Feito 100% em SQL + pg_cron — sem edge function, evitando os
-- gotchas de verify_jwt/401 de cron→edge (ver [[crm_cron_auth_gotcha]]).
--
-- Gera notificações em app_inbox_notifications (uma por usuário admin/gestor de cada
-- tenant) para: (a) itens abaixo do mínimo; (b) lotes vencidos ou vencendo em ≤30d.
-- Dedup por metadata.dedupeKey (mesmo padrão do handoff): não repete o mesmo alerta
-- pro mesmo usuário se já houver um nas últimas 48h — o cron roda 1x/dia.

create or replace function public.crm_estoque_alerts()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_low int := 0;
  n_exp int := 0;
begin
  -- (a) Estoque abaixo do mínimo
  with low as (
    select i.tenant_id, i.id as item_id, i.name, i.unit, i.min_qty,
           coalesce(b.qty, 0) as qty
    from stock_items i
    join stock_balances b on b.item_id = i.id
    where i.active and i.min_qty > 0 and coalesce(b.qty, 0) < i.min_qty
  ),
  recipients as (
    select low.*, m.auth_user_id
    from low
    join tenant_members m on m.tenant_id = low.tenant_id and m.role in ('admin', 'gestor')
  ),
  ins as (
    insert into app_inbox_notifications (auth_user_id, tenant_id, kind, title, body, metadata)
    select r.auth_user_id, r.tenant_id, 'urgent',
           'Estoque abaixo do mínimo',
           r.name || ': ' || r.qty || '/' || r.min_qty || ' ' || r.unit,
           jsonb_build_object('dedupeKey', 'stock_low:' || r.item_id, 'route', '/estoque', 'itemId', r.item_id)
    from recipients r
    where not exists (
      select 1 from app_inbox_notifications n
      where n.auth_user_id = r.auth_user_id
        and n.metadata->>'dedupeKey' = 'stock_low:' || r.item_id
        and n.created_at > now() - interval '48 hours'
    )
    returning 1
  )
  select count(*) into n_low from ins;

  -- (b) Lotes vencidos / vencendo em ≤30 dias (com saldo > 0)
  with exp as (
    select bb.tenant_id, bb.batch_id, bb.item_id, bb.lot_code, bb.expires_on, bb.qty,
           i.name, i.unit, (bb.expires_on < current_date) as expired
    from stock_batch_balances bb
    join stock_items i on i.id = bb.item_id
    where bb.qty > 0 and bb.expires_on is not null and bb.expires_on <= (current_date + 30)
  ),
  recipients as (
    select exp.*, m.auth_user_id
    from exp
    join tenant_members m on m.tenant_id = exp.tenant_id and m.role in ('admin', 'gestor')
  ),
  ins as (
    insert into app_inbox_notifications (auth_user_id, tenant_id, kind, title, body, metadata)
    select r.auth_user_id, r.tenant_id,
           case when r.expired then 'urgent' else 'info' end,
           case when r.expired then 'Lote vencido no estoque' else 'Lote vencendo no estoque' end,
           r.name || ' lote ' || r.lot_code || ' (' || r.qty || ' ' || r.unit || ', ' ||
             case when r.expired then 'venceu ' else 'vence ' end ||
             to_char(r.expires_on, 'DD/MM/YYYY') || ')',
           jsonb_build_object('dedupeKey', 'stock_exp:' || r.batch_id, 'route', '/estoque', 'batchId', r.batch_id)
    from recipients r
    where not exists (
      select 1 from app_inbox_notifications n
      where n.auth_user_id = r.auth_user_id
        and n.metadata->>'dedupeKey' = 'stock_exp:' || r.batch_id
        and n.created_at > now() - interval '48 hours'
    )
    returning 1
  )
  select count(*) into n_exp from ins;

  return n_low + n_exp;
end;
$$;

grant execute on function public.crm_estoque_alerts() to service_role;

-- Agenda: todo dia às 11:00 UTC (08:00 BRT). Recria idempotente.
select cron.unschedule('crm-estoque-alerts') where exists (
  select 1 from cron.job where jobname = 'crm-estoque-alerts'
);
select cron.schedule('crm-estoque-alerts', '0 11 * * *', $$select public.crm_estoque_alerts()$$);
