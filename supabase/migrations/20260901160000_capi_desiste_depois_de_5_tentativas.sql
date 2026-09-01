-- A CAPI ficou 3 dias mandando os MESMOS 29 eventos de 30 em 30 minutos, todos falhando.
--
-- A causa era `Number(leadgen_id)` na edge function: leadgen_id de 17 dígitos passa de
-- `Number.MAX_SAFE_INTEGER` e vira outro número (36795652870078329 → ...330). A Meta
-- responde "Invalid Lead ID" (subcode 2804036), e como UM id ruim reprova o lote inteiro,
-- dois leads corrompidos seguravam os 29. Isso foi corrigido no código (id vai como string,
-- e lote que cai é repetido um a um).
--
-- Esta migration cuida do que sobra depois do conserto: evento que falha PARA SEMPRE.
-- Um leadgen_id pode expirar de verdade, e nesse caso não existe conserto, só desistência.
-- Sem um teto de tentativas a fila nunca esvazia e o log de falha mente sobre a saúde da
-- integração, porque o mesmo evento aparece falhando todo dia.

alter table public.meta_capi_events
  add column if not exists tentativas integer not null default 0;

comment on column public.meta_capi_events.tentativas is
  'Quantas vezes este evento já foi enviado à Meta. A partir de 5 a fila desiste dele.';

-- Contagem no banco, não na função: a edge function faz upsert e não sabe quantas vezes
-- aquele par (lead, evento) já passou por aqui.
create or replace function public.meta_capi_conta_tentativa()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.tentativas := 1;
  else
    new.tentativas := coalesce(old.tentativas, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_meta_capi_conta_tentativa on public.meta_capi_events;
create trigger trg_meta_capi_conta_tentativa
  before insert or update on public.meta_capi_events
  for each row execute function public.meta_capi_conta_tentativa();

-- Os 29 presos começam do zero: eles nunca tiveram uma tentativa com o código certo, e
-- os eventos ainda estão dentro da janela de 7 dias do pixel.
update public.meta_capi_events set tentativas = 0 where not ok;

-- A fila passa a pular quem já foi entregue E quem esgotou as tentativas.
create or replace function public.crm_meta_capi_pendentes(dias integer default 6)
returns table(lead_id text, leadgen_id text, event_name text, event_time timestamp with time zone, value_reais numeric)
language sql
security definer
set search_path to 'public'
as $function$
  with corte as (select now() - make_interval(days => greatest(dias, 1)) as desde),
  base as (
    select l.id,
           l.attribution->>'leadgen_id' as lg,
           exists (
             select 1 from interactions i
             where i.lead_id = l.id and i.direction = 'in' and i.channel = 'whatsapp'
           ) as respondeu,
           (select min(a.data) from shosp_appointments a where a.lead_id = l.id) as agendou,
           (select min(cs.sold_at)     from clinic_sales cs where cs.lead_id = l.id) as vendeu_em,
           (select max(cs.value_cents) from clinic_sales cs where cs.lead_id = l.id) as venda_cents,
           l.last_interaction_at
    from leads l
    where l.tenant_id = 'instituto-lorena'
      and l.deleted_at is null
      and l.attribution_channel = 'lead_ads'
      and l.attribution->>'leadgen_id' is not null
  ),
  candidatos as (
    select id, lg, 'Purchase'::text as ev, vendeu_em::timestamptz as t, venda_cents / 100.0 as v
      from base where vendeu_em is not null
    union all
    select id, lg, 'Schedule', agendou::timestamptz, null
      from base where agendou is not null
    union all
    select id, lg, 'Contact', coalesce(last_interaction_at, now()), null
      from base where respondeu and agendou is null and vendeu_em is null
  )
  select c.id, c.lg, c.ev, c.t, c.v
  from candidatos c, corte
  where c.t >= corte.desde
    and c.t <= now()
    and not exists (
      select 1 from meta_capi_events e
      where e.lead_id = c.id and e.event_name = c.ev
        and (e.ok or e.tentativas >= 5)
    )
  order by c.t;
$function$;
