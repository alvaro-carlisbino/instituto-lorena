-- O funil da landing /consulta não tinha leitor: toda vez que alguém pergunta "como está
-- a landing?", a resposta sai de SQL escrito na hora. Em 01/set isso cobrou o preço.
--
-- O passo de conversão tem dois nomes na tabela. `landing_contato` era o nome do tempo em
-- que o navegador reportava a tela de contato; desde que a landing encolheu, quem grava é o
-- servidor, depois de criar o lead, como `landing_lead` (ou `prebooking`, quando a pessoa
-- escolhe horário). Contar por `landing_contato` devolve 2 onde a verdade é 10, sem erro
-- nenhum na tela: o número simplesmente vem menor.
--
-- E o nome antigo NÃO entra na soma, apesar de ser "o mesmo passo". As duas linhas que
-- existem provam por que ele nunca serviu:
--   27/ago 15:25:52 `landing_contato`, e 15 segundos depois `landing_lead` da MESMA sessão
--     — o mesmo envio contado duas vezes;
--   27/ago 15:36:43 `landing_contato` sozinho, sem `landing_lead` nenhum atrás
--     — envio que FALHOU (o bug do autofill que produzia telefone impossível) contado como
--       contato.
-- Ou seja: o navegador reportava TENTATIVA. Só o servidor sabe se virou lead, e é por isso
-- que o passo mora lá. As duas linhas ficam no histórico e fora da conta.
--
-- Lead de teste sai da conversão (`excluded_from_metrics`), senão este funil e a porta
-- "landing" do /resultados divergem em 2 e alguém vai caçar bug onde não tem.
--
-- `viram` conta SESSÃO, não evento: a mesma pessoa que recarrega a página não é mais uma
-- pessoa que viu o anúncio. Em 27/ago foram 54 `landing_view` para 23 sessões, e ler o
-- número cru infla a base do funil em 2x justamente no dia de maior tráfego.

create or replace view public.v_landing_consulta_funil as
select
  (e.created_at at time zone 'America/Sao_Paulo')::date as dia,
  count(distinct e.session_id) filter (where e.type = 'landing_view') as viram,
  count(distinct e.session_id) filter (where e.type = 'landing_triagem') as responderam,
  count(*) filter (
    where e.type in ('landing_lead', 'prebooking')
      and not coalesce(l.excluded_from_metrics, false)
  ) as deixaram_contato,
  count(*) filter (where e.type = 'prebooking') as escolheram_horario,
  count(*) filter (where e.type = 'landing_whatsapp') as abriram_whatsapp
from public.storefront_events e
left join public.leads l on l.id = e.lead_id
-- Cerca de polo: `storefront_events` é compartilhada com a loja do Tricopill, e
-- `prebooking` é nome genérico o bastante para o outro polo usar um dia. Sem esta linha
-- o funil da clínica passaria a somar evento de loja. Ver [[feedback_polo_nao_mistura_nem_na_tela]].
where e.tenant_id = 'instituto-lorena'
  and e.path = '/consulta'
  and e.type in (
  'landing_view',
  'landing_triagem',
  'landing_lead',
  'prebooking',
  'landing_whatsapp'
  )
group by 1;

-- `create or replace view` DERRUBA o security_invoker. Sem esta linha a view lê com os
-- direitos do dono e passa por cima da RLS de `storefront_events`, que hoje só libera
-- `is_staff_user()`. Ver [[crm_view_replace_derruba_security_invoker]].
alter view public.v_landing_consulta_funil set (security_invoker = true);

comment on view public.v_landing_consulta_funil is
  'Funil da landing /consulta por dia de Maringá: viram (sessões) → responderam a triagem → deixaram contato → abriram o WhatsApp. O passo de contato soma landing_lead + prebooking, sem lead de teste. O nome antigo landing_contato fica de fora: ele contava tentativa, não contato.';
