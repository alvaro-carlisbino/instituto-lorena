-- Entrada paga e contrato assinado viram campos da venda.
--
-- Pedido de 14/09/2026 na tabela "Vendas cirúrgicas": a linha dizia o VALOR da
-- entrada e para quem ela ia, mas não se ela já foi paga, e não dizia nada do
-- contrato.
--
-- Os dois já existiam como itens do checklist pré-operatório
-- (`surgery_checklist_items`), que saiu da tela em 14/08 quando a confirmação virou
-- um status só. O checklist continua vivo por baixo: `crm-cirurgia-lembretes` lê os
-- itens obrigatórios em aberto e pede ao paciente que confira. Por isso a venda
-- passa a mandar nesses dois itens: marcar aqui fecha o item lá, e o lembrete para
-- de pedir contrato a quem já assinou. Duas fontes dizendo a mesma coisa sem
-- ligação é como nasce divergência.
--
-- Valor inicial: das cirurgias ativas em 14/09, 177 têm "Pagamento da entrada"
-- marcado no checklist, com a data real do pagamento vinda da planilha. Essas nascem
-- pagas. "Contrato assinado" não está marcado em nenhuma, então todas nascem
-- pendentes: é o que o registro diz, não um palpite.
--
-- A ORDEM IMPORTA: o preenchimento vem antes do gatilho. Com o gatilho criado e as
-- colunas ainda em false, a próxima gravação em qualquer venda (o push da sala
-- carimba `srg_surgery_id` sozinho) apagaria as 177 marcações.

begin;

-- O update abaixo passa por `clinic_sales_after_write`, que escreve em `leads` e bate
-- em `enforce_role_write()`. A própria guarda libera service_role.
set local request.jwt.claims = '{"role":"service_role"}';

alter table public.clinic_sales
  add column if not exists deposit_paid boolean not null default false,
  add column if not exists contract_signed boolean not null default false;

comment on column public.clinic_sales.deposit_paid is
  'A entrada já foi paga. Em cirurgia, espelha o item "Pagamento da entrada" do checklist.';
comment on column public.clinic_sales.contract_signed is
  'O contrato já foi assinado. Em cirurgia, espelha o item "Contrato assinado" do checklist.';

update public.clinic_sales s
   set deposit_paid = true
 where not s.deposit_paid
   and exists (
     select 1 from public.surgery_checklist_items i
      where i.sale_id = s.id
        and i.item = 'Pagamento da entrada'
        and i.received_at is not null
   );

update public.clinic_sales s
   set contract_signed = true
 where not s.contract_signed
   and exists (
     select 1 from public.surgery_checklist_items i
      where i.sale_id = s.id
        and i.item = 'Contrato assinado'
        and i.received_at is not null
   );

-- Roda depois de `clinic_sales_after_write` (ordem alfabética dos gatilhos), que é
-- quem cria o checklist quando a cirurgia ganha data: o item recém-criado já sai
-- com a marcação da venda.
create or replace function public.clinic_sales_checklist_segue_venda()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.kind <> 'cirurgia' then
    return new;
  end if;

  update public.surgery_checklist_items i
     set received_at = case
           when (case when i.item = 'Pagamento da entrada' then new.deposit_paid else new.contract_signed end)
             then coalesce(i.received_at, now())
           else null
         end
   where i.sale_id = new.id
     and i.item in ('Pagamento da entrada', 'Contrato assinado')
     and (i.received_at is not null) is distinct from
         (case when i.item = 'Pagamento da entrada' then new.deposit_paid else new.contract_signed end);

  return new;
end $function$;

revoke all on function public.clinic_sales_checklist_segue_venda() from public, anon, authenticated;

drop trigger if exists clinic_sales_checklist_segue_venda on public.clinic_sales;
create trigger clinic_sales_checklist_segue_venda
  after insert or update on public.clinic_sales
  for each row execute function public.clinic_sales_checklist_segue_venda();

commit;
