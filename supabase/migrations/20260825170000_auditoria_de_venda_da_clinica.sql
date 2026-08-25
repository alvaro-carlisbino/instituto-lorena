-- QUEM lançou esta venda? Em 25/ago/2026 a resposta era "ninguém sabe".
--
-- Naquele dia 10 linhas entraram em `clinic_sales` às 11:42, todas no mesmo microssegundo, com
-- `created_by` vazio — um INSERT em lote rodado direto no banco. Não eram vendas: eram linhas
-- de PAGAMENTO do financeiro ("ENTRADA TRANSPLANTE - ANESTESISTAS", "PAGAMENTO TRANSPLANTE
-- (PARCIAL/FINAL)"). A fatia de R$ 300 do Loviderm virou "uma venda de cirurgia". Agosto pulou
-- de 11 para 21 vendas e de R$ 403 mil para R$ 529 mil, e a gerência abriu o CRM achando que a
-- conta estava errada.
--
-- Dava para reconstruir O QUE entrou lendo as linhas. **Não dava para saber QUEM**, e é por
-- isso que a investigação levou meia hora: `created_by` só é preenchido pelo formulário do CRM,
-- então "vazio" tanto significa carga de máquina quanto script de gente, e as duas se parecem.
--
-- ── O que este trigger guarda, e por que cada campo ───────────────────────────────────────
--
--   `via`      — 'app' quando há usuário logado; senão o papel do JWT ('service_role') ou
--                'sql_direto' quando nem JWT existe (Management API, psql, MCP). É a resposta
--                de uma palavra para "isso veio do sistema ou de alguém mexendo no banco?".
--   `lote_em`  — `statement_timestamp()`. Todas as linhas de UM comando compartilham o valor,
--                então carga em lote se identifica agrupando por ele. Foi exatamente esse
--                padrão (10 linhas no mesmo microssegundo) que denunciou o caso de agosto.
--   `db_user`  — separa `postgres` (Management API/console) de `authenticator` (PostgREST).
--   os campos da venda — `kind`, `value_cents`, `procedure_label`, `patient_name`: no DELETE
--                são o ÚNICO rastro que sobra da linha apagada. Sem eles a auditoria de
--                exclusão prova que alguém apagou, mas não o quê.
--
-- INSERT e DELETE, não UPDATE: edição de venda é rotina da equipe e encheria a tabela sem
-- responder nada. Quem cria e quem apaga é a pergunta que ficou sem resposta.
--
-- **`security definer` é obrigatório aqui, não conveniência.** A policy de INSERT do
-- `audit_logs` exige `actor_id is not null and actor_id = auth.uid()` — ela barraria justamente
-- a linha que interessa, a de ator nulo. Auditoria que só registra quem já está identificado
-- não serve para achar carga anônima.
create or replace function public.clinic_sales_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id            uuid;
  v_tenant        text;
  v_kind          text;
  v_status        text;
  v_sold_at       date;
  v_value_cents   bigint;
  v_procedure     text;
  v_patient       text;
  v_tem_consulta  boolean;
  v_tem_prontuario boolean;
  v_claims        jsonb;
  v_role          text;
  v_actor         uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.id; v_tenant := old.tenant_id; v_kind := old.kind; v_status := old.status;
    v_sold_at := old.sold_at; v_value_cents := old.value_cents; v_procedure := old.procedure_label;
    v_patient := old.patient_name;
    v_tem_consulta := old.consultation_at is not null;
    v_tem_prontuario := old.shosp_prontuario is not null;
  else
    v_id := new.id; v_tenant := new.tenant_id; v_kind := new.kind; v_status := new.status;
    v_sold_at := new.sold_at; v_value_cents := new.value_cents; v_procedure := new.procedure_label;
    v_patient := new.patient_name;
    v_tem_consulta := new.consultation_at is not null;
    v_tem_prontuario := new.shosp_prontuario is not null;
  end if;

  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;  -- claim ausente ou não-JSON: é o caso do SQL direto, não é erro
  end;
  v_role := coalesce(v_claims ->> 'role', '');
  v_actor := auth.uid();

  -- A auditoria NUNCA derruba a venda. Registro perdido é ruim; venda que não salva porque o
  -- log falhou é pior, e seria um jeito novo de a equipe perder trabalho digitado.
  begin
    insert into public.audit_logs (actor_id, actor_email, action, target_table, target_id, tenant_id, metadata)
    values (
      v_actor,
      v_claims ->> 'email',
      'clinic_sales.' || lower(tg_op),
      'clinic_sales',
      v_id::text,
      v_tenant,
      jsonb_build_object(
        'via',            case when v_actor is not null then 'app'
                               else coalesce(nullif(v_role, ''), 'sql_direto') end,
        'jwt_role',       v_role,
        'db_user',        current_user,
        'lote_em',        statement_timestamp(),
        'kind',           v_kind,
        'status',         v_status,
        'sold_at',        v_sold_at,
        'value_cents',    v_value_cents,
        'procedure_label', v_procedure,
        'patient_name',   v_patient,
        'tem_consulta',   v_tem_consulta,
        'tem_prontuario', v_tem_prontuario
      )
    );
  exception when others then
    raise warning 'clinic_sales_audit: nao registrou % de % (%)', tg_op, v_id, sqlerrm;
  end;

  return null;  -- AFTER trigger: o retorno é ignorado
end;
$$;

revoke all on function public.clinic_sales_audit() from public, anon, authenticated;

drop trigger if exists trg_clinic_sales_audit on public.clinic_sales;

-- AFTER: insert que falhou por constraint não vira linha de auditoria de venda que não existe.
create trigger trg_clinic_sales_audit
  after insert or delete on public.clinic_sales
  for each row execute function public.clinic_sales_audit();

-- Consulta do dia seguinte: "entrou carga anônima em clinic_sales?" Agrupa por comando, então
-- uma carga de 10 linhas aparece como UMA linha com quantidade 10 — que é como ela deve ser lida.
comment on function public.clinic_sales_audit() is
  'Audita INSERT/DELETE de venda da clínica. Para achar carga em lote: select metadata->>''lote_em'', metadata->>''via'', count(*) from audit_logs where target_table=''clinic_sales'' group by 1,2 having count(*) > 3 order by 1 desc;';
