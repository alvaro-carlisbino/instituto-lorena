-- Quem faz a anestesia, na lista da clínica.
--
-- Até aqui o campo "Anestesista" da venda era alimentado por `srg_staff`, o
-- espelho do sistema do centro cirúrgico. Três problemas com isso, os três
-- apareceram em 17/08/2026 quando a lista foi atualizada:
--
--   1. O espelho só tem PESSOA. Duas das quatro opções que a clínica usa são
--      empresa — Grupo Ingá e Clínica Loviderm. O financeiro já sabia disso antes
--      da venda: "GRUPO INGÁ - ANESTESISTAS" é caixa na conciliação do Shosp.
--   2. O espelho é recarregado do MySQL a cada sync (upsert por id). Corrigir um
--      nome aqui dura até o próximo sync e volta sozinho.
--   3. O espelho tem quem não atende mais. "Jéssica Gdla" continua lá como
--      ANESTESISTA e aparecia na lista de escolha.
--
-- Então a lista de escolha passa a ser desta tabela. O espelho continua sendo a
-- verdade do que a SALA registrou (a agenda cirúrgica segue lendo dele); esta é a
-- verdade de para quem a clínica manda a anestesia.
--
-- Divergência conhecida e de propósito: o centro cirúrgico grafa "Thaylla Nilhei"
-- (srg_staff 175) e o nome certo é "Thaylla Nihei". Fica com a grafia certa aqui
-- e o vínculo pelo id, que é o que liga as duas pontas sem depender de nome.

create table if not exists public.anesthesia_providers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     text not null default 'instituto-lorena' references public.tenants (id),
  name          text not null,
  -- Quando a mesma anestesia existe no espelho do centro cirúrgico. Null para
  -- empresa, que o sistema da sala não cadastra. Sem FK: o espelho é recarregado
  -- inteiro a cada sync.
  srg_staff_id  int,
  active        boolean not null default true,
  position      int not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Nome único por polo, sem depender de caixa alta: "Grupo Ingá" e "GRUPO INGÁ"
-- viram dois fornecedores no relatório, e é assim que o total de repasse racha.
create unique index if not exists anesthesia_providers_nome_unq
  on public.anesthesia_providers (tenant_id, lower(name));

drop trigger if exists anesthesia_providers_touch on public.anesthesia_providers;
create trigger anesthesia_providers_touch before update on public.anesthesia_providers
  for each row execute function public.touch_updated_at();

alter table public.anesthesia_providers enable row level security;
drop policy if exists "anesthesia_providers tenant" on public.anesthesia_providers;
create policy "anesthesia_providers tenant" on public.anesthesia_providers
  for all to authenticated using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on table public.anesthesia_providers is
  'Quem a clínica usa para anestesia: pessoa ou empresa. Alimenta o campo da venda; o espelho da sala não manda aqui.';

insert into public.anesthesia_providers (tenant_id, name, srg_staff_id, position) values
  ('instituto-lorena', 'Grupo Ingá',       null, 0),
  ('instituto-lorena', 'Thaylla Nihei',    175,  1),
  ('instituto-lorena', 'Isabela Maeda',    174,  2),
  ('instituto-lorena', 'Clínica Loviderm', null, 3)
on conflict (tenant_id, lower(name)) do update
  set srg_staff_id = excluded.srg_staff_id,
      position = excluded.position,
      active = true;
