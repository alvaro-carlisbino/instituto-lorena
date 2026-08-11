-- srg_match_patients(false) varria TODAS as cirurgias e reescrevia match_status pelo
-- resultado do casamento por nome. Quem já tinha vínculo explícito (feito na mão em
-- /cirurgias-vinculo, ou recuperado pelo nome da venda na migration anterior) voltava
-- para 'sem_match' calado, e o trabalho humano se perdia na próxima rodada.
--
-- Vínculo explícito é decisão de gente. Casamento automático não desfaz decisão de gente.
--
-- Junto: derruba o srg_norm_nome() que a migration 000300 chegou a criar. srg_norm_name()
-- já fazia o mesmo, e duas regras para normalizar nome é como o sistema passa a casar
-- paciente de um jeito numa tela e de outro na seguinte.

drop function if exists public.srg_norm_nome(text);

create or replace function public.srg_match_patients(p_only_pending boolean default true)
returns table(matched integer, ambiguous integer, unmatched integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_matched int := 0; v_amb int := 0; v_unm int := 0;
begin
  with pac as materialized (
    select public.srg_norm_name(p.nome) as nm, p.prontuario, p.lead_id
    from public.shosp_patients p
    where p.nome is not null
  ),
  agg as materialized (
    select nm, count(*)::int as n, min(prontuario) as pront, min(lead_id) as lead_id
    from pac
    where nm is not null
    group by nm
  ),
  alvo as materialized (
    select s.id, public.srg_norm_name(s.paciente_nome) as nm
    from public.srg_surgeries s
    where s.deleted_at is null
      and (not p_only_pending or s.match_status = 'pendente')
      -- a trava nova: automatico nao mexe em vinculo explicito
      and s.match_status not in ('manual', 'venda_nome', 'ignorado')
      and s.paciente_nome is not null
  ),
  upd as (
    update public.srg_surgeries s
       set shosp_prontuario = case when g.n = 1 then g.pront    else s.shosp_prontuario end,
           lead_id          = case when g.n = 1 then g.lead_id  else s.lead_id end,
           match_status     = case when g.n = 1 then 'auto'
                                   when g.n > 1 then 'pendente'
                                   else 'sem_match' end,
           match_score      = case when g.n = 1 then 1.0 else null end,
           matched_at       = case when g.n = 1 then now() else s.matched_at end
      from alvo a
      left join agg g on g.nm = a.nm
     where s.id = a.id
    returning coalesce(g.n, 0) as n
  )
  select count(*) filter (where n = 1)::int,
         count(*) filter (where n > 1)::int,
         count(*) filter (where n = 0)::int
    into v_matched, v_amb, v_unm
  from upd;

  -- Prontuario embutido no nome ("5480 - fulano") e vinculo explicito e ganha de qualquer
  -- casamento por nome. So nao passa por cima do que um humano fixou na mao.
  update public.srg_surgeries s
     set paciente_prontuario = m.pront,
         shosp_prontuario    = m.pront,
         lead_id             = coalesce(
                                 (select sp.lead_id from public.shosp_patients sp where sp.prontuario = m.pront),
                                 s.lead_id),
         match_status        = 'auto',
         match_score         = 1.0,
         matched_at          = now()
    from (
      select id, (regexp_match(coalesce(paciente_nome, ''), '^\s*([0-9]+)\s*-\s*'))[1] as pront
      from public.srg_surgeries
      where deleted_at is null
        and paciente_nome ~ '^\s*[0-9]+\s*-\s*'
        and match_status <> 'manual'
    ) m
   where s.id = m.id
     and m.pront is not null
     and exists (select 1 from public.shosp_patients sp where sp.prontuario = m.pront);

  return query select v_matched, v_amb, v_unm;
end $function$;
