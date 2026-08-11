-- O protocolo passa a saber QUEM indicou.
--
-- Estado antes: o protocolo do paciente guardava nome, sessões, preço e status, e nada
-- sobre a origem clínica dele. Quem indicou o protocolo ficava só na venda — e nem toda
-- indicação vira venda no mesmo dia, então o crédito da indicação não era mensurável.
--
-- Isso importa porque a clínica tem três médicos que atendem (Lorena, Matheus, Jaqueline)
-- e o protocolo é quase sempre uma prescrição de consulta: o médico indica, a Ingrid fecha.
-- Sem esta coluna não dá para responder "quantos protocolos cada médico indicou no mês".

alter table public.lead_treatment_protocols
  add column if not exists referred_by text;

comment on column public.lead_treatment_protocols.referred_by is
  'Médico que indicou o protocolo. Texto livre: pode ser médico da casa (srg_staff) ou de fora, quando o paciente chega encaminhado.';

create index if not exists lead_treatment_protocols_referred_idx
  on public.lead_treatment_protocols (tenant_id, referred_by)
  where referred_by is not null;

-- ---------------------------------------------------------------------------
-- Backfill: quem ATENDEU a consulta é quem indicou
-- ---------------------------------------------------------------------------
-- Protocolo vendido numa consulta é prescrição de quem estava na sala. A própria
-- Central de Vendas já trata attending_doctor como o vendedor real (ver
-- salesByDoctor em clinicSales.ts). 157 dos 158 protocolos importados têm esse
-- nome na venda de origem; o que sobra fica em branco para alguém preencher, em
-- vez de receber um chute.

update public.lead_treatment_protocols p
   set referred_by = coalesce(cs.attending_doctor, cs.seller_doctor)
  from public.clinic_sales cs
 where cs.id = p.clinic_sale_id
   and p.referred_by is null
   and coalesce(cs.attending_doctor, cs.seller_doctor) is not null;
