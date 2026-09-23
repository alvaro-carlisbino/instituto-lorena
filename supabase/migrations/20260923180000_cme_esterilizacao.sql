-- CME: esterilização com rastreio do ciclo da autoclave até o paciente (23/09/2026).
--
-- A vigilância deu ~60 dias para a clínica apresentar a identificação das embalagens. RDC 15/2012,
-- art. 85: nome do produto, lote, data da esterilização, data limite de uso, método e responsável
-- pelo preparo. A Édina pediu o nome do colaborador (o login da enfermagem é compartilhado, então
-- o responsável é escolhido, não vem do login) e a autoclave 1 ou 2 (são duas).
--
-- Lote = autoclave + número do ciclo (AC1-0457). Cada pacote ganha um código EAN-13 interno com
-- prefixo 29 (o estoque usa 20): o mesmo leitor bipa, e na montagem do kit o pacote fica ligado ao
-- paciente. Ciclo reprovado responde na hora "quais pacotes e quais pacientes".

create table public.cme_autoclaves (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  nome text not null,
  codigo text not null,
  metodo text not null default 'Vapor saturado sob pressão',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, codigo)
);

create table public.cme_colaboradores (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  nome text not null check (length(btrim(nome)) >= 2),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index cme_colaboradores_nome_uq on public.cme_colaboradores (tenant_id, lower(btrim(nome)));

create table public.cme_materiais (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  nome text not null check (length(btrim(nome)) >= 2),
  embalagem text,
  validade_dias integer not null default 30 check (validade_dias between 1 and 3650),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cme_materiais_nome_uq on public.cme_materiais (tenant_id, lower(btrim(nome)));

create table public.cme_ciclos (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  autoclave_id uuid not null references public.cme_autoclaves (id) on delete restrict,
  numero integer not null check (numero > 0),
  lote text not null,
  metodo text not null,
  iniciado_em timestamptz not null default now(),
  responsavel text not null,
  status text not null default 'aberto' check (status in ('aberto', 'aprovado', 'reprovado')),
  indicador_quimico text,
  indicador_biologico text,
  resultado_por text,
  resultado_em timestamptz,
  observacao text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (tenant_id, autoclave_id, numero)
);

create sequence public.cme_pacote_seq;

create table public.cme_pacotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  ciclo_id uuid not null references public.cme_ciclos (id) on delete restrict,
  material_id uuid references public.cme_materiais (id) on delete set null,
  material_nome text not null,
  embalagem text,
  codigo text not null unique,
  esterilizado_em timestamptz not null,
  validade date not null,
  responsavel text not null,
  kit_id uuid references public.stock_kits (id) on delete set null,
  paciente text,
  usado_em timestamptz,
  descartado_em timestamptz,
  descarte_motivo text,
  created_at timestamptz not null default now()
);
create index cme_pacotes_ciclo_idx on public.cme_pacotes (ciclo_id);
create index cme_pacotes_kit_idx on public.cme_pacotes (kit_id) where kit_id is not null;
create index cme_pacotes_validade_idx on public.cme_pacotes (tenant_id, validade) where usado_em is null and descartado_em is null;

-- RLS: o padrão do estoque, pelo polo ativo.
do $$
declare t text;
begin
  foreach t in array array['cme_autoclaves', 'cme_colaboradores', 'cme_materiais', 'cme_ciclos', 'cme_pacotes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%1$s tenant read" on public.%1$I for select using (tenant_id = (select public.current_tenant_id()))', t);
    execute format('create policy "%1$s tenant insert" on public.%1$I for insert with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format('create policy "%1$s tenant update" on public.%1$I for update using (tenant_id = (select public.current_tenant_id())) with check (tenant_id = (select public.current_tenant_id()))', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.cme_pacote_seq to authenticated;

-- Pacote n → "29" + 10 dígitos + verificador EAN-13.
create or replace function public._cme_codigo(p_seq bigint)
returns text
language sql
immutable
as $$
  with d as (select '29' || lpad(p_seq::text, 10, '0') as doze)
  select d.doze || ((10 - (
    select sum(substr(d.doze, i, 1)::int * case when i % 2 = 1 then 1 else 3 end) from generate_series(1, 12) i
  ) % 10) % 10)::text
  from d
$$;

-- Abre o ciclo e já cria os pacotes (a etiqueta vai no pacote ANTES de entrar na autoclave).
-- p_itens: [{material_id, qtd}]. Número do ciclo vazio = o seguinte ao último daquela autoclave.
create or replace function public.cme_ciclo_abrir(p_autoclave uuid, p_numero integer, p_responsavel text, p_itens jsonb)
returns uuid
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_tenant text := (select public.current_tenant_id());
  v_ac public.cme_autoclaves%rowtype;
  v_numero integer;
  v_ciclo uuid;
  v_agora timestamptz := now();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_item record;
  v_mat public.cme_materiais%rowtype;
  v_n int := 0;
  v_resp text := nullif(btrim(p_responsavel), '');
begin
  if v_tenant is null then raise exception 'Sem polo ativo.'; end if;
  if v_resp is null then raise exception 'Escolha o colaborador responsável pelo preparo.'; end if;
  select * into v_ac from public.cme_autoclaves where id = p_autoclave and tenant_id = v_tenant and ativo;
  if not found then raise exception 'Escolha a autoclave.'; end if;
  v_numero := coalesce(p_numero, (select coalesce(max(numero), 0) + 1 from public.cme_ciclos where tenant_id = v_tenant and autoclave_id = v_ac.id));
  if exists (select 1 from public.cme_ciclos where tenant_id = v_tenant and autoclave_id = v_ac.id and numero = v_numero) then
    raise exception 'O ciclo % da % já foi aberto.', v_numero, v_ac.nome;
  end if;

  insert into public.cme_ciclos (autoclave_id, numero, lote, metodo, iniciado_em, responsavel)
  values (v_ac.id, v_numero, v_ac.codigo || '-' || lpad(v_numero::text, 4, '0'), v_ac.metodo, v_agora, v_resp)
  returning id into v_ciclo;

  for v_item in
    select (e->>'material_id')::uuid as material_id, greatest(0, coalesce((e->>'qtd')::int, 0)) as qtd
      from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) e
     where nullif(e->>'material_id', '') is not null
  loop
    if v_item.qtd > 200 then raise exception 'No máximo 200 pacotes do mesmo material por ciclo.'; end if;
    select * into v_mat from public.cme_materiais where id = v_item.material_id and tenant_id = v_tenant;
    if not found then raise exception 'Material da CME não encontrado.'; end if;
    for i in 1..v_item.qtd loop
      insert into public.cme_pacotes (ciclo_id, material_id, material_nome, embalagem, codigo, esterilizado_em, validade, responsavel)
      values (v_ciclo, v_mat.id, v_mat.nome, v_mat.embalagem, public._cme_codigo(nextval('public.cme_pacote_seq')),
              v_agora, v_hoje + v_mat.validade_dias, v_resp);
      v_n := v_n + 1;
    end loop;
  end loop;
  if v_n = 0 then raise exception 'Inclua ao menos um pacote no ciclo.'; end if;
  return v_ciclo;
end;
$$;

-- Resultado do ciclo: aprovado libera os pacotes, reprovado bloqueia. Só uma vez.
create or replace function public.cme_ciclo_resultado(p_ciclo uuid, p_aprovado boolean, p_quimico text, p_biologico text, p_por text, p_obs text)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
declare v_c public.cme_ciclos%rowtype;
begin
  select * into v_c from public.cme_ciclos where id = p_ciclo and tenant_id = (select public.current_tenant_id()) for update;
  if not found then raise exception 'Ciclo não encontrado.'; end if;
  if v_c.status <> 'aberto' then raise exception 'O resultado deste ciclo já foi registrado (%).', v_c.status; end if;
  if nullif(btrim(p_por), '') is null then raise exception 'Diga quem liberou ou reprovou o ciclo.'; end if;
  if not p_aprovado and nullif(btrim(p_obs), '') is null then raise exception 'Diga o motivo da reprovação.'; end if;
  update public.cme_ciclos
     set status = case when p_aprovado then 'aprovado' else 'reprovado' end,
         indicador_quimico = nullif(btrim(p_quimico), ''),
         indicador_biologico = nullif(btrim(p_biologico), ''),
         resultado_por = btrim(p_por),
         resultado_em = now(),
         observacao = nullif(btrim(p_obs), '')
   where id = p_ciclo;
end;
$$;

-- O que dá para fazer com um pacote agora. 'ok' é o único que entra num kit.
create or replace function public.cme_pacote_consultar(p_codigo text)
returns table(
  id uuid, codigo text, material_nome text, lote text, autoclave text, ciclo_status text,
  esterilizado_em timestamptz, validade date, responsavel text, paciente text, kit_id uuid,
  usado_em timestamptz, situacao text
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select p.id, p.codigo, p.material_nome, c.lote, a.nome, c.status, p.esterilizado_em, p.validade, p.responsavel,
         p.paciente, p.kit_id, p.usado_em,
         case
           when p.descartado_em is not null then 'descartado'
           when p.usado_em is not null then 'usado'
           when c.status = 'reprovado' then 'reprovado'
           when p.validade < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
           when c.status = 'aberto' then 'ciclo_aberto'
           else 'ok'
         end
    from public.cme_pacotes p
    join public.cme_ciclos c on c.id = p.ciclo_id
    join public.cme_autoclaves a on a.id = c.autoclave_id
   where p.tenant_id = (select public.current_tenant_id())
     and p.codigo = btrim(p_codigo)
$$;

-- Liga os pacotes bipados na montagem ao kit (e ao paciente dele). Tudo ou nada.
create or replace function public.cme_pacotes_usar(p_codigos text[], p_kit uuid)
returns integer
language plpgsql
security invoker
set search_path to 'public'
as $$
declare
  v_kit public.stock_kits%rowtype;
  v_cod text;
  v_p record;
  v_n int := 0;
begin
  select * into v_kit from public.stock_kits where id = p_kit and tenant_id = (select public.current_tenant_id());
  if not found then raise exception 'Kit não encontrado.'; end if;
  foreach v_cod in array coalesce(p_codigos, '{}') loop
    select * into v_p from public.cme_pacote_consultar(v_cod);
    if not found then raise exception 'Pacote % não existe na CME.', v_cod; end if;
    if v_p.situacao <> 'ok' then
      raise exception 'O pacote % (%) não pode ser usado: %.', v_cod, v_p.material_nome,
        case v_p.situacao when 'usado' then 'já foi usado' when 'reprovado' then 'o ciclo foi reprovado'
          when 'vencido' then 'está vencido' when 'ciclo_aberto' then 'o ciclo ainda não foi liberado'
          else 'foi descartado' end;
    end if;
    update public.cme_pacotes
       set kit_id = v_kit.id, paciente = v_kit.patient_name, usado_em = now()
     where id = v_p.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Vencido ou aberto sem uso volta para reprocessar: sai da lista de disponíveis.
create or replace function public.cme_pacote_descartar(p_codigo text, p_motivo text)
returns void
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if nullif(btrim(p_motivo), '') is null then raise exception 'Diga o motivo.'; end if;
  update public.cme_pacotes
     set descartado_em = now(), descarte_motivo = btrim(p_motivo)
   where tenant_id = (select public.current_tenant_id()) and codigo = btrim(p_codigo)
     and usado_em is null and descartado_em is null;
  if not found then raise exception 'Pacote não encontrado, já usado ou já retirado.'; end if;
end;
$$;

grant execute on function public._cme_codigo(bigint) to authenticated;
grant execute on function public.cme_ciclo_abrir(uuid, integer, text, jsonb) to authenticated;
grant execute on function public.cme_ciclo_resultado(uuid, boolean, text, text, text, text) to authenticated;
grant execute on function public.cme_pacote_consultar(text) to authenticated;
grant execute on function public.cme_pacotes_usar(text[], uuid) to authenticated;
grant execute on function public.cme_pacote_descartar(text, text) to authenticated;

-- As duas autoclaves da clínica.
insert into public.cme_autoclaves (tenant_id, nome, codigo)
values ('instituto-lorena', 'Autoclave 1', 'AC1'), ('instituto-lorena', 'Autoclave 2', 'AC2')
on conflict do nothing;
