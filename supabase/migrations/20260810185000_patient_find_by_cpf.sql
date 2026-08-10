-- Busca do paciente por CPF para o login do app. Normaliza os dois lados: o CPF
-- no espelho Shosp vem ora com pontuação, ora sem, e o app manda o que o usuário
-- digitou. Só service_role executa (a edge de login) — deixar isso aberto viraria
-- um oráculo de "fulano é paciente desta clínica".
create or replace function public.patient_find_by_cpf(p_cpf text)
returns table (prontuario text, nome text, email text, celular text, lead_id text)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.prontuario, p.nome, p.email,
         coalesce(nullif(regexp_replace(coalesce(p.celular, ''), '\D', '', 'g'), ''),
                  nullif(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g'), '')) as celular,
         p.lead_id
  from public.shosp_patients p
  where regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g') = regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')
    and length(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g')) = 11
  limit 1
$fn$;

revoke all on function public.patient_find_by_cpf(text) from public, anon, authenticated;
grant execute on function public.patient_find_by_cpf(text) to service_role;
