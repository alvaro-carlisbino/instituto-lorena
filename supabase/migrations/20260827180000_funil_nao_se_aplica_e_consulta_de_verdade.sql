-- Duas coisas que a clínica pediu no mesmo dia (Fabricio, 27/ago):
--
-- 1. "tem como fazer uma coluna no funil de leads para fornecedores/não se aplica"
--    Hoje o representante de laboratório, o vendedor de máquina e o número trocado
--    ficam em «Encerrado» ou em «Follow UP 3» — 21 leads já estão marcados com o
--    motivo de perda "Equipe / fornecedor", 5 deles dentro do follow-up, ou seja,
--    recebendo "e aí, vamos fechar?" a cada rodada. Eles também contam no
--    denominador de toda conversão.
--
-- 2. "e essa métrica não está batendo" (card «Consultas agendadas», 66 em HOJE)
--    O card contava TODA linha da agenda da Shosp. Dos 69 horários de 27/08, 46 são
--    Spa Capilar (terapia, lavagem, execução de protocolo) e mais uns tantos são
--    finalização e retorno. Consulta mesmo: 15. O CRM já tem uma definição de
--    "isto é uma consulta" — a de `crm_consultas_realizadas`, que a Conversão da
--    Consulta usa desde 19/ago. O painel é que estava fora dela.


-- ── 1. "Consulta" passa a ter UMA definição, num lugar só ────────────────────
--
-- Estava embutida dentro de `crm_consultas_realizadas`. Vira função própria para o
-- painel usar a MESMA regra — dois números com o mesmo nome e contas diferentes é
-- exatamente o que faz a clínica parar de confiar na tela.
--
-- A regra, em português: não é do Spa Capilar; se a Shosp mandou o serviço, ele
-- precisa começar em CONSULTA (assim "RETORNO DE TRANSPLANTE ON LINE" fica de fora);
-- quando o serviço veio vazio — 80% dos horários, porque a varredura da grade não o
-- traz — cai na observação da recepção, que é onde ela escreve FINALIZAÇÃO, RETORNO,
-- LAVAGEM, "6º mês".
create or replace function public.crm_e_consulta(
  p_servico text,
  p_prestador text,
  p_observacao text
)
returns boolean
language sql
immutable
as $function$
  select coalesce(p_prestador, '') !~* '^[[:space:]]*spa capilar'
     and case
           when nullif(btrim(coalesce(p_servico, '')), '') is not null
             then p_servico ~* '^[[:space:]]*consulta'
           else coalesce(p_observacao, '')
                !~* 'finaliza|retorno|lavagem|curativo|protocolo|terapia|sess[aã]o|[0-9][[:space:]]*[ºo°]?[[:space:]]*(m[eê]s|meses)'
         end;
$function$;

comment on function public.crm_e_consulta(text, text, text) is
  'Um horário da agenda Shosp é CONSULTA? Fonte única da regra: usada pela Conversão '
  'da Consulta (crm_consultas_realizadas) e pelo card do Painel de Performance.';

-- Mesma função de antes, agora chamando o helper. Comportamento idêntico.
create or replace function public.crm_consultas_realizadas(p_de date, p_ate date)
returns table(prontuario text, data date, codigo text)
language sql
stable
as $function$
  select ap.prontuario, ap.data, ap.codigo_agendamento
  from public.shosp_appointments ap
  where ap.prontuario is not null
    and ap.data between p_de and p_ate
    -- Consulta que ainda não aconteceu não converteu nem deixou de converter.
    and (
      ap.data < current_date
      or substring(coalesce(ap.horario, '') from '^[0-9]{1,2}:[0-9]{2}')::time
         <= (now() at time zone 'America/Sao_Paulo')::time
    )
    and coalesce(ap.status, '') !~* 'desmarc|cancel|falt'
    and public.crm_e_consulta(ap.servico, ap.prestador, ap.payload ->> 'observacao');
$function$;


-- ── 2. A agenda por dia, já separada em consulta e o resto ───────────────────
--
-- Devolve por DATA para o painel montar a janela atual e a anterior no fuso do
-- navegador — comparar timestamptz com coluna `date` neste banco é como o funil
-- passou a contar um dia a mais em julho.
--
-- `outros` não é sobra: é o volume do Spa Capilar e dos retornos, que a clínica
-- quer ver (é a operação dela), só não somado dentro de "consultas".
create or replace function public.crm_agenda_por_dia(p_de date, p_ate date)
returns table(
  data date,
  consultas integer,
  consultas_faltas integer,
  consultas_desmarcadas integer,
  outros integer
)
language sql
stable
as $function$
  select
    ap.data,
    count(*) filter (
      where public.crm_e_consulta(ap.servico, ap.prestador, ap.payload ->> 'observacao')
        and coalesce(ap.status, '') ~* '^[[:space:]]*(agendad|confirmad)'
    )::integer,
    count(*) filter (
      where public.crm_e_consulta(ap.servico, ap.prestador, ap.payload ->> 'observacao')
        and coalesce(ap.status, '') ~* '^[[:space:]]*falt'
    )::integer,
    count(*) filter (
      where public.crm_e_consulta(ap.servico, ap.prestador, ap.payload ->> 'observacao')
        and coalesce(ap.status, '') ~* '^[[:space:]]*(cancelad|desmarc)'
    )::integer,
    count(*) filter (
      where not public.crm_e_consulta(ap.servico, ap.prestador, ap.payload ->> 'observacao')
        and coalesce(ap.status, '') ~* '^[[:space:]]*(agendad|confirmad)'
    )::integer
  from public.shosp_appointments ap
  where ap.data between p_de and p_ate
  group by ap.data;
$function$;

comment on function public.crm_agenda_por_dia(date, date) is
  'Agenda da clínica por dia, separando consulta médica de sessão do Spa/retorno. '
  'Base do card «Consultas agendadas» do Painel de Performance.';

grant execute on function public.crm_agenda_por_dia(date, date) to authenticated;
grant execute on function public.crm_e_consulta(text, text, text) to authenticated;


-- ── 3. A coluna «Fornecedor / não se aplica» ─────────────────────────────────
--
-- Última posição do funil da clínica, depois de «Cancelou protocolo». Não é uma
-- etapa da jornada — é a porta de saída para quem nunca esteve nela.
--
-- `pipeline_stages` e `leads` têm o gatilho `enforce_role_write`, que exige
-- permissão de usuário logado. Migração não tem JWT: declara service_role para a
-- transação inteira, senão o INSERT abaixo e o backfill do fim morrem com
-- "forbidden: requires can_edit_boards".
do $claims$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$claims$;

insert into public.pipeline_stages (id, pipeline_id, name, position, tenant_id)
values ('nao-se-aplica', 'pipeline-clinica', '🚫 Fornecedor / não se aplica', 13, 'instituto-lorena')
on conflict (id) do update
  set name = excluded.name,
      position = excluded.position;

-- SEM stageAutomations e SEM SLA em `board_config`, de propósito: automação de etapa
-- manda template de venda, e SLA cobra resposta. Nenhum dos dois faz sentido para
-- quem não é paciente. (Mesmo motivo da etapa «Sem WhatsApp — e-mail», 21/ago.)


-- ── 4. Cair na coluna tira das métricas ──────────────────────────────────────
--
-- Sem isto a coluna seria só arrumação visual: o fornecedor continuaria no
-- denominador da conversão, que é a queixa de origem. `excluded_from_metrics` já é
-- respeitado por crm_funil_comercial, crm_analytics_v2, crm_conversao_comercial e
-- tenant_analytics_summary — o card do lead já tem o botão manual; aqui a coluna
-- passa a ser o botão.
--
-- Sai da coluna, volta a contar: a marca é da COLUNA, não do lead. Quem foi parado
-- ali por engano e é resgatado precisa voltar às métricas sozinho — o contrário
-- (ficar invisível para sempre) é perda silenciosa de dado, que é pior.
create or replace function public._lead_nao_se_aplica()
returns trigger
language plpgsql
as $function$
begin
  if new.stage_id is distinct from old.stage_id then
    if new.stage_id = 'nao-se-aplica' then
      new.excluded_from_metrics := true;
    elsif old.stage_id = 'nao-se-aplica' then
      new.excluded_from_metrics := false;
    end if;
  end if;
  return new;
end;
$function$;

comment on function public._lead_nao_se_aplica() is
  'A coluna «Fornecedor / não se aplica» é o interruptor de excluded_from_metrics: '
  'entrou, sai das contas; saiu, volta.';

drop trigger if exists leads_nao_se_aplica on public.leads;
create trigger leads_nao_se_aplica
  before update on public.leads
  for each row execute function public._lead_nao_se_aplica();

-- E cancela o que ainda ia ser disparado para essa pessoa. A fila de reabordagem
-- agenda dias à frente; sem isto o fornecedor recebe a mensagem depois de arquivado,
-- que foi o que aconteceu com os 34 leads sem WhatsApp em agosto.
create or replace function public._lead_nao_se_aplica_cancela_fila()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.stage_id = 'nao-se-aplica' and old.stage_id is distinct from new.stage_id then
    update public.whatsapp_outreach_queue
       set status = 'canceled',
           last_reason = 'card movido para «Fornecedor / não se aplica»',
           updated_at = now()
     where lead_id = new.id
       and status = 'pending';
  end if;
  return null;
end;
$function$;

drop trigger if exists leads_nao_se_aplica_cancela_fila on public.leads;
create trigger leads_nao_se_aplica_cancela_fila
  after update on public.leads
  for each row execute function public._lead_nao_se_aplica_cancela_fila();


-- ── 5. A IA não reassume conversa parada nessa coluna ────────────────────────
--
-- `ai_handoff_keep_stages` é a lista onde o handoff para humano NÃO expira. Sem a
-- etapa aqui, a IA voltaria a falar com o fornecedor sete dias depois, oferecendo
-- consulta — o mesmo caso da Roberta em 25/ago, com outra roupa.
update public.crm_ai_configs
   set ai_handoff_keep_stages = (
         select jsonb_agg(distinct e)
         from jsonb_array_elements_text(
           coalesce(ai_handoff_keep_stages, '[]'::jsonb) || '["nao-se-aplica"]'::jsonb
         ) as t(e)
       )
 where tenant_id = 'instituto-lorena';


-- ── 6. Os fornecedores que já estão marcados entram na coluna ────────────────
--
-- 19 cards da clínica com motivo de perda "Equipe / fornecedor": 14 em «Encerrado»
-- e 5 em «Follow UP 3». A coluna nasce com eles dentro em vez de vazia, e os 5 param
-- de receber cadência de venda hoje. Os dois cards do Tricopill ficam onde estão —
-- outro polo, outro funil.
update public.leads
   set stage_id = 'nao-se-aplica',
       updated_at = now()
 where deleted_at is null
   and pipeline_id = 'pipeline-clinica'
   and tenant_id = 'instituto-lorena'
   and lost_reason ilike '%fornecedor%'
   and stage_id is distinct from 'nao-se-aplica';


-- ── 7. Fecha o que o Postgres abre sozinho ───────────────────────────────────
--
-- Toda função nasce com EXECUTE para PUBLIC (o `=X/` do proacl), e `anon` herda.
-- O padrão da casa para RPC do CRM é postgres + authenticated + service_role, e
-- nada mais. `_lead_nao_se_aplica_cancela_fila` é security definer: ali PUBLIC
-- solto é o começo de [[supabase_rpc_aberta_anon]], mesmo a função só rodando
-- como gatilho.
revoke execute on function public.crm_agenda_por_dia(date, date) from public, anon;
revoke execute on function public.crm_e_consulta(text, text, text) from public, anon;
revoke execute on function public._lead_nao_se_aplica() from public, anon;
revoke execute on function public._lead_nao_se_aplica_cancela_fila() from public, anon;
