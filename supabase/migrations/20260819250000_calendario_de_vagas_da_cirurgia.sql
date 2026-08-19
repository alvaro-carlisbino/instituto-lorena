-- ─────────────────────────────────────────────────────────────────────────────
-- Calendário de vagas da cirurgia (Central de Vendas › Cirurgias)
--
-- A tabela surgery_open_dates existe desde 14/08/2026 e em 19/08/2026 estava com
-- ZERO linhas: "abrir data" era um formulário de data + número de vagas no fim da
-- Agenda Cirúrgica, e ninguém desce até lá para dizer que sábado tem sala livre.
-- A pedido da gestão, a fila de cirurgias ganha um calendário de quadradinhos
-- onde um clique marca o dia: vermelho = vaga em aberto, verde = preenchida.
--
-- O modelo é o mesmo (uma linha por dia aberto, vagas_livres = slots menos o
-- que está marcado). O que faltava era um jeito de dizer "preenchida" SEM venda
-- no CRM: cirurgia fechada direto com o médico, ou ainda não lançada, ocupa a
-- sala do mesmo jeito, e a vendedora precisa parar de oferecer aquele dia.
-- `filled` é isso — e zera vagas_livres sem depender de clinic_sales.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.surgery_open_dates
  add column if not exists filled boolean not null default false;

comment on column public.surgery_open_dates.filled is
  'Vaga marcada como preenchida à mão (cirurgia fechada fora do CRM). Zera vagas_livres sem precisar de venda.';

-- ATENÇÃO: o `with (security_invoker = true)` NÃO é decoração e NÃO sobrevive a um
-- `create or replace` que o omita (aconteceu em 18/ago/2026 com v_followup_kanban).
-- Sem ele a view roda como dono e ignora o RLS de surgery_open_dates e clinic_sales.
create or replace view public.v_surgery_open_dates with (security_invoker = true) as
select
  d.id,
  d.tenant_id,
  d.dia,
  d.slots,
  d.doctor,
  d.room,
  d.note,
  coalesce(m.marcadas, 0) as marcadas,
  case
    when d.filled then 0
    else greatest(d.slots - coalesce(m.marcadas, 0), 0)
  end as vagas_livres,
  d.filled
from public.surgery_open_dates d
left join lateral (
  select count(*) as marcadas
  from public.clinic_sales s
  where s.tenant_id = d.tenant_id
    and s.kind = 'cirurgia'
    and s.status <> 'cancelada'
    and s.scheduled_at is not null
    and (s.scheduled_at at time zone 'America/Sao_Paulo')::date = d.dia
) m on true;

comment on view public.v_surgery_open_dates is
  'Datas abertas com as vagas que sobraram. vagas_livres > 0 = data sem paciente; filled = preenchida à mão.';
