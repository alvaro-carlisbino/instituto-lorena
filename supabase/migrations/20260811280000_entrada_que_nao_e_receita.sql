-- ENTRADA QUE NÃO É RECEITA.
--
-- A saída já sabia dizer "isto não é gasto": existem 'Aplicação financeira (não é despesa)' e
-- 'Transferência entre contas próprias (não é despesa)', e o DRE tira do resultado tudo que casa
-- com '%não é despesa%'. A entrada não tinha equivalente nenhum, e as categorias de receita eram
-- só Consultas, Procedimentos e pacotes, Vendas de produtos e Outros.
--
-- Resultado prático em 11/08/2026: entraram R$ 185.963,73 na conta, dos quais R$ 157.600,00 de
-- uma TED só, no mesmo dia em que saíram R$ 180.107,00 de 'SISPAG TRANSF CC ITAU' já marcada
-- como transferência entre contas próprias. Era o mesmo dinheiro indo e voltando, e o extrato
-- mostrava como se a clínica tivesse faturado isso num dia.
--
-- Sem uma categoria pra apontar, não havia como consertar: o seletor da linha de entrada só
-- oferece categorias de kind='receita'.
--
-- A convenção é o NOME, igual à da saída: quem lê '%não é receita%' sabe que aquilo não é
-- faturamento. Nome como contrato é frágil em geral, mas aqui empata com o que já existe do
-- outro lado, e inventar uma coluna nova faria a saída e a entrada seguirem regras diferentes.
--
-- Idempotente por nome: rodar duas vezes não duplica, e não mexe em quem o usuário já criou.

do $$
declare
  tid text;
  cat text;
  nao_receita text[] := array[
    'Transferência entre contas próprias (não é receita)',
    'Resgate de aplicação (não é receita)'
  ];
begin
  foreach tid in array array['instituto-lorena', 'tricopill'] loop
    if exists (select 1 from public.tenants where id = tid) then
      foreach cat in array nao_receita loop
        if not exists (
          select 1 from public.fin_categories
          where tenant_id = tid and kind = 'receita' and name = cat
        ) then
          insert into public.fin_categories (tenant_id, name, kind) values (tid, cat, 'receita');
        end if;
      end loop;
    end if;
  end loop;
end $$;
