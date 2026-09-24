-- Preço de custo na folha e na conta do kit (reclamação da clínica, 24/09/2026).
--
-- 1) A NF 33864 entrou com caixas lançadas como 1 unidade, pelo preço da caixa: FENTANILA C/50 a
--    R$ 98,50 "a ampola", DEXAMETASONA C/100 a R$ 97,00, ONDANSETRONA C/50, METOPROLOL C/10 (o XML
--    diz uCom CX/AMP com "C/50" no nome). A NF 34196 do fentanil foi corrigida à mão em 15/09
--    (50 × R$ 1,97), mas no MESMO lote, e o lote continuou saindo a R$ 98,50.
-- 2) Por quê: stock_batch_costs pegava "a última entrada com custo" do lote, e a devolução de sobra
--    do kit é uma entrada que copia o custo da saída. Cada devolução regravava o preço errado no
--    lote, que nunca se corrigia. Agora só entrada de compra define o custo do lote.
-- 3) Os lotes de caixa têm o custo dividido pelo tamanho da caixa em todo movimento (compra e kits)
--    que carregou o preço cheio. Quantidade não muda: a contagem de 14/09 já acertou os saldos.
--    Cada correção fica registrada em stock_custo_correcoes.

create table if not exists public.stock_custo_correcoes (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  movimento_id uuid not null,
  item text not null,
  lote text,
  de_cents integer not null,
  para_cents integer not null,
  motivo text not null,
  corrigido_em timestamptz not null default now()
);
alter table public.stock_custo_correcoes enable row level security;
create policy "stock_custo_correcoes tenant read" on public.stock_custo_correcoes
  for select using (tenant_id = (select public.current_tenant_id()));
grant select on public.stock_custo_correcoes to authenticated;

create or replace view public.stock_batch_costs with (security_invoker = on) as
  select distinct on (tenant_id, batch_id) tenant_id, batch_id, unit_cost_cents
    from public.stock_movements m
   where batch_id is not null
     and kind = 'entrada'
     and unit_cost_cents is not null
     and unit_cost_cents > 0
     and coalesce(ref_type, '') not in ('stock_kit', 'stock_transfer', 'estorno', 'juncao')
   order by tenant_id, batch_id, created_at desc;

do $$
declare
  v record;
  v_mov record;
  v_n int;
begin
  -- lote, trecho do nome do item, tamanho da caixa, custo mínimo que denuncia o preço de caixa,
  -- de onde saiu o tamanho da caixa.
  for v in
    select * from (values
      ('2602148',  'FENTANIL',      50,  5000, 'NF 33864: FENTANILA 50MCG/ML 2ML C/50, uCom AMP qCom 1 = caixa'),
      ('DE25J018', 'DEXAMETASONA',  100, 5000, 'NF 33864: DEXAMETASONA 2MG/1ML CX.C/100, uCom CX qCom 1'),
      ('50034800', 'ONDASETRONA',   50,  5000, 'NF 33864: ONDANSETRONA 8MG 4ML C/50 AMP, uCom CX'),
      ('50038996', 'METROPOLOL',    10,  15000, 'NF 33864: METOPROLOL 5MG C/10AP, uCom CX qCom 1'),
      ('010987',   'CEFUROXIMA',    50,  30000, 'Caixa de 50 (compras de 50 un a R$ 7,19-7,40); lote lançado a R$ 352-391 a unidade'),
      ('010956',   'CEFUROXIMA',    50,  30000, 'Caixa de 50 (compras de 50 un a R$ 7,19-7,40); lote lançado a R$ 352-391 a unidade')
    ) as t(lote, item, caixa, minimo, motivo)
  loop
    v_n := 0;
    for v_mov in
      select m.id, m.tenant_id, m.unit_cost_cents, i.name
        from public.stock_movements m
        join public.stock_batches b on b.id = m.batch_id
        join public.stock_items i on i.id = b.item_id
       where b.lot_code = v.lote
         and i.name ilike '%' || v.item || '%'
         and m.unit_cost_cents >= v.minimo
    loop
      insert into public.stock_custo_correcoes (tenant_id, movimento_id, item, lote, de_cents, para_cents, motivo)
      values (v_mov.tenant_id, v_mov.id, v_mov.name, v.lote, v_mov.unit_cost_cents,
              round(v_mov.unit_cost_cents::numeric / v.caixa)::int, v.motivo);
      update public.stock_movements
         set unit_cost_cents = round(v_mov.unit_cost_cents::numeric / v.caixa)::int
       where id = v_mov.id;
      v_n := v_n + 1;
    end loop;
    raise notice 'lote % (%): % movimentos corrigidos', v.lote, v.item, v_n;
  end loop;
end $$;
