-- Paciente existe antes de virar card de venda.
--
-- A tabela `leads` exige pipeline_id, stage_id e owner_id NOT NULL: não dá para
-- "cadastrar paciente" sem criar card no funil. Importar os ~3.200 que só existem
-- no Shosp ou no HairMetrix encheria o kanban comercial de gente que fez cirurgia
-- em 2023 e não está em negociação nenhuma.
--
-- Então a busca passa a enxergar TRÊS tipos de identidade, e a ficha abre por
-- qualquer uma delas:
--   lead    card do CRM (tem funil, conversa, tarefa)
--   shosp   cadastro do Shosp com CPF e telefone, sem card
--   mirror  pasta do HairMetrix, só nome
--
-- Efeito colateral bom: a agregação passa a casar também por PRONTUÁRIO, não só
-- por lead_id. Consulta e cirurgia que tinham prontuário e lead_id nulo estavam
-- invisíveis na ficha mesmo para paciente que TEM card.


-- ---------------------------------------------------------------------------
-- Resolvedor de identidade
-- ---------------------------------------------------------------------------
-- Dado (tipo, ref), descobre todos os identificadores daquela pessoa. É aqui que
-- as três origens viram uma pessoa só.

create or replace function public.crm_identidade(p_tipo text, p_ref text)
returns table(lead_id text, prontuario text, mirror_ids uuid[], nome text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with base as (
    select
      case p_tipo
        when 'lead'   then p_ref
        when 'shosp'  then (select sp.lead_id from public.shosp_patients sp where sp.prontuario = p_ref)
        when 'mirror' then (select hp.lead_id from public.hairmetrix_pacientes hp where hp.id = p_ref::uuid)
      end as lid,
      case p_tipo
        when 'shosp' then p_ref
        when 'lead'  then (select l.shosp_prontuario from public.leads l where l.id = p_ref)
      end as pront0,
      case p_tipo
        when 'mirror' then (select hp.nome_pasta from public.hairmetrix_pacientes hp where hp.id = p_ref::uuid)
        when 'shosp'  then (select sp.nome from public.shosp_patients sp where sp.prontuario = p_ref)
        when 'lead'   then (select l.patient_name from public.leads l where l.id = p_ref)
      end as nome0
  ),
  completo as (
    select
      b.lid,
      coalesce(
        b.pront0,
        (select sp.prontuario from public.shosp_patients sp where sp.lead_id = b.lid limit 1),
        (select l.shosp_prontuario from public.leads l where l.id = b.lid)
      ) as pront,
      b.nome0
    from base b
  )
  select
    c.lid,
    c.pront,
    coalesce((
      select array_agg(hp.id)
      from public.hairmetrix_pacientes hp
      where hp.tenant_id = public.current_tenant_id()
        and (
          (c.lid is not null and hp.lead_id = c.lid)
          or (p_tipo = 'mirror' and hp.id = p_ref::uuid)
        )
    ), '{}'::uuid[]),
    c.nome0
  from completo c;
$function$;

revoke all on function public.crm_identidade(text, text) from public;
grant execute on function public.crm_identidade(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 360 por qualquer identidade
-- ---------------------------------------------------------------------------
-- Substitui o crm_paciente_360(lead_id), que continua existindo como atalho.

create or replace function public.crm_paciente_360_ref(p_tipo text, p_ref text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ident as (select * from public.crm_identidade(p_tipo, p_ref) limit 1)
  select case when not exists (select 1 from ident) then null::jsonb else jsonb_build_object(

    'paciente', (
      select jsonb_build_object(
        'tipo', p_tipo,
        'ref', p_ref,
        'lead_id', i.lead_id,
        'nome', coalesce(
          (select l.patient_name from public.leads l where l.id = i.lead_id),
          (select sp.nome from public.shosp_patients sp where sp.prontuario = i.prontuario),
          i.nome),
        'telefone', coalesce(
          (select l.phone from public.leads l where l.id = i.lead_id),
          (select coalesce(sp.celular, sp.telefone) from public.shosp_patients sp where sp.prontuario = i.prontuario)),
        'prontuario', i.prontuario,
        'cpf', (select sp.cpf from public.shosp_patients sp where sp.prontuario = i.prontuario),
        'email', (select sp.email from public.shosp_patients sp where sp.prontuario = i.prontuario),
        'tem_card', i.lead_id is not null,
        'criado_em', (select l.created_at from public.leads l where l.id = i.lead_id),
        'ultimo_contato', (select l.last_interaction_at from public.leads l where l.id = i.lead_id)
      ) from ident i
    ),

    -- casa por lead_id OU prontuário: consulta com prontuário e lead nulo existia
    -- e não aparecia em ficha nenhuma
    'consultas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'codigo', a.codigo_agendamento, 'data', a.data, 'horario', a.horario,
        'servico', a.servico, 'prestador', a.prestador, 'plano', a.plano_saude, 'status', a.status
      ) order by a.data desc)
      from public.shosp_appointments a, ident i
      where (i.lead_id is not null and a.lead_id = i.lead_id)
         or (i.prontuario is not null and a.prontuario = i.prontuario)
    ), '[]'::jsonb),

    'cirurgias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'dia', s.dia, 'status', s.status, 'sala', s.sala,
        'meta', s.meta, 'extraidos', s.total_extraidos, 'implantados', s.total_implantados
      ) order by s.dia desc)
      from public.srg_surgeries s, ident i
      where s.tenant_id = public.current_tenant_id() and s.deleted_at is null
        and ((i.lead_id is not null and s.lead_id = i.lead_id)
          or (i.prontuario is not null and s.shosp_prontuario = i.prontuario))
    ), '[]'::jsonb),

    'tricoscopia', coalesce((
      select jsonb_agg(jsonb_build_object(
        'regiao', u.regiao, 'capturado_em', u.capturado_em,
        'densidade_fios_cm2', u.densidade_fios_cm2, 'espessura_media_um', u.espessura_media_um,
        'pct_fios_finos', u.pct_fios_finos, 'fios_por_uf', u.fios_por_uf,
        'exames_na_regiao', u.exames_na_regiao, 'imagem_path', u.imagem_path
      ) order by u.regiao)
      from (
        select distinct on (m.regiao)
          m.regiao, e.capturado_em, m.densidade_fios_cm2, m.espessura_media_um,
          m.pct_fios_finos, m.fios_por_uf,
          count(*) over (partition by m.regiao)::integer as exames_na_regiao,
          (select im.storage_path from public.hairmetrix_imagens im
            where im.exame_id = e.id and im.indice = m.indice) as imagem_path
        from public.hairmetrix_medidas m
        join public.hairmetrix_exames e on e.id = m.exame_id, ident i
        where e.paciente_id = any(i.mirror_ids)
        order by m.regiao, e.capturado_em desc
      ) u
    ), '[]'::jsonb),

    'vendas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id, 'tipo', cs.kind, 'procedimento', cs.procedure_label,
        'vendido_em', cs.sold_at, 'valor_centavos', cs.value_cents,
        'entrada_centavos', cs.deposit_cents, 'forma', cs.payment_method,
        'parcelas', cs.installments, 'status', cs.status, 'medico', cs.performing_doctor
      ) order by cs.sold_at desc)
      from public.clinic_sales cs, ident i
      where cs.tenant_id = public.current_tenant_id()
        and ((i.lead_id is not null and cs.lead_id = i.lead_id)
          or (i.prontuario is not null and cs.shosp_prontuario = i.prontuario))
    ), '[]'::jsonb),

    'pagamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id, 'valor_centavos', rp.amount_cents, 'metodo', rp.method,
        'status', rp.status, 'pago_em', rp.paid_at, 'criado_em', rp.created_at,
        'descricao', rp.description
      ) order by rp.created_at desc)
      from public.rede_payments rp, ident i
      where rp.tenant_id = public.current_tenant_id()
        and i.lead_id is not null and rp.lead_id = i.lead_id
    ), '[]'::jsonb),

    'tarefas_abertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'titulo', t.title, 'vence_em', t.due_at, 'tipo', t.task_type
      ) order by t.due_at nulls last)
      from public.lead_tasks t, ident i
      where i.lead_id is not null and t.lead_id = i.lead_id and t.status <> 'done'
    ), '[]'::jsonb),

    'resumo', (
      select jsonb_build_object(
        'consultas', (select count(*) from public.shosp_appointments a
                       where (i.lead_id is not null and a.lead_id = i.lead_id)
                          or (i.prontuario is not null and a.prontuario = i.prontuario)),
        'cirurgias', (select count(*) from public.srg_surgeries s
                       where s.deleted_at is null
                         and ((i.lead_id is not null and s.lead_id = i.lead_id)
                           or (i.prontuario is not null and s.shosp_prontuario = i.prontuario))),
        'exames_tricoscopia', (select coalesce(count(*), 0) from public.hairmetrix_exames e
                                where e.paciente_id = any(i.mirror_ids)),
        'vendas', (select count(*) from public.clinic_sales cs
                    where cs.status <> 'canceled'
                      and ((i.lead_id is not null and cs.lead_id = i.lead_id)
                        or (i.prontuario is not null and cs.shosp_prontuario = i.prontuario))),
        'faturado_centavos', (select coalesce(sum(cs.value_cents), 0) from public.clinic_sales cs
                               where cs.status <> 'canceled'
                                 and ((i.lead_id is not null and cs.lead_id = i.lead_id)
                                   or (i.prontuario is not null and cs.shosp_prontuario = i.prontuario))),
        'pago_centavos', (select coalesce(sum(rp.amount_cents), 0) from public.rede_payments rp
                           where i.lead_id is not null and rp.lead_id = i.lead_id and rp.status = 'paid'),
        'mensagens', (select count(*) from public.interactions x
                       where i.lead_id is not null and x.lead_id = i.lead_id),
        'nps_enviados', (select count(*) from public.survey_dispatches sd
                          where i.lead_id is not null and sd.lead_id = i.lead_id),
        'primeira_consulta', (select min(a.data) from public.shosp_appointments a
                               where (i.lead_id is not null and a.lead_id = i.lead_id)
                                  or (i.prontuario is not null and a.prontuario = i.prontuario)),
        'ultima_consulta', (select max(a.data) from public.shosp_appointments a
                             where (i.lead_id is not null and a.lead_id = i.lead_id)
                                or (i.prontuario is not null and a.prontuario = i.prontuario))
      ) from ident i
    )
  ) end;
$function$;

comment on function public.crm_paciente_360_ref(text, text) is
  'Retrato do paciente por lead, prontuário do Shosp ou pasta do Mirror. Agrega por lead_id E por prontuário.';

revoke all on function public.crm_paciente_360_ref(text, text) from public;
grant execute on function public.crm_paciente_360_ref(text, text) to authenticated;

-- atalho antigo passa a delegar, para as duas nunca divergirem
create or replace function public.crm_paciente_360(p_lead_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.crm_paciente_360_ref('lead', p_lead_id);
$function$;


-- ---------------------------------------------------------------------------
-- Busca que enxerga quem não tem card
-- ---------------------------------------------------------------------------

create or replace function public.crm_buscar_pacientes(
  p_termo text,
  p_limit integer default 20
)
returns table(
  tipo text,
  ref text,
  lead_id text,
  nome text,
  telefone text,
  prontuario text,
  cpf text,
  achado_por text,
  consultas integer,
  cirurgias integer,
  exames integer,
  vendas integer,
  ultimo_contato timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with termo as (
    select public.crm_norm_texto(p_termo) as texto,
           regexp_replace(coalesce(p_termo, ''), '\D', '', 'g') as digitos
  ),

  -- 1) quem tem card
  por_lead as (
    select distinct on (lid) lid, motivo, peso from (
      select l.id as lid, 'nome'::text as motivo, 3 as peso
      from public.leads l, termo t
      where l.tenant_id = public.current_tenant_id() and l.deleted_at is null
        and length(t.texto) >= 2
        and public.crm_norm_texto(l.patient_name) like '%' || t.texto || '%'
      union all
      select l.id, 'telefone', 1
      from public.leads l, termo t
      where l.tenant_id = public.current_tenant_id() and l.deleted_at is null
        and length(t.digitos) >= 4
        and public.crm_fone_final(l.phone) like '%' || right(t.digitos, 8) || '%'
      union all
      select sp.lead_id, 'CPF', 1
      from public.shosp_patients sp, termo t
      where sp.lead_id is not null and length(t.digitos) >= 6
        and regexp_replace(coalesce(sp.cpf, ''), '\D', '', 'g') like '%' || t.digitos || '%'
      union all
      select hp.lead_id, 'tricoscopia', 2
      from public.hairmetrix_pacientes hp, termo t
      where hp.tenant_id = public.current_tenant_id() and hp.lead_id is not null
        and length(t.texto) >= 3 and hp.nome_normalizado like '%' || t.texto || '%'
    ) z where lid is not null order by lid, peso
  ),

  -- 2) paciente do Shosp SEM card: tem CPF e telefone, é gente de verdade
  por_shosp as (
    select sp.prontuario, sp.nome, sp.cpf, coalesce(sp.celular, sp.telefone) as fone,
      case
        when length((select digitos from termo)) >= 6
             and regexp_replace(coalesce(sp.cpf,''), '\D','','g') like '%' || (select digitos from termo) || '%' then 'CPF'
        when length((select digitos from termo)) >= 4
             and public.crm_fone_final(coalesce(sp.celular, sp.telefone)) like '%' || right((select digitos from termo), 8) || '%' then 'telefone'
        when (select digitos from termo) <> '' and sp.prontuario = (select digitos from termo) then 'prontuário'
        else 'nome no Shosp'
      end as motivo
    from public.shosp_patients sp, termo t
    where sp.lead_id is null
      and (
        (length(t.texto) >= 3 and public.crm_norm_texto(sp.nome) like '%' || t.texto || '%')
        or (length(t.digitos) >= 6 and regexp_replace(coalesce(sp.cpf,''), '\D','','g') like '%' || t.digitos || '%')
        or (length(t.digitos) >= 4 and public.crm_fone_final(coalesce(sp.celular, sp.telefone)) like '%' || right(t.digitos, 8) || '%')
        or (t.digitos <> '' and sp.prontuario = t.digitos)
      )
  ),

  -- 3) pasta do HairMetrix sem vínculo: só nome, mas tem exame — não some da busca
  por_mirror as (
    select hp.id, hp.nome_pasta, hp.total_exames
    from public.hairmetrix_pacientes hp, termo t
    where hp.tenant_id = public.current_tenant_id()
      and hp.lead_id is null and hp.total_exames > 0
      and length(t.texto) >= 3
      and hp.nome_normalizado like '%' || t.texto || '%'
  )

  select * from (
    select 'lead'::text, l.id, l.id, l.patient_name, l.phone, l.shosp_prontuario,
      (select sp.cpf from public.shosp_patients sp where sp.lead_id = l.id limit 1),
      m.motivo,
      (select count(*)::integer from public.shosp_appointments a where a.lead_id = l.id),
      (select count(*)::integer from public.srg_surgeries s where s.lead_id = l.id and s.deleted_at is null),
      (select coalesce(sum(hp.total_exames), 0)::integer from public.hairmetrix_pacientes hp where hp.lead_id = l.id),
      (select count(*)::integer from public.clinic_sales cs where cs.lead_id = l.id and cs.status <> 'canceled'),
      l.last_interaction_at,
      m.peso
    from por_lead m
    join public.leads l on l.id = m.lid
    where l.tenant_id = public.current_tenant_id() and l.deleted_at is null

    union all

    select 'shosp', s.prontuario, null, s.nome, s.fone, s.prontuario, s.cpf, s.motivo,
      (select count(*)::integer from public.shosp_appointments a where a.prontuario = s.prontuario),
      (select count(*)::integer from public.srg_surgeries g where g.shosp_prontuario = s.prontuario and g.deleted_at is null),
      0,
      (select count(*)::integer from public.clinic_sales cs where cs.shosp_prontuario = s.prontuario and cs.status <> 'canceled'),
      null::timestamptz,
      case s.motivo when 'nome no Shosp' then 4 else 1 end
    from por_shosp s

    union all

    select 'mirror', h.id::text, null, h.nome_pasta, null, null, null, 'tricoscopia',
      0, 0, h.total_exames, 0, null::timestamptz, 5
    from por_mirror h
  ) r(tipo, ref, lead_id, nome, telefone, prontuario, cpf, achado_por,
      consultas, cirurgias, exames, vendas, ultimo_contato, peso)
  order by r.peso, r.ultimo_contato desc nulls last, r.nome
  limit greatest(coalesce(p_limit, 20), 1);
$function$;

comment on function public.crm_buscar_pacientes(text, integer) is
  'Busca global: card do CRM, cadastro do Shosp sem card e pasta do HairMetrix sem vínculo.';

revoke all on function public.crm_buscar_pacientes(text, integer) from public;
grant execute on function public.crm_buscar_pacientes(text, integer) to authenticated;
