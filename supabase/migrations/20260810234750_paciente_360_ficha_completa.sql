-- A ficha do paciente/cliente passa a trazer TUDO o que a pessoa tem no sistema.
--
-- O 360 nasceu clínico: consulta, cirurgia, tricoscopia, venda de procedimento e um
-- punhado de pagamentos. De um cliente do Tricopill isso mostrava valor e status e mais
-- nada — sem kit, sem itens, sem cupom, sem frete, sem nota, sem rastreio, sem
-- assinatura. A pergunta mais comum do WhatsApp ("cadê meu pedido?") não tinha resposta
-- na tela da pessoa.
--
-- Pior: o tipo em TypeScript já declarava `origem`, `canal_atribuicao`, `campanha`,
-- `temperatura` e `status_conversa` — e o RPC nunca devolveu nenhum dos cinco. A ficha
-- lia `undefined` e mostrava vazio como se a informação não existisse no banco.
--
-- Continua vindo tudo num jsonb só: a ficha abria com 4 chamadas e, seção a seção,
-- iria para mais de 15. Em conexão de recepção isso é meio segundo de tela pulando.
--
-- 'pagamentos' segue existindo, com o formato antigo, para não quebrar quem já lia.
create or replace function public.crm_paciente_360_ref(p_tipo text, p_ref text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with ident as (select * from public.crm_identidade(p_tipo, p_ref) limit 1),
  lead as (
    select l.* from public.leads l, ident i where l.id = i.lead_id
  )
  select case when not exists (select 1 from ident) then null::jsonb else jsonb_build_object(
    'paciente', (
      select jsonb_build_object(
        'tipo', p_tipo, 'ref', p_ref, 'lead_id', i.lead_id,
        'nome', coalesce((select l.patient_name from lead l),
          (select sp.nome from public.shosp_patients sp where sp.prontuario = i.prontuario), i.nome),
        'nome_completo', (select nullif(l.custom_fields->'cadastro'->>'nomeCompleto', '') from lead l),
        'telefone', coalesce((select l.phone from lead l),
          (select coalesce(sp.celular, sp.telefone) from public.shosp_patients sp where sp.prontuario = i.prontuario)),
        'prontuario', i.prontuario,
        -- CPF/e-mail: Shosp quando é paciente, cadastro de venda quando é cliente da loja.
        'cpf', coalesce(
          (select sp.cpf from public.shosp_patients sp where sp.prontuario = i.prontuario),
          (select nullif(l.custom_fields->'cadastro'->>'cpf', '') from lead l)),
        'email', coalesce(
          (select sp.email from public.shosp_patients sp where sp.prontuario = i.prontuario),
          (select nullif(l.custom_fields->>'email', '') from lead l),
          (select nullif(l.custom_fields->'cadastro'->>'email', '') from lead l)),
        'nascimento', (select nullif(l.custom_fields->'cadastro'->>'dataNascimento', '') from lead l),
        'tem_card', i.lead_id is not null,
        -- Estes cinco o tipo em TypeScript já prometia e o RPC nunca devolveu.
        'origem', (select l.source from lead l),
        'temperatura', (select l.temperature from lead l),
        'status_conversa', (select l.conversation_status from lead l),
        'canal_atribuicao', (select l.custom_fields->'attribution'->'first'->>'referrer' from lead l),
        'campanha', (select coalesce(l.custom_fields->'lead_form'->>'campaign_name',
                                     l.custom_fields->'attribution'->'first'->>'landing') from lead l),
        'funil', (select p.name from lead l join public.pipelines p on p.id = l.pipeline_id),
        'etapa', (select s.name from lead l join public.pipeline_stages s on s.id = l.stage_id),
        'responsavel', (select u.name from lead l join public.app_users u on u.id = l.owner_id),
        'entrega', (select l.custom_fields->'entrega' from lead l),
        'tags', coalesce((select jsonb_agg(jsonb_build_object('nome', d.name, 'cor', d.color))
                          from public.lead_tag_assignments a
                          join public.lead_tag_definitions d on d.id = a.tag_id
                          where a.lead_id = i.lead_id), '[]'::jsonb),
        'criado_em', (select l.created_at from lead l),
        'ultimo_contato', (select l.last_interaction_at from lead l)
      ) from ident i
    ),
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
    -- PEDIDOS: cartão (Rede) e PIX (PagBank) na mesma lista, com o que a atendente
    -- precisa responder ao telefone — kit, cupom, frete, nota e rastreio. Antes só
    -- existia 'pagamentos' com valor e status, e a pergunta "cadê meu pedido?" não
    -- tinha resposta na ficha.
    'pedidos', coalesce((
      select jsonb_agg(p order by p->>'criado_em' desc) from (
        select jsonb_build_object(
          'id', rp.id, 'canal', 'cartao', 'valor_centavos', rp.amount_cents,
          'metodo', rp.method, 'status', rp.status, 'pago_em', rp.paid_at,
          'criado_em', rp.created_at, 'descricao', rp.description,
          'kit', rp.kit, 'itens', rp.items, 'parcelas', rp.installments,
          'cupom', rp.coupon_code, 'desconto_centavos', rp.discount_cents,
          'frete_centavos', rp.freight_cents, 'origem', rp.origin,
          'pedido_bling', rp.bling_order_id,
          'nfe_numero', rp.nfe_numero, 'nfe_status', rp.nfe_status,
          'taxa_centavos', rp.fee_cents, 'liquido_centavos', rp.net_cents
        ) as p
        from public.rede_payments rp, ident i
        where rp.tenant_id = public.current_tenant_id()
          and i.lead_id is not null and rp.lead_id = i.lead_id
        union all
        select jsonb_build_object(
          'id', pc.checkout_id, 'canal', 'pix', 'valor_centavos', pc.amount_cents,
          'metodo', 'pix', 'status', pc.status, 'pago_em', pc.paid_at,
          'criado_em', pc.created_at, 'descricao', pc.reference_id,
          'kit', pc.kit, 'itens', null::jsonb, 'parcelas', 1,
          'cupom', pc.coupon_code, 'desconto_centavos', pc.discount_cents,
          'frete_centavos', null::integer, 'origem', 'pagbank',
          'pedido_bling', pc.bling_order_id,
          'nfe_numero', null::text, 'nfe_status', null::text,
          'taxa_centavos', null::integer, 'liquido_centavos', null::integer
        )
        from public.pagbank_checkouts pc, ident i
        where pc.tenant_id = public.current_tenant_id()
          and i.lead_id is not null and pc.lead_id = i.lead_id
      ) z
    ), '[]'::jsonb),
    -- Mantido para não quebrar quem já lia 'pagamentos'.
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
    'assinatura', (
      select jsonb_build_object(
        'id', s.id, 'status', s.status, 'cadencia', s.cadence,
        'valor_mensal_centavos', s.monthly_value_cents, 'frascos_por_envio', s.units_per_shipment,
        'ciclos_pagos', s.paid_cycles, 'ultimo_ciclo_enviado', s.last_shipped_cycle,
        'minimo_ciclos', s.min_cycles, 'ultimo_envio_em', s.last_ship_at,
        'ultimo_envio_status', s.last_ship_status, 'criada_em', s.created_at
      )
      from public.asaas_subscriptions s, ident i
      where s.tenant_id = public.current_tenant_id()
        and i.lead_id is not null and s.lead_id = i.lead_id
      order by s.created_at desc limit 1
    ),
    'protocolos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tp.id, 'nome', tp.name, 'status', tp.status,
        'sessoes_previstas', tp.sessions_planned,
        'sessoes_feitas', (select count(*) from public.lead_protocol_sessions ps where ps.lead_protocol_id = tp.id),
        'preco', tp.price, 'iniciado_em', tp.started_on, 'concluido_em', tp.finished_on
      ) order by tp.started_on desc nulls last)
      from public.lead_treatment_protocols tp, ident i
      where tp.tenant_id = public.current_tenant_id()
        and i.lead_id is not null and tp.lead_id = i.lead_id
    ), '[]'::jsonb),
    'notas_clinicas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cn.id, 'autor', cn.author, 'papel', cn.author_role,
        'categoria', cn.category, 'nota', cn.note, 'criada_em', cn.created_at
      ) order by cn.created_at desc)
      from public.clinical_notes cn, ident i
      where cn.tenant_id = public.current_tenant_id()
        and i.lead_id is not null and cn.lead_id = i.lead_id
    ), '[]'::jsonb),
    'followups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'tentativa', f.attempt_no, 'agendado_para', f.scheduled_for,
        'feito_em', f.done_at, 'canal', f.channel, 'desfecho', f.outcome, 'nota', f.note
      ) order by f.scheduled_for desc nulls last)
      from public.lead_followups f, ident i
      where f.tenant_id = public.current_tenant_id()
        and i.lead_id is not null and f.lead_id = i.lead_id
    ), '[]'::jsonb),
    -- NPS com a NOTA, não só a contagem de envios: 'nps_enviados' dizia que a pesquisa
    -- saiu, nunca o que a pessoa respondeu.
    'nps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'enviado_em', sd.sent_at, 'canal', sd.channel,
        'nota', sr.score, 'comentario', sr.comment, 'respondido_em', sr.responded_at
      ) order by sd.sent_at desc)
      from public.survey_dispatches sd
      left join public.survey_responses sr on sr.dispatch_id = sd.id, ident i
      where i.lead_id is not null and sd.lead_id = i.lead_id
    ), '[]'::jsonb),
    'tarefas_abertas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'titulo', t.title, 'vence_em', t.due_at, 'tipo', t.task_type
      ) order by t.due_at nulls last)
      from public.lead_tasks t, ident i
      where i.lead_id is not null and t.lead_id = i.lead_id and t.status <> 'done'
    ), '[]'::jsonb),
    'conversa', (
      select jsonb_build_object(
        'mensagens', (select count(*) from public.interactions x where x.lead_id = i.lead_id),
        'recebidas', (select count(*) from public.interactions x where x.lead_id = i.lead_id and x.direction = 'in'),
        'enviadas', (select count(*) from public.interactions x where x.lead_id = i.lead_id and x.direction = 'out'),
        'primeira_em', (select min(x.happened_at) from public.interactions x where x.lead_id = i.lead_id),
        'ultima_em', (select max(x.happened_at) from public.interactions x where x.lead_id = i.lead_id),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'linha', c.whatsapp_instance_id, 'dono', c.owner_mode,
            'ia_ligada', c.ai_enabled, 'ultima_resposta_humana', c.last_human_reply_at))
          from public.crm_conversation_line_states c where c.lead_id = i.lead_id), '[]'::jsonb)
      ) from ident i where i.lead_id is not null
    ),
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
        'pedidos', (select count(*) from public.rede_payments rp
                     where i.lead_id is not null and rp.lead_id = i.lead_id)
                 + (select count(*) from public.pagbank_checkouts pc
                     where i.lead_id is not null and pc.lead_id = i.lead_id),
        'pedidos_pagos', (select count(*) from public.rede_payments rp
                           where i.lead_id is not null and rp.lead_id = i.lead_id and rp.status = 'paid')
                       + (select count(*) from public.pagbank_checkouts pc
                           where i.lead_id is not null and pc.lead_id = i.lead_id and pc.status = 'paid'),
        'faturado_centavos', (select coalesce(sum(cs.value_cents), 0) from public.clinic_sales cs
                               where cs.status <> 'canceled'
                                 and ((i.lead_id is not null and cs.lead_id = i.lead_id)
                                   or (i.prontuario is not null and cs.shosp_prontuario = i.prontuario))),
        'pago_centavos', (select coalesce(sum(rp.amount_cents), 0) from public.rede_payments rp
                           where i.lead_id is not null and rp.lead_id = i.lead_id and rp.status = 'paid')
                       + (select coalesce(sum(pc.amount_cents), 0) from public.pagbank_checkouts pc
                           where i.lead_id is not null and pc.lead_id = i.lead_id and pc.status = 'paid'),
        'mensagens', (select count(*) from public.interactions x
                       where i.lead_id is not null and x.lead_id = i.lead_id),
        'nps_enviados', (select count(*) from public.survey_dispatches sd
                          where i.lead_id is not null and sd.lead_id = i.lead_id),
        'nps_ultima_nota', (select sr.score from public.survey_dispatches sd
                             join public.survey_responses sr on sr.dispatch_id = sd.id
                             where i.lead_id is not null and sd.lead_id = i.lead_id
                             order by sr.responded_at desc limit 1),
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
