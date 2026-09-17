-- Consumo do setor no registro de uso do kit.
--
-- Pedido de 17/09: álcool 70%, caneta de marcação, clorexidina aquosa, toca, propé, luva
-- nitrílica, luva de procedimento e álcool swab também têm de ser contabilizados depois de cada
-- SPA ou cirurgia, na conta do paciente. Não ficam na bandeja (não são bipados na montagem): a
-- equipe lança ao registrar o uso, em unidade de gente ("2 pares", "30 ml"), e o sistema
-- converte para a unidade do estoque (caixa de 100 luvas → par = 0,02 caixa).
--
-- stock_consumo_setor  = a lista configurável (item, unidade de lançamento, fator, padrões)
-- kit_templates.setor  = cirurgia ou SPA, para o registro de uso já vir com o padrão certo
-- stock_kit_items.consumo_setor = a linha entrou pelo consumo do setor (tela e PDF marcam)

create table if not exists public.stock_consumo_setor (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  item_id uuid not null references public.stock_items(id) on delete cascade,
  rotulo text not null,
  unidade text not null default 'un',
  fator numeric not null default 1 check (fator > 0),
  padrao_cirurgia numeric not null default 0 check (padrao_cirurgia >= 0),
  padrao_spa numeric not null default 0 check (padrao_spa >= 0),
  ordem int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, item_id)
);

alter table public.stock_consumo_setor enable row level security;

drop policy if exists "stock_consumo_setor tenant read" on public.stock_consumo_setor;
drop policy if exists "stock_consumo_setor tenant insert" on public.stock_consumo_setor;
drop policy if exists "stock_consumo_setor tenant update" on public.stock_consumo_setor;
drop policy if exists "stock_consumo_setor tenant delete" on public.stock_consumo_setor;
create policy "stock_consumo_setor tenant read" on public.stock_consumo_setor
  for select using (tenant_id = (select public.current_tenant_id()));
create policy "stock_consumo_setor tenant insert" on public.stock_consumo_setor
  for insert with check (tenant_id = (select public.current_tenant_id()));
create policy "stock_consumo_setor tenant update" on public.stock_consumo_setor
  for update using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()));
create policy "stock_consumo_setor tenant delete" on public.stock_consumo_setor
  for delete using (tenant_id = (select public.current_tenant_id()));

revoke all on public.stock_consumo_setor from anon;
grant select, insert, update, delete on public.stock_consumo_setor to authenticated;

alter table public.kit_templates add column if not exists setor text;
do $$ begin
  alter table public.kit_templates add constraint kit_templates_setor_ck check (setor in ('cirurgia', 'spa'));
exception when duplicate_object then null;
end $$;

alter table public.stock_kit_items add column if not exists consumo_setor boolean not null default false;

-- Setor dos modelos que já existem.
update public.kit_templates set setor = 'cirurgia'
 where tenant_id = 'instituto-lorena' and setor is null and name in ('Kit Cirúrgico CC', 'Kit Nanofat', 'Kit Biópsia Ambulatório');
update public.kit_templates set setor = 'spa'
 where tenant_id = 'instituto-lorena' and setor is null
   and name in ('Kit Mesoject', 'Kit MMP', 'Kit Infusão Vitamina', 'Kit Intramuscular Vitamina B12', 'Kit Intramuscular Vitamina D');

-- A lista pedida, com os itens do estoque que existem hoje. Padrões em zero: a quantidade de
-- cada atendimento a equipe define na tela de configuração.
insert into public.stock_consumo_setor (tenant_id, item_id, rotulo, unidade, fator, ordem)
select 'instituto-lorena', si.id, v.rotulo, v.unidade, v.fator, v.ordem
  from (values
    ('ÁLCOOL 70% 1L', 'Álcool 70%', 'ml', 0.001, 1),
    ('CANETA MARCAÇÃO (OVAL)', 'Caneta de marcação', 'un', 1, 2),
    ('CLOREXIDINA AQUOSA 100ML', 'Clorexidina aquosa', 'ml', 0.01, 3),
    ('GORRO', 'Toca', 'un', 1, 4),
    ('PROPE TNT 20G ANADONA PAR (50)', 'Propé', 'par', 1, 5),
    ('LUVA NITRÍLICA M', 'Luva nitrílica', 'par', 0.02, 6),
    ('LUVA PROCEDIMENTO M', 'Luva de procedimento', 'par', 0.02, 7),
    ('ÁLCOOL SWAB', 'Álcool swab', 'un', 1, 8)
  ) as v(nome, rotulo, unidade, fator, ordem)
  join lateral (
    select id from public.stock_items
     where tenant_id = 'instituto-lorena' and active and name = v.nome
     order by created_at limit 1
  ) si on true
on conflict (tenant_id, item_id) do nothing;

-- Registrar uso ganha p_consumo = [{"item_id": "...", "qty": 0.04}] (qty já na unidade do
-- estoque). Cada item vira (ou soma em) uma linha consumo_setor do kit, com baixa por FEFO.
drop function if exists public.stock_kit_registrar_uso(uuid, jsonb, boolean);

create or replace function public.stock_kit_registrar_uso(
  p_kit_id uuid,
  p_linhas jsonb,
  p_fechar boolean default true,
  p_consumo jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_marca record;
  v_consumo record;
  v_linha public.stock_kit_items%rowtype;
  v_devolucoes jsonb := '[]'::jsonb;
  v_a_mais numeric := 0;
  v_desfeito numeric := 0;
  v_consumo_itens int := 0;
begin
  select * into v_kit from public.stock_kits where id = p_kit_id for update;
  if not found then raise exception 'Kit não encontrado.'; end if;
  if v_kit.status = 'cancelado' then raise exception 'Kit cancelado não recebe registro de uso.'; end if;

  for v_marca in
    select (e->>'kit_item_id')::uuid as kit_item_id,
           coalesce((e->>'voltou')::numeric, 0) as voltou,
           coalesce((e->>'desfazer')::numeric, 0) as desfazer,
           coalesce((e->>'a_mais')::numeric, 0) as a_mais
      from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) e
  loop
    if v_marca.voltou < 0 or v_marca.a_mais < 0 or v_marca.desfazer < 0 then raise exception 'Quantidade inválida.'; end if;
    if v_marca.voltou > 0 and (v_marca.a_mais > 0 or v_marca.desfazer > 0) then
      raise exception 'A mesma linha não pode ter devolução e uso a mais.';
    end if;

    if v_marca.a_mais > 0 or v_marca.desfazer > 0 then
      select * into v_linha from public.stock_kit_items
       where id = v_marca.kit_item_id and kit_id = p_kit_id for update;
      if not found then raise exception 'Item % não pertence a este kit.', v_marca.kit_item_id; end if;

      if v_marca.desfazer > 0 then
        if v_marca.desfazer > v_linha.returned_qty then
          raise exception 'Só voltaram % desta linha; não dá para desfazer %.', v_linha.returned_qty, v_marca.desfazer;
        end if;
        perform public._stock_kit_saida(v_kit, v_linha.item_id, v_marca.desfazer, 'devolução desfeita (correção de uso)');
        update public.stock_kit_items set returned_qty = returned_qty - v_marca.desfazer where id = v_linha.id;
        v_desfeito := v_desfeito + v_marca.desfazer;
      end if;

      if v_marca.a_mais > 0 then
        perform public._stock_kit_saida(v_kit, v_linha.item_id, v_marca.a_mais, 'usado a mais na cirurgia');
        update public.stock_kit_items set qty = qty + v_marca.a_mais where id = v_linha.id;
        v_a_mais := v_a_mais + v_marca.a_mais;
      end if;
    elsif v_marca.voltou > 0 then
      v_devolucoes := v_devolucoes || jsonb_build_array(
        jsonb_build_object('kit_item_id', v_marca.kit_item_id, 'qty', v_marca.voltou));
    end if;
  end loop;

  for v_consumo in
    select (e->>'item_id')::uuid as item_id, sum((e->>'qty')::numeric) as qty
      from jsonb_array_elements(coalesce(p_consumo, '[]'::jsonb)) e
     group by 1
  loop
    if v_consumo.qty is null or v_consumo.qty <= 0 then continue; end if;
    select * into v_linha from public.stock_kit_items
     where kit_id = p_kit_id and item_id = v_consumo.item_id and consumo_setor
     order by created_at limit 1 for update;
    if found then
      update public.stock_kit_items set qty = qty + v_consumo.qty where id = v_linha.id;
    else
      insert into public.stock_kit_items (tenant_id, kit_id, item_id, qty, is_extra, consumo_setor)
      values (v_kit.tenant_id, p_kit_id, v_consumo.item_id, v_consumo.qty, false, true);
    end if;
    perform public._stock_kit_saida(v_kit, v_consumo.item_id, v_consumo.qty, 'consumo do setor');
    v_consumo_itens := v_consumo_itens + 1;
  end loop;

  return public.stock_kit_devolver(p_kit_id, v_devolucoes, p_fechar)
      || jsonb_build_object('a_mais', v_a_mais, 'desfeito', v_desfeito, 'consumo_itens', v_consumo_itens);
end;
$$;

revoke all on function public.stock_kit_registrar_uso(uuid, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.stock_kit_registrar_uso(uuid, jsonb, boolean, jsonb) to authenticated, service_role;
