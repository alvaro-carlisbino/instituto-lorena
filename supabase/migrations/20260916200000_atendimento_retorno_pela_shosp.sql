-- Na safra da Central de Vendas todo atendimento aparecia como "Consulta".
--
-- Pedido de 16/set, com print da faixa de setembro: "todos aparecem como consulta,
-- conseguimos alterar os que são retornos? Nem que seja de alguma forma manual".
--
-- A linha nasce na fila de pós-consulta (`fonte = 'pos_consulta'`) e o insert nunca
-- mandou `tipo`, então valia o default. A agenda da Shosp já sabia de parte deles: em
-- setembro havia "RETORNO DE FINALIZAÇÃO" e "RETORNO PÓS PROTOCOLO" no mesmo dia do
-- atendimento. Daqui para a frente o insert grava o tipo pelo serviço
-- (`tipoPeloServico`), e a tela tem troca manual para o retorno que a Shosp agenda como
-- "CONSULTA ...".
--
-- Só dado, nenhuma estrutura: `clinic_atendimentos.tipo` já existia com o check
-- ('consulta', 'retorno'), e a view já lia a coluna.
--
-- Critério conservador: o dia do atendimento tem retorno na agenda daquele paciente e
-- NÃO tem nenhuma consulta. Dia com os dois fica como consulta; se estiver errado, é um
-- clique na tela. Linha manual não é tocada: ali o tipo foi escolhido por alguém.

update public.clinic_atendimentos a
   set tipo = 'retorno'
 where a.fonte = 'pos_consulta'
   and a.tipo = 'consulta'
   and a.lead_id is not null
   and exists (
        select 1 from public.shosp_appointments ap
         where ap.lead_id = a.lead_id
           and ap.data = a.atendido_em
           and ap.servico ~* '^\s*retorno'
       )
   and not exists (
        select 1 from public.shosp_appointments ap
         where ap.lead_id = a.lead_id
           and ap.data = a.atendido_em
           and ap.servico ~* '^\s*consulta'
       );
