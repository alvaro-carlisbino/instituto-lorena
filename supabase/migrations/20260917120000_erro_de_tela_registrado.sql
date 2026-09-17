-- Erro de TELA registrado (17/set/2026).
--
-- A Aline Muniz abria o CRM e via tela branca. Pelos logs da API o navegador dela carregou
-- todos os dados às 08:53 e parou de chamar qualquer coisa logo em seguida: o React quebrou ao
-- desenhar. Não havia ErrorBoundary nem registro de erro no front, então a única pista possível
-- era pedir um print do console a quem não sabe abrir o console.
--
-- Cada erro que derruba a tela (ou escapa como exceção não tratada) vira uma linha aqui, com a
-- rota e a pilha. Quem escreve é o próprio navegador logado; quem lê é admin (ou service_role).

create table if not exists public.app_client_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  auth_user_id uuid default auth.uid(),
  email text,
  tipo text not null,
  rota text,
  mensagem text,
  pilha text,
  pilha_componente text,
  versao text,
  user_agent text
);

create index if not exists app_client_errors_criado_idx on public.app_client_errors (created_at desc);

alter table public.app_client_errors enable row level security;

drop policy if exists app_client_errors_insere_o_proprio on public.app_client_errors;
create policy app_client_errors_insere_o_proprio on public.app_client_errors
  for insert to authenticated
  with check (auth_user_id is null or auth_user_id = auth.uid());

drop policy if exists app_client_errors_admin_le on public.app_client_errors;
create policy app_client_errors_admin_le on public.app_client_errors
  for select to authenticated
  using ((select public.is_super_admin()));

grant insert on public.app_client_errors to authenticated;
grant select on public.app_client_errors to authenticated;

notify pgrst, 'reload schema';
