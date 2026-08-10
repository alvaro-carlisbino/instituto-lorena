-- Busca global de paciente e retrato 360 — o que faltava para o sistema ser um só.
--
-- DIAGNÓSTICO. O ⌘K procurava TELA, não gente ("Buscar tela ou ação…"). E a ficha do
-- paciente tinha 4 abas que só liam conversa e WhatsApp. Enquanto isso, no banco:
--   3.405 consultas do Shosp        175 cirurgias
--   3.160 exames de tricoscopia     418 vendas da clínica
--   175 pagamentos                  779 disparos de NPS
-- Tudo com lead_id, tudo invisível na ficha. Cada coisa na sua tela, sem caminho de
-- volta para a pessoa. O dado existia e não convergia em lugar nenhum.
--
-- Duas funções resolvem isso:
--   crm_buscar_pacientes  acha a pessoa por qualquer identificador que alguém tenha na mão
--   crm_paciente_360      devolve a vida inteira dela em UM roundtrip
--
-- POR QUE UM JSONB SÓ, e não 8 queries do front: a ficha abria com 4 chamadas e ia
-- para 12. Em conexão de recepção isso é meio segundo de tela pulando. Uma ida ao
-- banco monta tudo, e o que não existe volta como lista vazia em vez de erro.


-- ---------------------------------------------------------------------------
-- Normalizadores
-- ---------------------------------------------------------------------------
-- Fonte única. hairmetrix_normalizar passa a chamar esta, senão em duas semanas as
-- duas divergem e o mesmo nome casa num lugar e não casa no outro.

create or replace function public.crm_norm_texto(p_texto text)
returns text
language sql
immutable
as $function$
  select trim(regexp_replace(
    regexp_replace(
      lower(translate(
        coalesce(p_texto, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )),
      '[^a-z0-9 ]', ' ', 'g'),
    '\s+', ' ', 'g'));
$function$;

create or replace function public.hairmetrix_normalizar(p_texto text)
returns text
language sql
immutable
as $function$
  select public.crm_norm_texto(p_texto);
$function$;

/**
 * Telefone brasileiro é um pesadelo de comparação: com e sem o 9, com e sem +55,
 * com e sem parênteses. Comparar pelos ÚLTIMOS 8 DÍGITOS resolve todos esses casos
 * de uma vez, porque o que varia é sempre o prefixo. Ver brPhoneVariants no crm.ts.
 */
create or replace function public.crm_fone_final(p_fone text)
returns text
language sql
immutable
as $function$
  select right(regexp_replace(coalesce(p_fone, ''), '\D', '', 'g'), 8);
$function$;

comment on function public.crm_norm_texto(text) is
  'Normaliza texto para busca: minúsculo, sem acento, só letra/número.';
comment on function public.crm_fone_final(text) is
  'Últimos 8 dígitos do telefone. Imune ao nono dígito, DDI e formatação.';


-- ---------------------------------------------------------------------------
-- BUSCA GLOBAL
-- ---------------------------------------------------------------------------
-- Acha a pessoa por nome, telefone, CPF, prontuário do Shosp ou id do HairMetrix.
-- Devolve `achado_por` de propósito: quem busca "8899" precisa saber que aquilo
-- apareceu por telefone e não por CPF, senão o resultado parece mágica. Foi isso que
-- ele chamou de rastreável.
--
-- Junto vêm os contadores do que existe da pessoa, então a lista já mostra quem tem
-- cirurgia, quem tem exame e quem é só um lead sem histórico — sem abrir uma a uma.

create or replace function public.crm_buscar_pacientes(
  p_termo text,
  p_limit integer default 20
)
returns table(
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
    select
      public.crm_norm_texto(p_termo)                       as texto,
      regexp_replace(coalesce(p_termo, ''), '\D', '', 'g')  as digitos
  ),
  -- cada fonte vira (lead_id, motivo, peso). Peso menor = casamento mais forte:
  -- CPF e prontuário são identificadores únicos, nome é o mais frouxo.
  achados as (
    select l.id as lid, 'nome'::text as motivo, 3 as peso
    from public.leads l, termo t
    where l.tenant_id = public.current_tenant_id()
      and l.deleted_at is null
      and length(t.texto) >= 2
      and public.crm_norm_texto(l.patient_name) like '%' || t.texto || '%'

    union all
    select l.id, 'telefone', 1
    from public.leads l, termo t
    where l.tenant_id = public.current_tenant_id()
      and l.deleted_at is null
      and length(t.digitos) >= 4
      and public.crm_fone_final(l.phone) like '%' || right(t.digitos, 8) || '%'

    union all
    select l.id, 'prontuário', 1
    from public.leads l, termo t
    where l.tenant_id = public.current_tenant_id()
      and l.deleted_at is null
      and length(t.digitos) >= 3
      and l.shosp_prontuario = t.digitos

    union all
    select sp.lead_id, 'CPF', 1
    from public.shosp_patients sp, termo t
    where sp.lead_id is not null
      and length(t.digitos) >= 6
      and regexp_replace(coalesce(sp.cpf, ''), '\D', '', 'g') like '%' || t.digitos || '%'

    union all
    select sp.lead_id, 'nome no Shosp', 4
    from public.shosp_patients sp, termo t
    where sp.lead_id is not null
      and length(t.texto) >= 3
      and public.crm_norm_texto(sp.nome) like '%' || t.texto || '%'

    union all
    select hp.lead_id, 'tricoscopia', 2
    from public.hairmetrix_pacientes hp, termo t
    where hp.tenant_id = public.current_tenant_id()
      and hp.lead_id is not null
      and length(t.texto) >= 3
      and hp.nome_normalizado like '%' || t.texto || '%'

    union all
    select s.lead_id, 'cirurgia', 2
    from public.srg_surgeries s, termo t
    where s.tenant_id = public.current_tenant_id()
      and s.lead_id is not null
      and s.deleted_at is null
      and length(t.texto) >= 3
      and public.crm_norm_texto(s.paciente_nome) like '%' || t.texto || '%'
  ),
  -- mesma pessoa pode bater por vários caminhos; fica o casamento mais forte
  melhor as (
    select distinct on (lid) lid, motivo, peso
    from achados
    where lid is not null
    order by lid, peso
  )
  select
    l.id,
    l.patient_name,
    l.phone,
    l.shosp_prontuario,
    (select sp.cpf from public.shosp_patients sp where sp.lead_id = l.id limit 1),
    m.motivo,
    (select count(*)::integer from public.shosp_appointments a where a.lead_id = l.id),
    (select count(*)::integer from public.srg_surgeries s
      where s.lead_id = l.id and s.deleted_at is null),
    (select coalesce(sum(hp.total_exames), 0)::integer from public.hairmetrix_pacientes hp
      where hp.lead_id = l.id),
    (select count(*)::integer from public.clinic_sales cs
      where cs.lead_id = l.id and cs.status <> 'canceled'),
    l.last_interaction_at
  from melhor m
  join public.leads l on l.id = m.lid
  where l.tenant_id = public.current_tenant_id()
    and l.deleted_at is null
  order by m.peso, l.last_interaction_at desc nulls last
  limit greatest(coalesce(p_limit, 20), 1);
$function$;

comment on function public.crm_buscar_pacientes(text, integer) is
  'Busca global de paciente por nome, telefone, CPF, prontuário ou tricoscopia. Devolve por que casou.';

revoke all on function public.crm_buscar_pacientes(text, integer) from public;
grant execute on function public.crm_buscar_pacientes(text, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- PACIENTE 360
-- ---------------------------------------------------------------------------
-- Tudo da pessoa num jsonb. Cada item carrega o id da origem para a tela conseguir
-- linkar de volta: da consulta para a agenda, da cirurgia para o centro cirúrgico,
-- do exame para a tricoscopia. É o "interligado" — o caminho existe nos dois sentidos.

create or replace function public.crm_paciente_360(p_lead_id text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with l as (
    select * from public.leads
    where id = p_lead_id and tenant_id = public.current_tenant_id() and deleted_at is null
  ),
  sp as (
    select * from public.shosp_patients where lead_id = p_lead_id limit 1
  )
  select case when not exists (select 1 from l) then null::jsonb else jsonb_build_object(

    'paciente', (
      select jsonb_build_object(
        'lead_id', l.id,
        'nome', l.patient_name,
        'telefone', l.phone,
        'prontuario', l.shosp_prontuario,
        'cpf', (select sp.cpf from sp),
        'email', (select sp.email from sp),
        'origem', l.source,
        'canal_atribuicao', l.attribution_channel,
        'campanha', l.attribution_campaign,
        'temperatura', l.temperature,
        'criado_em', l.created_at,
        'ultimo_contato', l.last_interaction_at,
        'status_conversa', l.conversation_status
      ) from l
    ),

    'consultas', coalesce((
      select jsonb_agg(x order by x->>'data' desc) from (
        select jsonb_build_object(
          'codigo', a.codigo_agendamento,
          'data', a.data,
          'horario', a.horario,
          'servico', a.servico,
          'prestador', a.prestador,
          'plano', a.plano_saude,
          'status', a.status
        ) as x
        from public.shosp_appointments a
        where a.lead_id = p_lead_id
        order by a.data desc
        limit 50
      ) s
    ), '[]'::jsonb),

    'cirurgias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'dia', s.dia,
        'status', s.status,
        'sala', s.sala,
        'meta', s.meta,
        'extraidos', s.total_extraidos,
        'implantados', s.total_implantados
      ) order by s.dia desc)
      from public.srg_surgeries s
      where s.lead_id = p_lead_id and s.tenant_id = public.current_tenant_id() and s.deleted_at is null
    ), '[]'::jsonb),

    -- Última medida de CADA região. Somar regiões não significa nada: occipital é
    -- área doadora e não rala, vertex é onde a calvície avança.
    'tricoscopia', coalesce((
      select jsonb_agg(jsonb_build_object(
        'regiao', u.regiao,
        'capturado_em', u.capturado_em,
        'densidade_fios_cm2', u.densidade_fios_cm2,
        'espessura_media_um', u.espessura_media_um,
        'pct_fios_finos', u.pct_fios_finos,
        'fios_por_uf', u.fios_por_uf,
        'exames_na_regiao', u.exames_na_regiao
      ) order by u.regiao)
      from (
        select distinct on (m.regiao)
          m.regiao, e.capturado_em, m.densidade_fios_cm2, m.espessura_media_um,
          m.pct_fios_finos, m.fios_por_uf,
          count(*) over (partition by m.regiao)::integer as exames_na_regiao
        from public.hairmetrix_medidas m
        join public.hairmetrix_exames e    on e.id = m.exame_id
        join public.hairmetrix_pacientes p on p.id = e.paciente_id
        where p.lead_id = p_lead_id and p.tenant_id = public.current_tenant_id()
        order by m.regiao, e.capturado_em desc
      ) u
    ), '[]'::jsonb),

    'vendas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cs.id,
        'tipo', cs.kind,
        'procedimento', cs.procedure_label,
        'vendido_em', cs.sold_at,
        'valor_centavos', cs.value_cents,
        'entrada_centavos', cs.deposit_cents,
        'forma', cs.payment_method,
        'parcelas', cs.installments,
        'status', cs.status,
        'medico', cs.performing_doctor
      ) order by cs.sold_at desc)
      from public.clinic_sales cs
      where cs.lead_id = p_lead_id and cs.tenant_id = public.current_tenant_id()
    ), '[]'::jsonb),

    'pagamentos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rp.id,
        'valor_centavos', rp.amount_cents,
        'metodo', rp.method,
        'status', rp.status,
        'pago_em', rp.paid_at,
        'criado_em', rp.created_at,
        'descricao', rp.description
      ) order by rp.created_at desc)
      from public.rede_payments rp
      where rp.lead_id = p_lead_id and rp.tenant_id = public.current_tenant_id()
    ), '[]'::jsonb),

    'tarefas_abertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'titulo', t.title, 'vence_em', t.due_at, 'tipo', t.task_type
      ) order by t.due_at nulls last)
      from public.lead_tasks t
      where t.lead_id = p_lead_id and t.status <> 'done'
    ), '[]'::jsonb),

    'resumo', (
      select jsonb_build_object(
        'consultas', (select count(*) from public.shosp_appointments a where a.lead_id = p_lead_id),
        'cirurgias', (select count(*) from public.srg_surgeries s
                       where s.lead_id = p_lead_id and s.deleted_at is null),
        'exames_tricoscopia', (select coalesce(sum(hp.total_exames), 0)
                                from public.hairmetrix_pacientes hp where hp.lead_id = p_lead_id),
        'vendas', (select count(*) from public.clinic_sales cs
                    where cs.lead_id = p_lead_id and cs.status <> 'canceled'),
        'faturado_centavos', (select coalesce(sum(cs.value_cents), 0) from public.clinic_sales cs
                               where cs.lead_id = p_lead_id and cs.status <> 'canceled'),
        'pago_centavos', (select coalesce(sum(rp.amount_cents), 0) from public.rede_payments rp
                           where rp.lead_id = p_lead_id and rp.status = 'paid'),
        'mensagens', (select count(*) from public.interactions i where i.lead_id = p_lead_id),
        'nps_enviados', (select count(*) from public.survey_dispatches sd where sd.lead_id = p_lead_id),
        'primeira_consulta', (select min(a.data) from public.shosp_appointments a where a.lead_id = p_lead_id),
        'ultima_consulta', (select max(a.data) from public.shosp_appointments a where a.lead_id = p_lead_id)
      )
    )
  ) end;
$function$;

comment on function public.crm_paciente_360(text) is
  'Vida inteira do paciente num jsonb: consultas, cirurgias, tricoscopia, vendas, pagamentos e tarefas.';

revoke all on function public.crm_paciente_360(text) from public;
grant execute on function public.crm_paciente_360(text) to authenticated;
