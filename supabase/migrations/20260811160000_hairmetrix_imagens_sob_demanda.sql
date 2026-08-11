-- Foto de tricoscopia sem subir 300 GB.
--
-- O pipeline de imagem já existe inteiro e nunca rodou: bucket `hairmetrix`
-- (privado, 3 MB, só JPEG), `action: 'imagem'` na edge function, tabela
-- `hairmetrix_imagens`, e o `enviar-imagens.ps1` que reduz o PNG de 4-8 MB para
-- JPEG de ~250 KB. `hairmetrix_imagens` está com ZERO linhas.
--
-- O motivo de nunca ter rodado é o tamanho do menor modo disponível: "a captura
-- mais recente de cada paciente" ainda são ~18 mil imagens e ~4,5 GB, dias de
-- upload na internet da clínica. Não existe modo "só este paciente".
--
-- É esse o buraco que esta migration fecha. O médico abre o laudo, clica em pedir
-- as fotos, e o agente na máquina da clínica sobe SÓ aquele paciente na próxima
-- rodada: seis regiões do primeiro exame e seis do último, ~12 imagens, ~3 MB.
-- A clínica atende algumas dezenas de pacientes por semana; no ritmo real isso é
-- alguns MB por dia em vez de 250 GB de uma vez.
--
-- Enquanto a foto não chega, a tela não fica vazia: o laudo desenha o campo
-- folicular a partir das medidas (ver src/lib/campoFolicular.ts). O pedido é para
-- quando o médico quer a imagem de verdade daquele paciente.


create table if not exists public.hairmetrix_pedidos_imagem (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default public.current_tenant_id(),
  paciente_id uuid not null references public.hairmetrix_pacientes(id) on delete cascade,
  -- desnormalizado porque o agente varre PASTA, e a pasta é identificada pelo
  -- mirror_patient_id. Sem isto ele teria que consultar o banco para cada pedido.
  mirror_patient_id text not null,

  status text not null default 'pendente'
    check (status in ('pendente', 'atendido', 'cancelado')),
  solicitado_por uuid,
  solicitado_em timestamptz not null default now(),
  atendido_em timestamptz,
  imagens_enviadas integer not null default 0,
  detalhe text
);

-- Um pedido pendente por paciente. Clicar duas vezes no botão não vira duas
-- varreduras da mesma pasta.
create unique index if not exists hairmetrix_pedidos_imagem_uk
  on public.hairmetrix_pedidos_imagem (tenant_id, paciente_id)
  where status = 'pendente';

create index if not exists hairmetrix_pedidos_imagem_fila_idx
  on public.hairmetrix_pedidos_imagem (tenant_id, status, solicitado_em);

alter table public.hairmetrix_pedidos_imagem enable row level security;

drop policy if exists "hairmetrix_pedidos tenant read" on public.hairmetrix_pedidos_imagem;
create policy "hairmetrix_pedidos tenant read" on public.hairmetrix_pedidos_imagem
  for select to authenticated using (tenant_id = public.current_tenant_id());

grant select on public.hairmetrix_pedidos_imagem to authenticated;

comment on table public.hairmetrix_pedidos_imagem is
  'Fila de "sobe as fotos deste paciente". O agente da clínica consome; evita subir as 32 mil capturas.';


-- ---------------------------------------------------------------------------
-- PEDIR
-- ---------------------------------------------------------------------------
-- Insert vai por RPC, não por policy de insert, para o `solicitado_por` sair do
-- auth.uid() e não da vontade do cliente — em prontuário, quem pediu importa.
-- ON CONFLICT DO NOTHING porque o índice parcial já garante um pendente só.

create or replace function public.hairmetrix_pedir_imagens(p_paciente_id uuid)
returns table(pedido_id uuid, ja_existia boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant text := public.current_tenant_id();
  v_mirror text;
  v_id uuid;
begin
  -- qualificar a tabela é obrigatório: as colunas do RETURNS TABLE viram variáveis
  -- e um `select id` solto sai como "column reference is ambiguous"
  select p.mirror_patient_id into v_mirror
  from public.hairmetrix_pacientes p
  where p.id = p_paciente_id and p.tenant_id = v_tenant;

  if v_mirror is null then
    raise exception 'paciente do HairMetrix não encontrado neste polo';
  end if;

  insert into public.hairmetrix_pedidos_imagem
    (tenant_id, paciente_id, mirror_patient_id, solicitado_por)
  values (v_tenant, p_paciente_id, v_mirror, auth.uid())
  on conflict do nothing
  returning public.hairmetrix_pedidos_imagem.id into v_id;

  if v_id is null then
    select ped.id into v_id
    from public.hairmetrix_pedidos_imagem ped
    where ped.paciente_id = p_paciente_id
      and ped.tenant_id = v_tenant
      and ped.status = 'pendente';
    return query select v_id, true;
  else
    return query select v_id, false;
  end if;
end;
$function$;

comment on function public.hairmetrix_pedir_imagens(uuid) is
  'Enfileira o envio das fotos de um paciente. Idempotente: um pendente por paciente.';

revoke all on function public.hairmetrix_pedir_imagens(uuid) from public;
grant execute on function public.hairmetrix_pedir_imagens(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- LER AS IMAGENS DE UM PACIENTE
-- ---------------------------------------------------------------------------
-- Devolve o caminho no bucket; a URL assinada é gerada no cliente, com validade
-- curta. Foto de couro cabeludo é dado de saúde: nunca vira link público, e o
-- caminho sozinho não abre nada sem a assinatura.
--
-- Junta com exame e paciente para a tela saber a data e a região sem uma segunda
-- consulta, e traz o status do pedido para o botão saber o que dizer.

create or replace function public.hairmetrix_imagens_paciente(p_paciente_id uuid)
returns table(
  storage_path text,
  regiao text,
  capturado_em timestamptz,
  capture_id text,
  bytes bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.storage_path, coalesce(i.regiao, m.regiao), e.capturado_em, e.capture_id, i.bytes
  from public.hairmetrix_imagens i
  join public.hairmetrix_exames e    on e.id = i.exame_id
  join public.hairmetrix_pacientes p on p.id = e.paciente_id
  left join public.hairmetrix_medidas m
         on m.exame_id = i.exame_id and m.indice = i.indice
  where p.id = p_paciente_id
    and p.tenant_id = public.current_tenant_id()
    and i.storage_path is not null
  order by e.capturado_em, i.indice;
$function$;

comment on function public.hairmetrix_imagens_paciente(uuid) is
  'Fotos de tricoscopia de um paciente. Devolve o caminho no bucket privado; a URL assinada sai no cliente.';

revoke all on function public.hairmetrix_imagens_paciente(uuid) from public;
grant execute on function public.hairmetrix_imagens_paciente(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- LEITURA DO BUCKET
-- ---------------------------------------------------------------------------
-- Sem policy de select em storage.objects, o `createSignedUrl` do usuário logado
-- falha e a galeria fica eternamente vazia com o banco cheio. Nada de using(true):
-- só o bucket hairmetrix, e só para quem é da equipe.

drop policy if exists "hairmetrix imagens leitura equipe" on storage.objects;
create policy "hairmetrix imagens leitura equipe" on storage.objects
  for select to authenticated
  using (bucket_id = 'hairmetrix' and public.is_staff_user());
