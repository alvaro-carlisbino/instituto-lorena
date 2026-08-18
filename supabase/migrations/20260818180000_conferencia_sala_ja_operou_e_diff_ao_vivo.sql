-- A conferência com a sala tinha dois furos, e os dois davam a MESMA resposta errada:
-- "confirmada pela sala".
--
-- FURO 1 — a sala já operou e a venda não sabe.
--   1 venda segue como "vendida, data a definir" e a cirurgia dela está FINALIZADA no
--   espelho desde 11/06, com 2.257 folículos implantados. Outras 5 seguem "agendada"
--   com a sala já finalizada. São 6 procedimentos executados que o funil não conta —
--   e faturamento que ninguém foi cobrar. A view antiga olhava só se o vínculo existia:
--   existindo, dizia "confirmada", inclusive quando a venda não tinha data nenhuma.
--
-- FURO 2 — a divergência de data estava congelada.
--   `clinic_sales.srg_date_diff_days` é uma coluna GRAVADA no backfill de 11/08. Quem
--   remarcou depois consertou a data e ninguém reescreveu a coluna: 2 vendas aparecem
--   como "data diverge" (-51 e -21 dias) e hoje batem exatamente com a sala. Alarme
--   falso na tela que existe justamente para achar alarme verdadeiro. Mesma família do
--   `last_interaction_at` congelado: número carimbado uma vez envelhece sozinho.
--
-- Conserto: a view passa a CALCULAR a diferença na hora, e ganha duas faixas novas.
-- A coluna gravada continua existindo (é registro de como o vínculo foi feito), mas
-- deixa de mandar no que a tela mostra.

create or replace view public.v_cirurgia_conferencia
with (security_invoker = true) as
with base as (
  select
    c.id            as sale_id,
    c.tenant_id,
    c.lead_id,
    c.patient_name,
    c.shosp_prontuario,
    c.status,
    c.srg_surgery_id,
    c.srg_match_kind,
    (c.scheduled_at at time zone 'America/Sao_Paulo')::date as venda_dia,
    s.dia                as sala_dia,
    s.status             as sala_status,
    s.total_implantados
  from public.clinic_sales c
  -- deleted_at no join: cirurgia apagada no espelho não confirma coisa nenhuma.
  left join public.srg_surgeries s
    on s.id = c.srg_surgery_id
   and s.deleted_at is null
  where c.kind = 'cirurgia'
    and c.status <> 'cancelada'
)
select
  b.sale_id,
  b.tenant_id,
  b.lead_id,
  b.patient_name,
  b.shosp_prontuario,
  b.status,
  b.venda_dia          as data_vendida,
  b.sala_dia           as data_da_sala,
  b.srg_surgery_id,
  b.srg_match_kind,
  -- Ao vivo. Null quando falta uma das duas datas — aí a faixa é outra, não "diverge".
  case
    when b.sala_dia is null or b.venda_dia is null then null
    else b.sala_dia - b.venda_dia
  end                  as srg_date_diff_days,
  b.total_implantados,
  b.sala_status        as status_da_sala,
  case
    -- Ordem = ordem de gravidade. Procedimento executado que o funil não registrou
    -- vem antes de qualquer divergência de data: é dinheiro e é prontuário.
    when b.srg_surgery_id is not null
     and b.sala_status = 'FINALIZADA'
     and b.status <> 'realizada'
      then 'sala_ja_operou'
    when b.srg_surgery_id is not null
     and b.sala_dia is not null
     and b.venda_dia is null
      then 'venda_sem_data'
    when b.srg_surgery_id is not null
     and b.sala_dia is not null
     and b.venda_dia is not null
     and b.sala_dia <> b.venda_dia
      then 'data_diverge'
    when b.srg_surgery_id is not null
      then 'confirmada'
    when b.status = 'realizada'
      then 'realizada_sem_confirmacao'
    when b.status = 'agendada'
      then 'agendada_sem_espelho'
    else 'sem_espelho'
  end                  as conferencia
from base b;

comment on view public.v_cirurgia_conferencia is
  'Venda de cirurgia x o que a sala registrou. "sala_ja_operou" é procedimento FINALIZADO no espelho que a venda ainda não dá como realizado. A divergência de data é calculada na hora, não lida da coluna gravada no backfill.';

grant select on public.v_cirurgia_conferencia to authenticated;

-- ---------------------------------------------------------------------------
-- Passar a data da sala para a venda, com um clique e com gente decidindo
-- ---------------------------------------------------------------------------
-- Existe porque relabelar não resolve: apontar "a sala já operou" e deixar a correção
-- para digitação manual devolve o mesmo erro na semana seguinte. A sala é a fonte da
-- verdade do que aconteceu — quem operou registrou lá.
--
-- Não mexe na agenda da enfermagem de propósito: aqui a cirurgia é PASSADO. Criar ou
-- remover bloco de sala para algo que já aconteceu bagunçaria a agenda de quem opera.

create or replace function public.crm_cirurgia_aplicar_data_da_sala(p_sale_id uuid)
returns table (nova_data timestamptz, novo_status text, virou_realizada boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dia         date;
  v_hora        timestamptz;
  v_sala_status text;
  v_alvo        timestamptz;
begin
  -- Qualificar tudo: em RETURNS TABLE cada coluna de saída vira variável, e nome solto
  -- fica ambíguo com a coluna da tabela (42702).
  select s.dia, s.hora_inicio, s.status
    into v_dia, v_hora, v_sala_status
  from public.clinic_sales c
  join public.srg_surgeries s on s.id = c.srg_surgery_id and s.deleted_at is null
  where c.id = p_sale_id
    and c.kind = 'cirurgia';

  if v_dia is null then
    raise exception 'Esta venda não tem cirurgia com data no espelho da sala.';
  end if;

  -- A hora exata quando a sala registrou; 07:00 local é o padrão da casa quando só há dia.
  v_alvo := coalesce(v_hora, (v_dia + time '07:00') at time zone 'America/Sao_Paulo');

  update public.clinic_sales c
  set scheduled_at     = v_alvo,
      schedule_pending = false,
      -- Só a sala promove para "realizada". Enquanto ela não finalizou, o status da
      -- venda é assunto de quem vende, não desta função.
      status           = case when v_sala_status = 'FINALIZADA' then 'realizada' else c.status end,
      updated_at       = now()
  where c.id = p_sale_id
  returning c.scheduled_at, c.status into nova_data, novo_status;

  -- RLS de SELECT alcança o UPDATE e devolve zero linha sem erro. Sem este teste, a
  -- tela diria "aplicado" para uma venda que não mudou nada.
  if not found then
    raise exception 'Venda não encontrada, ou seu usuário não tem permissão para alterá-la.';
  end if;

  virou_realizada := (v_sala_status = 'FINALIZADA');
  return next;
end;
$$;

comment on function public.crm_cirurgia_aplicar_data_da_sala(uuid) is
  'Copia para a venda a data que o centro cirúrgico registrou, e marca realizada quando a sala finalizou. Não toca na agenda da enfermagem: a cirurgia já aconteceu.';

-- `revoke ... from public` NÃO tira o anon: o Supabase tem ALTER DEFAULT PRIVILEGES no
-- schema public que concede execute a anon a cada função criada. É um grant nomeado, e
-- só sai nomeado. Sem isto, a chave anon (que vai no bundle do front, é pública por
-- definição) chamaria a função. Ela é `security invoker`, então a RLS ainda barraria a
-- escrita — mas defesa em profundidade não se troca por "a outra camada pega".
revoke execute on function public.crm_cirurgia_aplicar_data_da_sala(uuid) from anon, public;
grant execute on function public.crm_cirurgia_aplicar_data_da_sala(uuid) to authenticated;

-- Mesma poeira na função de contagem, que nasceu antes desta migração.
revoke execute on function public.crm_cirurgia_conferencia_resumo() from anon, public;
grant execute on function public.crm_cirurgia_conferencia_resumo() to authenticated;
