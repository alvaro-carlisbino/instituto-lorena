-- 1) Sugestão de paciente para a tela de conferência do vínculo cirurgia↔paciente.
--    O casamento automático só grava em nome IDÊNTICO normalizado — num app de
--    saúde, chutar por semelhança é mostrar a cirurgia de um paciente para outro.
--    Aqui só SUGERIMOS: quem decide é a pessoa na tela.
create or replace function public.srg_suggest_patients(p_surgery_id int, p_limit int default 8)
returns table (prontuario text, nome text, cpf text, celular text, lead_id text, score numeric)
language sql
stable
security definer
set search_path = public
as $fn$
  with alvo as (
    select public.srg_norm_name(paciente_nome) as nm
    from public.srg_surgeries where id = p_surgery_id
  ),
  toks as (
    select tok from alvo, unnest(string_to_array(alvo.nm, ' ')) tok
    where length(tok) >= 3
  ),
  cand as (
    select p.prontuario, p.nome, p.cpf, p.celular, p.lead_id,
           public.srg_norm_name(p.nome) as pnm
    from public.shosp_patients p
    where p.nome is not null
  )
  select c.prontuario, c.nome, c.cpf, c.celular, c.lead_id,
         round(
           (select count(*) from toks t where c.pnm like '%' || t.tok || '%')::numeric
           / nullif((select count(*) from toks), 0)
         , 2) as score
  from cand c
  where (select count(*) from toks) > 0
    and (select count(*) from toks t where c.pnm like '%' || t.tok || '%') > 0
  order by score desc, length(c.nome)
  limit greatest(1, least(p_limit, 25))
$fn$;

revoke all on function public.srg_suggest_patients(int, int) from public, anon;
grant execute on function public.srg_suggest_patients(int, int) to authenticated;

-- 2) Segredo do cron.
--    Os crons antigos usam current_setting('vault.cron_inbox_secret'), que na prática
--    está VAZIO em prod (ver crm_cron_auth_gotcha) — as funções deles aceitam secret
--    vazio. Aqui não dá: verify_jwt=false + secret vazio = endpoint aberto que qualquer
--    um na internet usa pra martelar o MySQL da clínica.
--    ALTER DATABASE ... SET é negado para o nosso papel, então o segredo vive numa
--    tabela com RLS e ZERO policies: authenticated/anon não leem nada; o dono da
--    tabela (que é quem o pg_cron usa) e o service_role passam por cima do RLS.
create table if not exists public.app_cron_secrets (
  key    text primary key,
  secret text not null
);
alter table public.app_cron_secrets enable row level security;
revoke all on table public.app_cron_secrets from anon, authenticated;

-- O valor real é gravado fora do git (o segredo foi gerado no deploy).
-- insert into public.app_cron_secrets (key, secret) values ('cirurgia', '<gerado>')
--   on conflict (key) do update set secret = excluded.secret;

-- 3) Agendamento: de 2 em 2 horas. O sync é full e idempotente (~14 mil linhas,
--    ~20s), então repetir é seguro; e cirurgia acontece durante o dia, não precisa
--    de minuto a minuto.
create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('crm-cirurgia-sync-job');
exception when others then null;
end$$;

select cron.schedule(
  'crm-cirurgia-sync-job',
  '5 */2 * * *',
  $$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-cirurgia-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'cirurgia'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
