-- LISTAS DO SISTEMA — o vocabulário do comercial sai do fonte.
--
-- O financeiro já fazia isto desde a 20260811250000: centro de custo e linha do DRE viraram
-- dado, e quem trabalha no dinheiro mexe na própria estrutura sem esperar deploy. O comercial
-- ficou para trás. Procedimento, protocolo, tipo de consulta, forma de pagamento, origem da
-- venda, motivo de perda, canal e resultado de follow-up: TODOS eram array `const` em
-- `src/services`. Criar "Sobrancelha masculina" ou trocar "Pacote terapia" por outro nome
-- exigia programador — e quem vende é quem sabe o nome certo.
--
-- Uma tabela só, e não uma por lista, porque o que muda entre elas é UMA coisa: para onde o
-- texto viaja quando alguém escolhe. Onze tabelas iguais dariam onze telas e onze services
-- para o mesmo CRUD, e a décima segunda lista voltaria a nascer no fonte por preguiça.
--
-- O valor continua sendo TEXTO na tabela de destino, sem FK. É a mesma escolha do
-- `cost_center`: o nome viaja junto do registro, e relatório que agrupa por procedimento não
-- precisa de join para escrever uma palavra. O preço disso é conhecido e está pago abaixo —
-- renomear tem que ARRASTAR o histórico, senão o passado fica num nome que sumiu da lista.

create table if not exists public.app_list_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id() references public.tenants (id),
  -- Qual lista: 'venda_procedimento', 'followup_resultado'… O catálogo mora no fonte
  -- (src/config/listas.ts) porque é ele que diz onde cada lista APARECE.
  list_key text not null check (length(btrim(list_key)) > 0),
  label text not null check (length(btrim(label)) > 0),
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

-- Mesma opção duas vezes na mesma lista é erro de digitação virando categoria nova.
create unique index if not exists app_list_options_uniq
  on public.app_list_options (tenant_id, list_key, lower(btrim(label)));

create index if not exists app_list_options_lista_idx
  on public.app_list_options (tenant_id, list_key, sort_order);

alter table public.app_list_options enable row level security;

-- Escrita é de qualquer pessoa do tenant, de propósito. Uma lista de vocabulário que só o
-- administrador edita volta a ser o array do fonte com mais passos: quem vende é quem descobre
-- que falta um procedimento, e se ela precisar pedir, ela escreve errado no campo ao lado.
drop policy if exists "app_list_options tenant read" on public.app_list_options;
create policy "app_list_options tenant read" on public.app_list_options
  for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists "app_list_options tenant write" on public.app_list_options;
create policy "app_list_options tenant write" on public.app_list_options
  for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ───────────────────────────────────────────────── semente: o código E o que já está no dado

-- Parte 1: o que estava escrito no fonte. Só em polo de clínica — procedimento de transplante
-- não tem o que fazer na lista do Tricopill, e polo que não mistura na tela também não mistura
-- no cadastro.
insert into public.app_list_options (tenant_id, list_key, label, sort_order)
select t.id, v.lista, v.rotulo, v.ord
from public.tenants t
cross join (values
  ('venda_procedimento', 'Tc Frontal/ Coroa', 10),
  ('venda_procedimento', 'Tc Frontal', 20),
  ('venda_procedimento', 'Tc Frontal/ Coroa/ Barba', 30),
  ('venda_procedimento', 'Tc masculino/ Barba', 40),
  ('venda_procedimento', 'Barba', 50),
  ('venda_procedimento', 'Sobrancelha', 60),
  ('venda_procedimento', 'Sobrancelha + Nanofat', 70),
  ('venda_procedimento', 'TC Feminino', 80),
  ('venda_procedimento', 'TC Feminino + Nanofat', 90),
  ('venda_procedimento', 'TC Feminino + Sobrancelha', 100),

  ('venda_protocolo', 'Protocolo pós TC', 10),
  ('venda_protocolo', 'Protocolo convencional', 20),
  ('venda_protocolo', 'Protocolo inicial 3 sessões', 30),
  ('venda_protocolo', 'Pacote 3 sessões de tratamento', 40),
  ('venda_protocolo', 'Pacote terapia', 50),
  ('venda_protocolo', 'Exossomos', 60),
  ('venda_protocolo', 'Células', 70),
  ('venda_protocolo', 'MMP', 80),
  ('venda_protocolo', 'Mesoject', 90),

  ('venda_tipo_consulta', 'Consulta clínica', 10),
  ('venda_tipo_consulta', 'Retorno 1 mês', 20),
  ('venda_tipo_consulta', 'Retorno clínico', 30),
  ('venda_tipo_consulta', 'Consulta TC', 40),

  ('venda_forma_pagamento', 'Dinheiro', 10),
  ('venda_forma_pagamento', 'Pix', 20),
  ('venda_forma_pagamento', 'Cartão de crédito', 30),
  ('venda_forma_pagamento', 'Cartão de débito', 40),
  ('venda_forma_pagamento', 'Boleto', 50),
  ('venda_forma_pagamento', 'Transferência', 60),
  ('venda_forma_pagamento', 'Misto', 70),

  ('venda_origem', 'Indicação de paciente ou conhecido', 10),
  ('venda_origem', 'Indicação de outro médico', 20),
  ('venda_origem', 'Já era paciente da casa', 30),
  ('venda_origem', 'Viu anúncio no Instagram ou Facebook', 40),
  ('venda_origem', 'Achou o Instagram sem ser anúncio', 50),
  ('venda_origem', 'Google, site ou busca', 60),
  ('venda_origem', 'Outro', 70),
  ('venda_origem', 'Não perguntei', 80),

  ('venda_motivo_cancelamento', 'Financeiro / forma de pagamento', 10),
  ('venda_motivo_cancelamento', 'Remarcou / vai reagendar', 20),
  ('venda_motivo_cancelamento', 'Medo / insegurança', 30),
  ('venda_motivo_cancelamento', 'Motivo de saúde', 40),
  ('venda_motivo_cancelamento', 'Problema de agenda', 50),
  ('venda_motivo_cancelamento', 'Fez em outra clínica', 60),
  ('venda_motivo_cancelamento', 'Desistiu do tratamento', 70),

  ('lead_motivo_perda', 'Preço / Orçamento alto', 10),
  ('lead_motivo_perda', 'Distância / Localização', 20),
  ('lead_motivo_perda', 'Indecisão do paciente', 30),
  ('lead_motivo_perda', 'Fez em outra clínica', 40),
  ('lead_motivo_perda', 'Falta de agenda / horário', 50),
  ('lead_motivo_perda', 'Apenas curiosidade', 60),
  ('lead_motivo_perda', 'Não respondeu o follow-up', 70),
  ('lead_motivo_perda', 'Sem orçamento', 80),
  ('lead_motivo_perda', 'Sem interesse', 90),
  ('lead_motivo_perda', 'Já fechou em outro lugar', 100),
  ('lead_motivo_perda', 'Conta errada / contato inválido', 110),
  ('lead_motivo_perda', 'Equipe / fornecedor', 120),
  ('lead_motivo_perda', 'Outro', 130),

  ('followup_canal', 'WhatsApp', 10),
  ('followup_canal', 'Ligação', 20),
  ('followup_canal', 'E-mail', 30),
  ('followup_canal', 'Presencial', 40),

  ('followup_resultado', 'Sem resposta', 10),
  ('followup_resultado', 'Vai pensar', 20),
  ('followup_resultado', 'Pediu para chamar depois', 30),
  ('followup_resultado', 'Sem condições agora', 40),
  ('followup_resultado', 'Quer remarcar a consulta', 50),
  ('followup_resultado', 'Fechou', 60),
  ('followup_resultado', 'Não fechou', 70),

  ('atendimento_origem', 'Indicação', 10),
  ('atendimento_origem', 'Já é paciente', 20),
  ('atendimento_origem', 'Instagram', 30),
  ('atendimento_origem', 'Google', 40),
  ('atendimento_origem', 'Facebook', 50),
  ('atendimento_origem', 'Site', 60),

  ('financeiro_motivo_exclusao', 'Não foi compra: proposta comercial', 10),
  ('financeiro_motivo_exclusao', 'Boleto falso ou golpe', 20),
  ('financeiro_motivo_exclusao', 'Nota lançada em duplicidade', 30),
  ('financeiro_motivo_exclusao', 'Outro', 40)
) v(lista, rotulo, ord)
where t.polo_type = 'clinic'
on conflict do nothing;

-- Parte 2: o que já está no dado e nunca esteve no fonte. Mesma lição do centro de custo —
-- ignorar o histórico apagaria escolha que alguém fez à mão.
--
-- O corte é 2 ocorrências. Valor digitado UMA vez é, com mais frequência, erro de digitação do
-- que categoria nova, e lista poluída não se usa. O que ficou de fora não some: a tela mostra
-- como "está no dado, fora da lista" com a contagem, e quem sabe decide se adota ou renomeia.
insert into public.app_list_options (tenant_id, list_key, label, sort_order)
select d.tenant_id, d.lista, d.rotulo, 500
from (
  select s.tenant_id, 'venda_procedimento' as lista, btrim(s.procedure_label) as rotulo, count(*) as n
    from public.clinic_sales s where s.kind = 'cirurgia' and btrim(coalesce(s.procedure_label, '')) <> ''
    group by 1, 2, 3
  union all
  select s.tenant_id, 'venda_protocolo', btrim(s.procedure_label), count(*)
    from public.clinic_sales s where s.kind = 'protocolo' and btrim(coalesce(s.procedure_label, '')) <> ''
    group by 1, 2, 3
  union all
  select s.tenant_id, 'venda_tipo_consulta', btrim(s.consultation_type), count(*)
    from public.clinic_sales s where btrim(coalesce(s.consultation_type, '')) <> '' group by 1, 2, 3
  union all
  select s.tenant_id, 'venda_forma_pagamento', btrim(s.payment_method), count(*)
    from public.clinic_sales s where btrim(coalesce(s.payment_method, '')) <> '' group by 1, 2, 3
  union all
  select s.tenant_id, 'venda_origem', btrim(s.origin), count(*)
    from public.clinic_sales s where btrim(coalesce(s.origin, '')) <> '' group by 1, 2, 3
  union all
  select f.tenant_id, 'followup_canal', btrim(f.channel), count(*)
    from public.lead_followups f where btrim(coalesce(f.channel, '')) <> '' group by 1, 2, 3
  union all
  select f.tenant_id, 'followup_resultado', btrim(f.outcome), count(*)
    from public.lead_followups f where btrim(coalesce(f.outcome, '')) <> '' group by 1, 2, 3
  union all
  select a.tenant_id, 'atendimento_origem', btrim(a.origem), count(*)
    from public.clinic_atendimentos a where btrim(coalesce(a.origem, '')) <> '' group by 1, 2, 3
) d
where d.n >= 2
on conflict do nothing;

-- ───────────────────────────────────────────────── quanto cada opção pesa no dado

/**
 * Quantos registros usam cada texto desta lista — inclusive os que NÃO estão cadastrados.
 *
 * As duas metades importam. A contagem dá peso: apagar "Consulta clínica" com 300 vendas
 * atrás é diferente de apagar uma opção que ninguém escolheu, e a tela precisa avisar. E o
 * valor solto (está no dado, fora da lista) é o que revela a grafia que entrou por importação
 * ou por campo livre antes desta tela existir.
 */
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
  )
  select v, count(*)::bigint
  from alvo
  where v is not null and v <> ''
  group by 1
  order by 2 desc;
$$;

revoke all on function public.crm_opcoes_uso(text) from public, anon;
grant execute on function public.crm_opcoes_uso(text) to authenticated;

-- ───────────────────────────────────────────────── renomear arrasta o histórico

/**
 * Renomeia a opção E todo registro que já usava o nome antigo. Devolve quantos registros foram
 * arrastados.
 *
 * É a razão de esta função existir em vez de um simples UPDATE na tela: o texto está gravado em
 * `clinic_sales`, `leads`, `lead_followups` e `clinic_atendimentos`, e sem a varredura, trocar
 * "Pacote terapia" por "Pacote de terapia" deixaria as vendas antigas num protocolo que não
 * existe mais na lista. No relatório isso vira duas linhas para a mesma coisa, e a mais velha
 * ninguém consegue nem selecionar no filtro.
 */
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
  end if;
  get diagnostics n = row_count;

  -- A opção pode nem estar cadastrada: renomear em massa um valor solto do dado é exatamente
  -- o caso de uso de quem abre esta tela para arrumar grafia importada.
  --
  -- Se o nome novo JÁ existe na lista, isto é MESCLAGEM, não renomeação: a importação trouxe
  -- "CRED 2X", "CRED 3X" e "CRED 10X" para o que a clínica chama de "Cartão de crédito", e
  -- juntar as três é o motivo de alguém abrir esta tela. Renomear bateria no índice único; o
  -- histórico já foi arrastado acima, então a linha antiga só precisa sair.
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

comment on table public.app_list_options is
  'Vocabulário configurável do sistema (procedimento, protocolo, origem, motivo…). O valor é '
  'gravado como TEXTO na tabela de destino; renomear passa por crm_renomear_opcao, que arrasta '
  'o histórico junto.';
