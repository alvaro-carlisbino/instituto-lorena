-- MAIS LISTAS SAINDO DO CÓDIGO (e dois campos de texto livre virando lista).
--
-- Continuação da 20260918200000. Três buracos que sobraram, e cada um tem uma causa diferente:
--
-- 1. GRUPO DO CENTRO DE CUSTO era `<Input>` livre na configuração do financeiro. É o campo que
--    junta os centros no relatório de gastos, e "Não é gasto" é o grupo que TIRA o centro do
--    total. Campo livre num agrupador é como "Operação" e "operacao" viram duas linhas, e um
--    dedo errado em "Não é gasto" recoloca uma transferência entre contas dentro da despesa.
--
-- 2. STATUS DE ESTORNO do cancelamento também era `<Input>` livre. O dado já mostra no que deu:
--    além de "Em avaliação" e "Não pagou", existe uma venda cujo status é a frase
--    "Não pagou entrada por ser teste de tc, iria pagar 10 dias antes." — isso é observação, e
--    observação já tem campo próprio (`cancel_note`).
--
-- 3. CATEGORIA DA NOTA CLÍNICA era array `const` no fonte, e é o primeiro caso em que o que fica
--    gravado NÃO é o rótulo: `clinical_notes.category` guarda 'consulta', não 'Consulta'. Daí a
--    coluna `value` abaixo.

-- ───────────────────────────────────────────── opção pode ter código próprio

-- `value` nulo = o rótulo é o valor, que é o caso das listas da migration anterior. Preenchido,
-- o registro guarda o código e a tela mostra o rótulo: renomear passa a ser cosmético, e é por
-- isso que existe — trocar "Recepção / Aline" por outro nome não pode reescrever nota clínica.
alter table public.app_list_options add column if not exists value text;

comment on column public.app_list_options.value is
  'Código gravado no registro quando ele difere do rótulo (ex.: clinical_notes.category). '
  'Nulo = o próprio rótulo é o que fica gravado.';

create unique index if not exists app_list_options_value_uniq
  on public.app_list_options (tenant_id, list_key, lower(btrim(value)))
  where value is not null;

-- ───────────────────────────────────────────── semente

-- Grupos: os que a clínica já usa nos centros de custo. Vêm do DADO e não de uma lista nova,
-- senão a primeira edição de um centro existente ofereceria um grupo que não é o dele.
insert into public.app_list_options (tenant_id, list_key, label, sort_order)
select c.tenant_id, 'financeiro_grupo_centro', btrim(c.grupo), 100
from public.fin_cost_centers c
where c.grupo is not null and btrim(c.grupo) <> ''
group by 1, 2, 3
on conflict do nothing;

insert into public.app_list_options (tenant_id, list_key, label, sort_order)
select t.id, v.lista, v.rotulo, v.ord
from public.tenants t
cross join (values
  ('venda_status_estorno', 'Em avaliação', 10),
  ('venda_status_estorno', 'Estorno aprovado', 20),
  ('venda_status_estorno', 'Estornado', 30),
  ('venda_status_estorno', 'Sem estorno', 40),
  ('venda_status_estorno', 'Não pagou', 50),
  ('venda_status_estorno', 'Crédito para outra data', 60)
) v(lista, rotulo, ord)
where t.polo_type = 'clinic'
on conflict do nothing;

-- Categoria da nota clínica: rótulo na tela, código no registro.
insert into public.app_list_options (tenant_id, list_key, label, value, sort_order)
select t.id, 'nota_clinica_categoria', v.rotulo, v.codigo, v.ord
from public.tenants t
cross join (values
  ('Consulta', 'consulta', 10),
  ('Observação', 'observacao', 20),
  ('Encaminhamento', 'encaminhamento', 30),
  ('Plano / conduta', 'plano', 40),
  ('Recepção / Aline', 'recepcao', 50)
) v(rotulo, codigo, ord)
where t.polo_type = 'clinic'
on conflict do nothing;

-- ───────────────────────────────────────────── uso e renomeação das listas novas

-- Recriadas inteiras (e não com `alter`) porque são `create or replace` de corpo fixo: o que
-- muda é só a lista de colunas que cada chave varre.
create or replace function public.crm_opcoes_uso(p_list_key text)
returns table (label text, usos bigint)
language sql
stable
security definer
set search_path = public
as $$
  with alvo as (
    select btrim(s.procedure_label) as v
      from public.clinic_sales s
     where p_list_key = 'venda_procedimento' and s.tenant_id = public.current_tenant_id()
       and s.kind = 'cirurgia'
    union all
    select btrim(s.procedure_label)
      from public.clinic_sales s
     where p_list_key = 'venda_protocolo' and s.tenant_id = public.current_tenant_id()
       and s.kind = 'protocolo'
    union all
    select btrim(s.consultation_type)
      from public.clinic_sales s
     where p_list_key = 'venda_tipo_consulta' and s.tenant_id = public.current_tenant_id()
    union all
    select btrim(s.payment_method)
      from public.clinic_sales s
     where p_list_key = 'venda_forma_pagamento' and s.tenant_id = public.current_tenant_id()
    union all
    select btrim(s.origin)
      from public.clinic_sales s
     where p_list_key = 'venda_origem' and s.tenant_id = public.current_tenant_id()
    union all
    select btrim(s.cancel_reason)
      from public.clinic_sales s
     where p_list_key = 'venda_motivo_cancelamento' and s.tenant_id = public.current_tenant_id()
    union all
    select btrim(s.refund_status)
      from public.clinic_sales s
     where p_list_key = 'venda_status_estorno' and s.tenant_id = public.current_tenant_id()
    union all
    select btrim(l.lost_reason)
      from public.leads l
     where p_list_key = 'lead_motivo_perda' and l.tenant_id = public.current_tenant_id()
    union all
    select btrim(f.channel)
      from public.lead_followups f
     where p_list_key = 'followup_canal' and f.tenant_id = public.current_tenant_id()
    union all
    select btrim(f.outcome)
      from public.lead_followups f
     where p_list_key = 'followup_resultado' and f.tenant_id = public.current_tenant_id()
    union all
    select btrim(a.origem)
      from public.clinic_atendimentos a
     where p_list_key = 'atendimento_origem' and a.tenant_id = public.current_tenant_id()
    union all
    select btrim(c.grupo)
      from public.fin_cost_centers c
     where p_list_key = 'financeiro_grupo_centro' and c.tenant_id = public.current_tenant_id()
    union all
    -- Aqui o uso é contado pelo CÓDIGO: a tela cruza com `value`, não com o rótulo.
    select btrim(n.category)
      from public.clinical_notes n
     where p_list_key = 'nota_clinica_categoria' and n.tenant_id = public.current_tenant_id()
  )
  select v, count(*)::bigint
  from alvo
  where v is not null and v <> ''
  group by 1
  order by 2 desc;
$$;

revoke all on function public.crm_opcoes_uso(text) from public, anon;
grant execute on function public.crm_opcoes_uso(text) to authenticated;

create or replace function public.crm_renomear_opcao(p_list_key text, p_de text, p_para text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_de text := btrim(p_de);
  v_para text := btrim(p_para);
  v_tenant text := public.current_tenant_id();
  n integer := 0;
begin
  if v_para = '' then
    raise exception 'o nome novo não pode ser vazio';
  end if;
  if v_de = v_para then
    return 0;
  end if;

  if p_list_key = 'venda_procedimento' then
    update public.clinic_sales set procedure_label = v_para
     where tenant_id = v_tenant and kind = 'cirurgia' and btrim(procedure_label) = v_de;
  elsif p_list_key = 'venda_protocolo' then
    update public.clinic_sales set procedure_label = v_para
     where tenant_id = v_tenant and kind = 'protocolo' and btrim(procedure_label) = v_de;
  elsif p_list_key = 'venda_tipo_consulta' then
    update public.clinic_sales set consultation_type = v_para
     where tenant_id = v_tenant and btrim(consultation_type) = v_de;
  elsif p_list_key = 'venda_forma_pagamento' then
    update public.clinic_sales set payment_method = v_para
     where tenant_id = v_tenant and btrim(payment_method) = v_de;
  elsif p_list_key = 'venda_origem' then
    update public.clinic_sales set origin = v_para
     where tenant_id = v_tenant and btrim(origin) = v_de;
  elsif p_list_key = 'venda_motivo_cancelamento' then
    update public.clinic_sales set cancel_reason = v_para
     where tenant_id = v_tenant and btrim(cancel_reason) = v_de;
  elsif p_list_key = 'venda_status_estorno' then
    update public.clinic_sales set refund_status = v_para
     where tenant_id = v_tenant and btrim(refund_status) = v_de;
  elsif p_list_key = 'lead_motivo_perda' then
    update public.leads set lost_reason = v_para
     where tenant_id = v_tenant and btrim(lost_reason) = v_de;
  elsif p_list_key = 'followup_canal' then
    update public.lead_followups set channel = v_para
     where tenant_id = v_tenant and btrim(channel) = v_de;
  elsif p_list_key = 'followup_resultado' then
    update public.lead_followups set outcome = v_para
     where tenant_id = v_tenant and btrim(outcome) = v_de;
  elsif p_list_key = 'atendimento_origem' then
    update public.clinic_atendimentos set origem = v_para
     where tenant_id = v_tenant and btrim(origem) = v_de;
  elsif p_list_key = 'financeiro_grupo_centro' then
    -- O grupo decide o que fica FORA do total de gastos ("Não é gasto"). Renomear sem arrastar
    -- os centros deixaria o relatório com um grupo fantasma e o total errado no mesmo dia.
    update public.fin_cost_centers set grupo = v_para
     where tenant_id = v_tenant and btrim(grupo) = v_de;
  end if;
  get diagnostics n = row_count;

  -- Lista com código próprio (`value` preenchido) não reescreve registro nenhum: o rótulo é só
  -- o que aparece na tela, e o que está gravado é o código.
  if exists (
    select 1 from public.app_list_options
     where tenant_id = v_tenant and list_key = p_list_key
       and lower(btrim(label)) = lower(v_para)
  ) then
    delete from public.app_list_options
     where tenant_id = v_tenant and list_key = p_list_key and btrim(label) = v_de;
  else
    update public.app_list_options
       set label = v_para
     where tenant_id = v_tenant and list_key = p_list_key and btrim(label) = v_de;
  end if;

  return n;
end $$;

revoke all on function public.crm_renomear_opcao(text, text, text) from public, anon;
grant execute on function public.crm_renomear_opcao(text, text, text) to authenticated;

-- ───────────────────────────────────────────── tipo de registro do prontuário

-- A tabela existe desde a 20260526230000 e é FK de `medical_records.record_type`, mas a tela lia
-- um array `const` com os mesmos nove tipos copiados. Duas listas para a mesma coisa é a que
-- envelhece: criar um tipo no banco não aparecia na tela, e um tipo criado na tela quebraria o
-- insert na FK. A tela passa a ler daqui.
--
-- Escrita fica de fora de propósito: o prontuário é append-only, o código viaja em registro
-- assinado, e 'errata' tem regra atrás dele (corrects_record_id). Vocabulário desta lista muda
-- por migration, não por tela.
