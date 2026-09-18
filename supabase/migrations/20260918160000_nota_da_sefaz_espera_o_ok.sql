-- Nota capturada da SEFAZ espera o "ok" antes de virar dívida.
--
-- Pedido do financeiro em 18/09/2026: "tem muitas notas que o pessoal emite de proposta de venda
-- só. Não sei se teria como fazer um campo ali para eu autorizar: você puxou todas as notas
-- automáticas, mas tivesse um campo 'está ok', aí vai para o extrato".
--
-- Hoje a captura faz as duas coisas de uma vez: puxa a nota da SEFAZ E lança conta a pagar
-- ([[crm_sefaz_captura_automatica]]). Só que nota recebida não é o mesmo que compra a pagar —
-- tem nota de proposta, remessa, brinde, e nota que já foi paga à vista. Tudo virava saldo
-- devedor: 231 parcelas em aberto, R$ 300.389,16, boa parte sem ser dívida.
--
-- A captura continua automática e SEM aprovação de propósito: ela é o passo irreversível (o XML
-- completo só existe se houve ciência nos 10 dias da emissão). Quem passa a esperar é o
-- lançamento, que não tem prazo nenhum.
--
-- Alcance decidido com o Álvaro: a fila vale da captura nova em diante. As 362 notas já lançadas
-- ficam como estão — tirar 231 parcelas do contas a pagar de uma vez esconderia a dívida real
-- junto com a errada.

alter table public.sefaz_documentos
  add column if not exists aprovacao text not null default 'pendente',
  add column if not exists aprovacao_em timestamptz,
  add column if not exists aprovacao_por uuid references auth.users (id);

alter table public.sefaz_documentos drop constraint if exists sefaz_documentos_aprovacao_check;
alter table public.sefaz_documentos
  add constraint sefaz_documentos_aprovacao_check
  check (aprovacao in ('pendente', 'aprovada', 'recusada'));

comment on column public.sefaz_documentos.aprovacao is
  'pendente = capturada, esperando o ok do financeiro (não vira conta a pagar); aprovada = pode lançar; recusada = não é compra a pagar, nunca lança.';

-- Tudo que já foi lançado está aprovado por definição — quem aprovou foi o sistema, antes desta
-- trava existir. Sem isto, 362 notas voltariam para a fila e o contas a pagar mentiria.
update public.sefaz_documentos
   set aprovacao = 'aprovada', aprovacao_em = now()
 where status in ('lancado', 'erro') or created_at < '2026-09-18'::date;

create index if not exists sefaz_documentos_aprovacao_idx
  on public.sefaz_documentos (tenant_id, aprovacao, data_emissao desc);

-- O ok é do financeiro, e é ele que libera o lançamento na rodada seguinte da edge.
create or replace function public.crm_nota_aprovar(p_documento uuid, p_aprovar boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  update public.sefaz_documentos
     set aprovacao = case when p_aprovar then 'aprovada' else 'recusada' end,
         aprovacao_em = now(),
         aprovacao_por = auth.uid(),
         updated_at = now()
   where id = p_documento
     and tenant_id = public.current_tenant_id()
     -- Nota já lançada não volta atrás por aqui: desfazer dívida que o extrato talvez já tenha
     -- conciliado é outro assunto, e tem que ser no contas a pagar, olhando a parcela.
     and status <> 'lancado';

  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.crm_nota_aprovar(uuid, boolean) from public, anon;
grant execute on function public.crm_nota_aprovar(uuid, boolean) to authenticated;

-- A fila que a tela lê: o que chegou e ainda não foi respondido.
create or replace function public.crm_notas_esperando_ok()
returns table(
  id uuid, chave text, numero text, emitente text, cnpj_emitente text,
  valor_cents integer, data_emissao date, xml_completo boolean, natureza text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select d.id, d.chave, d.numero, d.emitente, d.cnpj_emitente,
         d.valor_cents, d.data_emissao, d.xml_completo,
         -- A natureza da operação é o que separa compra de remessa/brinde/proposta, e só existe
         -- quando o XML completo foi guardado. No resumo, quem decide é a pessoa.
         substring(d.xml from 'natOp>([^<]{0,80})')
  from public.sefaz_documentos d
  where d.tenant_id = public.current_tenant_id()
    and d.aprovacao = 'pendente'
    and d.status <> 'lancado'
    and public.current_user_can_finance()
  order by d.data_emissao desc, d.valor_cents desc;
$function$;

revoke all on function public.crm_notas_esperando_ok() from public, anon;
grant execute on function public.crm_notas_esperando_ok() to authenticated;
