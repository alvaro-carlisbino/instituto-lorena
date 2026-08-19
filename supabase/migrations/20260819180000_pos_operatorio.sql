-- Pós-operatório: o paciente operou, e depois some.
--
-- Pedido do Álvaro (19/08/2026): "depois que o paciente faz a cirurgia ele passa
-- aqui três ou quatro vezes. Seria legal ter esse controle, e ver quem completa um
-- ano e não veio no retorno. E até colocar se ele comprou Tricopill, se comprou
-- shampoo."
--
-- Os três sistemas já sabem tudo, separados: a SALA sabe quem operou e quando
-- (espelho srg_*), a SHOSP sabe quem voltou (shosp_appointments), e a LOJA sabe
-- quem comprou (rede_payments). Nenhum deles se olhava.
--
-- OS MARCOS SAÍRAM DO DADO, não de palpite. Distribuição real das consultas depois
-- da cirurgia, por paciente: 68 voltam em até 3 dias (curativo/primeira lavagem),
-- 63 entre 4 e 15, 79 no primeiro mês, 54 no terceiro, 57 no sexto — e só 23 depois
-- de 8 meses. O funil de retorno afunila igual funil de venda.
--
-- As janelas são CONTÍGUAS de propósito: toda consulta pós-cirúrgica cai em
-- exatamente um marco. Com buracos entre as faixas, a consulta que acontecesse no
-- dia 140 não contaria em lugar nenhum e o paciente apareceria como faltoso.
--
-- STATUS DE COMPARECIMENTO: a Shosp não tem "Atendido" — ela diz Agendado,
-- Confirmado, Desmarcado, Faltou. Então "veio" se lê pela DATA já ter passado com o
-- agendamento de pé, e nunca pelo status ([[shosp_status_sem_atendido]]).
--
-- O RETORNO DE 1 ANO AINDA NÃO EXISTE NA BASE: a cirurgia mais antiga registrada é
-- de 17/11/2025, então o primeiro aniversário cai em nov/2026. A tela precisa dizer
-- isso, senão "0 pendentes no marco de 1 ano" é lido como "está tudo em dia".

-- Chave de telefone que aguenta o 9º dígito: DDD + os 8 finais. Comparar o número
-- inteiro perde o paciente cadastrado sem o 9, e comparar só os 8 finais casa
-- gente de DDD diferente ([[crm_identidade_telefone_nono_digito]]).
create or replace function public.crm_fone_chave(p_fone text)
returns text
language sql
immutable
as $fn$
  with d as (
    select regexp_replace(coalesce(p_fone, ''), '\D', '', 'g') as n
  ), sem_pais as (
    select case when length(n) in (12, 13) and left(n, 2) = '55' then substr(n, 3) else n end as n
    from d
  )
  select case when length(n) between 10 and 11 then left(n, 2) || right(n, 8) end
  from sem_pais;
$fn$;

revoke all on function public.crm_fone_chave(text) from public, anon;
grant execute on function public.crm_fone_chave(text) to authenticated, service_role;

create or replace function public.crm_pos_operatorio(p_desde_dias int default 400)
returns table (
  surgery_id     int,
  sale_id        uuid,
  dia            date,
  dias_desde     int,
  prontuario     text,
  lead_id        text,
  paciente       text,
  telefone       text,
  procedimento   text,
  marcos         jsonb,
  /** Primeiro marco vencido sem consulta — é a linha de trabalho da recepção. */
  marco_devendo  text,
  vencido_ha     int,
  retornos_feitos int,
  retornos_perdidos int,
  comprou_produto boolean,
  produto_cents  bigint,
  ultima_compra  date
)
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if coalesce((select t.polo_type from public.tenants t where t.id = public.current_tenant_id()), '') <> 'clinic' then
    raise exception 'O pós-operatório é da clínica. Troque de polo para ver esta tela.'
      using errcode = '42501';
  end if;
  if not (public.can_route_leads() or public.current_user_can_finance()) then
    raise exception 'Sem permissão para ver o pós-operatório.' using errcode = '42501';
  end if;

  return query
  with operados as (
    -- Quem a SALA registrou. É a verdade do que aconteceu.
    select s.id as srg_id, cs.id as venda_id, s.dia as d,
           s.shosp_prontuario as pront,
           coalesce(s.lead_id, cs.lead_id) as lead,
           coalesce(nullif(s.paciente_nome, ''), cs.patient_name) as nome,
           cs.procedure_label as proc
    from public.srg_surgeries s
    left join public.clinic_sales cs on cs.srg_surgery_id = s.id
    where s.deleted_at is null
      and s.dia <= current_date
      and s.dia >= current_date - p_desde_dias
      and s.tenant_id = public.current_tenant_id()
    union all
    -- Cirurgia que só existe na venda: a sala não registrou, mas o paciente operou.
    -- Sumir com ela faria a fila de retorno esquecer justamente quem já é caso solto.
    select null::int, cs.id, (cs.scheduled_at at time zone 'America/Sao_Paulo')::date,
           cs.shosp_prontuario, cs.lead_id, cs.patient_name, cs.procedure_label
    from public.clinic_sales cs
    where cs.kind = 'cirurgia'
      and cs.srg_surgery_id is null
      and cs.status <> 'cancelada'
      and cs.scheduled_at is not null
      and (cs.scheduled_at at time zone 'America/Sao_Paulo')::date
          between current_date - p_desde_dias and current_date
      and cs.tenant_id = public.current_tenant_id()
  ),
  -- Um paciente pode ter duas cirurgias (segunda sessão). O acompanhamento é da
  -- MAIS RECENTE: contar retorno da primeira sessão daria o paciente como em dia.
  base as (
    select distinct on (coalesce(o.pront, o.venda_id::text, o.srg_id::text))
           o.srg_id, o.venda_id, o.d, o.pront, o.lead, o.nome, o.proc,
           coalesce(nullif(p.celular, ''), nullif(p.telefone, ''), l.phone) as fone
    from operados o
    left join public.shosp_patients p on p.prontuario = o.pront
    left join public.leads l on l.id = o.lead
    order by coalesce(o.pront, o.venda_id::text, o.srg_id::text), o.d desc
  ),
  marco (ordem, nome, alvo, ini, fim) as (
    values (1, 'Curativo / 1ª lavagem',  2,   0,   6),
           (2, 'Retorno 15 dias',       15,   7,  26),
           (3, 'Retorno 1 mês',         30,  27,  60),
           (4, 'Retorno 3 meses',       90,  61, 135),
           (5, 'Retorno 6 meses',      180, 136, 260),
           (6, 'Retorno 1 ano',        365, 261, 450)
  ),
  -- Consultas do paciente depois da cirurgia, já classificadas no marco.
  consultas as (
    select b.pront, b.d, m.ordem,
           min(a.data) filter (where a.data <= current_date) as veio_em,
           min(a.data) filter (where a.data > current_date)  as agendado_para
    from base b
    join marco m on true
    join public.shosp_appointments a
      on a.prontuario = b.pront
     and a.data - b.d between m.ini and m.fim
     and a.status not in ('Desmarcado', 'Faltou')
    where b.pront is not null
    group by b.pront, b.d, m.ordem
  ),
  linha as (
    select b.*, m.ordem, m.nome as marco_nome, m.alvo, m.fim,
           b.d + m.alvo as previsto,
           c.veio_em, c.agendado_para,
           case
             -- Sem prontuário não dá para perguntar à Shosp se o paciente voltou.
             -- Chamar isso de "não veio" é acusar 114 pacientes de faltar num
             -- retorno que talvez tenham feito: é buraco de VÍNCULO, não de
             -- comparecimento, e some da fila de cobrança em bucket próprio.
             when b.pront is null                            then 'sem_vinculo'
             when c.veio_em is not null                      then 'veio'
             when c.agendado_para is not null                then 'agendado'
             -- Janela fechada e ninguém apareceu. Só aqui é cobrança.
             when b.d + m.fim < current_date                 then 'nao_veio'
             else 'aguardando'
           end as situacao
    from base b
    join marco m on true
    left join consultas c on c.pront = b.pront and c.d = b.d and c.ordem = m.ordem
  ),
  -- Compra de produto: o paciente da clínica e o cliente da loja são leads
  -- DIFERENTES, em polos diferentes. O que liga os dois é o telefone.
  compras as (
    select public.crm_fone_chave(l.phone) as chave,
           sum(r.amount_cents)::bigint as cents,
           max(coalesce(r.paid_at, r.created_at))::date as ultima
    from public.rede_payments r
    join public.leads l on l.id = r.lead_id
    where r.status = 'paid' and public.crm_fone_chave(l.phone) is not null
    group by 1
  )
  select
    x.srg_id,
    x.venda_id,
    x.d,
    (current_date - x.d)::int,
    x.pront,
    x.lead,
    x.nome,
    x.fone,
    x.proc,
    x.marcos,
    x.marco_devendo,
    x.vencido_ha,
    x.feitos,
    x.perdidos,
    (co.cents is not null),
    coalesce(co.cents, 0)::bigint,
    co.ultima
  from (
    select l.srg_id, l.venda_id, l.d, l.pront, l.lead, l.nome, l.fone, l.proc,
           jsonb_agg(jsonb_build_object(
             'ordem', l.ordem, 'marco', l.marco_nome, 'previsto', l.previsto,
             'situacao', l.situacao, 'veio_em', l.veio_em, 'agendado_para', l.agendado_para
           ) order by l.ordem) as marcos,
           -- O marco a COBRAR é o mais recente vencido, não o primeiro. Ligar para
           -- um paciente de 9 meses atrás para marcar retirada de curativo não serve
           -- a ninguém; o que ele deve hoje é o retorno de 6 meses.
           (array_agg(l.marco_nome order by l.ordem desc) filter (where l.situacao = 'nao_veio'))[1] as marco_devendo,
           min((current_date - (l.d + l.fim))::int) filter (where l.situacao = 'nao_veio') as vencido_ha,
           count(*) filter (where l.situacao = 'veio')::int as feitos,
           count(*) filter (where l.situacao = 'nao_veio')::int as perdidos
    from linha l
    group by l.srg_id, l.venda_id, l.d, l.pront, l.lead, l.nome, l.fone, l.proc
  ) x
  left join compras co on co.chave = public.crm_fone_chave(x.fone)
  order by x.d desc;
end;
$fn$;

revoke all on function public.crm_pos_operatorio(int) from public, anon;
grant execute on function public.crm_pos_operatorio(int) to authenticated, service_role;

comment on function public.crm_pos_operatorio(int) is
  'Acompanhamento pós-cirúrgico: para cada paciente operado, em que marco de retorno ele está, quais perdeu, e se comprou produto na loja (casado por telefone). Marcos derivados da distribuição real de consultas pós-cirurgia.';
