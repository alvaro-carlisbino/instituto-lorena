-- Segunda rota de identidade para a cirurgia, e o lead que faltava.
--
-- Estado antes: das 175 cirurgias do espelho, 108 tinham prontuário (casadas contra
-- shosp_patients por nome idêntico) e apenas 27 chegavam a um lead. As outras 67 ficavam
-- órfãs para sempre, porque a única rota de identidade era o nome no Shosp.
--
-- Existe uma segunda rota que ninguém tinha usado: o nome digitado na planilha de vendas
-- (clinic_sales.patient_name). Ela recupera 14 das 67. E o lead, que é o que faz a cirurgia
-- aparecer na ficha do paciente, pode vir de dois lugares: do shosp_patients (35 casos) e da
-- própria venda (21 casos). Resultado: cirurgia com lead sai de 27 para 71.
--
-- A trava continua sendo a de srg_match_patients: só casa quando é ÚNICO dos DOIS lados. Um
-- nome que aparece em duas vendas, ou uma venda que casa com duas cirurgias, fica órfã de
-- propósito. Mostrar a cirurgia de um paciente para outro é o pior erro possível aqui.
--
-- Normalização de nome: usa srg_norm_name(), que já existia. Chegou a nascer aqui um
-- srg_norm_nome() com a mesma responsabilidade; foi removido antes de virar dívida (a regra
-- de normalizar nome mora em UM lugar).

-- ---------------------------------------------------------------------------
-- Rota 2: cirurgia órfã <-> nome na venda
-- ---------------------------------------------------------------------------

with orfas as (
  select id, public.srg_norm_name(paciente_nome) as nome
  from public.srg_surgeries
  where shosp_prontuario is null
    and deleted_at is null
    and public.srg_norm_name(paciente_nome) is not null
), vendas as (
  select id, lead_id, shosp_prontuario, public.srg_norm_name(patient_name) as nome
  from public.clinic_sales
  where kind = 'cirurgia'
    and public.srg_norm_name(patient_name) is not null
), par as (
  select o.id as surgery_id, v.lead_id, v.shosp_prontuario
  from orfas o
  join vendas v on v.nome = o.nome
  where (select count(*) from vendas v2 where v2.nome = o.nome) = 1
    and (select count(*) from orfas  o2 where o2.nome = o.nome) = 1
)
update public.srg_surgeries s
set lead_id          = coalesce(s.lead_id, par.lead_id),
    shosp_prontuario = coalesce(s.shosp_prontuario, par.shosp_prontuario),
    match_status     = 'venda_nome',
    matched_at       = now()
from par
where s.id = par.surgery_id;

-- ---------------------------------------------------------------------------
-- O lead que faltava
-- ---------------------------------------------------------------------------

update public.srg_surgeries s
set lead_id = p.lead_id
from public.shosp_patients p
where p.prontuario = s.shosp_prontuario
  and s.lead_id is null
  and p.lead_id is not null
  and s.deleted_at is null;

update public.srg_surgeries s
set lead_id = c.lead_id
from public.clinic_sales c
where c.srg_surgery_id = s.id
  and s.lead_id is null
  and c.lead_id is not null
  and s.deleted_at is null;
