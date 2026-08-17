-- Usuário novo entra e enxerga o polo dele, sem passo manual no banco.
--
-- O buraco, achado ao cadastrar a Aline em 14/08/2026: quem cria usuário —
-- a tela /usuarios, o edge `provision-user` e o edge `invite-user` — grava em
-- `app_users` e `app_profiles`, e NUNCA em `tenant_members`. Só que
-- `is_staff_user()` responde exatamente "existe linha em tenant_members para este
-- auth.uid()", e 20 policies de RLS dependem dela.
--
-- Resultado: usuário novo loga, o login funciona, o menu desenha, e as telas vêm
-- vazias. Verde e morto — o pior formato de erro, porque ninguém abre chamado de
-- "está tudo lá, só não tem nada dentro". Os cinco usuários de hoje têm a linha
-- porque alguém a inseriu na mão, uma vez, e ninguém lembrou depois.
--
-- Aqui o vínculo passa a nascer com o usuário: quem tem tenant_id em app_users e
-- já tem login (auth_user_id) ganha a linha em tenant_members sozinho.

create or replace function public.app_users_garante_tenant_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.auth_user_id is null or new.tenant_id is null then
    return new;
  end if;

  insert into public.tenant_members (tenant_id, auth_user_id)
  values (new.tenant_id, new.auth_user_id)
  on conflict do nothing;

  -- O polo ativo (active_tenant_id) também precisa de vínculo, senão
  -- current_tenant_id() ignora a escolha e cai no tenant_id de origem — o
  -- switcher de polo pareceria não funcionar.
  if new.active_tenant_id is not null and new.active_tenant_id <> new.tenant_id then
    insert into public.tenant_members (tenant_id, auth_user_id)
    values (new.active_tenant_id, new.auth_user_id)
    on conflict do nothing;
  end if;

  return new;
end $$;

drop trigger if exists app_users_vincula_polo on public.app_users;
create trigger app_users_vincula_polo
  after insert or update of auth_user_id, tenant_id, active_tenant_id on public.app_users
  for each row execute function public.app_users_garante_tenant_member();

comment on function public.app_users_garante_tenant_member() is
  'Cria o vínculo em tenant_members quando o usuário ganha login. Sem ele, is_staff_user() é falso e 20 policies devolvem tela vazia.';

-- Retroativo: quem já existe e ficou sem vínculo passa a ter.
insert into public.tenant_members (tenant_id, auth_user_id)
select u.tenant_id, u.auth_user_id
from public.app_users u
where u.auth_user_id is not null and u.tenant_id is not null
on conflict do nothing;
