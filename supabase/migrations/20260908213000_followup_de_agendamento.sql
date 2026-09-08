-- Follow-up de AGENDAMENTO: 24h / 48h / 7 dias para quem conversou, ouviu sobre a
-- consulta e parou de responder.
--
-- Pedido da equipe da clínica na reunião de 05/09/2026, com os três textos escritos por
-- eles. Não é "trocar o texto do follow-up que já existe": é outra máquina, porque o
-- recorte é o INVERSO do que as rotinas de hoje enxergam.
--
--   • `crm-followup-scheduler` (1h/2h/4h/8h/16h/24h) só fala com quem está esperando
--     RESPOSTA NOSSA — último inbound mais novo que qualquer outbound. Continua vivo e
--     intocado: ele resolve "a pessoa perguntou e ninguém respondeu".
--   • `crm-atendimento-vigia` cobra a EQUIPE, não o paciente.
--   • `crm-landing-retomada` já cobre o lead da landing /consulta que parou. Por isso a
--     lista aqui EXCLUI quem tem `origem_landing`: dois robôs no mesmo ombro é assédio.
--
-- O que faltava é o meio: a pessoa escreveu, a casa respondeu, explicou a consulta — e
-- ela sumiu. Ninguém falava com essa gente. São 669 conversas da clínica neste estado.
--
-- CORTE DE BACKLOG (o detalhe que evita o desastre). Sem ele, ligar esta rotina jogaria
-- "segue nosso vídeo" em 616 pessoas que sumiram há semanas ou meses — linha queimada e
-- paciente perguntando por que a clínica sumiu e voltou meses depois. `ativado_em` é a
-- linha de corte: só entra quem parou DEPOIS que a rotina foi ligada. No primeiro dia a
-- fila é zero e ela se enche sozinha, no ritmo de quem conversa hoje. Para trabalhar o
-- backlog um pedaço de cada vez, é só empurrar `ativado_em` para trás.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quem está no recorte
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.crm_sem_agendamento_para_nutrir(
  p_tenant text default 'instituto-lorena',
  p_min_horas integer default 24,
  p_desde timestamptz default null,
  p_max_dias integer default 30
)
returns table(
  lead_id text,
  patient_name text,
  phone text,
  tenant_id text,
  conversa_tenant_id text,
  whatsapp_instance_id text,
  medico text,
  ultima_saida timestamptz,
  ultima_entrada timestamptz,
  horas_parado integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with conversa as (
    select
      i.lead_id,
      -- A ÚLTIMA RESPOSTA DE VERDADE, não a última mensagem que saiu. Cobrança de robô
      -- (follow-up, reengajamento, carrinho, e esta própria rotina) não pode reiniciar o
      -- relógio: se contasse, o degrau de 24h nunca chegaria aos 48h — cada mensagem
      -- nossa empurraria a régua para a frente e a pessoa levaria a mesma primeira
      -- mensagem para sempre. Também é o que tira daqui quem o
      -- `crm-followup-scheduler` está cobrando: para esses a última fala real é ANTIGA,
      -- a entrada é mais nova, e a linha cai fora sozinha no filtro lá embaixo.
      max(i.happened_at) filter (
        where i.direction = 'out'
          and coalesce(i.author, '') not in (
            'Assistente IA (follow-up)',
            'Assistente IA (agendamento)',
            'Assistente IA (reengajamento)',
            'Assistente IA (recompra)',
            'Assistente IA (carrinho)',
            'Sistema (Follow-up)',
            -- Pesquisa de satisfação não é resposta sobre a consulta.
            'NPS (Sofia)',
            'NPS (IA)'
          )
      ) as ultima_saida,
      max(i.happened_at) filter (where i.direction = 'in') as ultima_entrada,
      max(i.tenant_id) filter (where i.direction = 'out') as tenant_da_conversa
    from public.interactions i
    -- 'system' fora dos dois lados: nota de automação não é conversa de gente
    -- ([[crm_nota_de_sistema_virou_mensagem_do_paciente]]).
    where i.channel in ('whatsapp', 'meta')
      and i.deleted_at is null
      and i.happened_at > now() - make_interval(days => greatest(p_max_dias, 1))
    group by i.lead_id
  )
  select
    l.id as lead_id,
    coalesce(l.patient_name, 'Lead') as patient_name,
    coalesce(l.phone, '') as phone,
    l.tenant_id,
    coalesce(nullif(c.tenant_da_conversa, ''), l.tenant_id) as conversa_tenant_id,
    l.whatsapp_instance_id,
    nullif(l.custom_fields->>'medico', '') as medico,
    c.ultima_saida,
    c.ultima_entrada,
    (extract(epoch from (now() - c.ultima_saida)) / 3600)::integer as horas_parado
  from public.leads l
  join conversa c on c.lead_id = l.id
  where l.tenant_id = p_tenant
    and l.deleted_at is null
    and l.opted_out_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and not public.crm_is_internal_contact(l.patient_name)
    and coalesce(l.conversation_status, '') not in ('archived', 'closed', 'lost', 'won')
    and length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 12
    -- Lead da landing tem dono: `crm-landing-retomada`. Ver o cabeçalho.
    and not (l.custom_fields ? 'origem_landing')
    -- A PESSOA FALOU e a casa respondeu. Quem nunca escreveu é primeiro contato, e disso
    -- cuida a fila do `crm-outreach-worker` — os textos daqui ("ficou alguma dúvida em
    -- relação à consulta") seriam mentira para quem nunca conversou.
    and c.ultima_entrada is not null
    and c.ultima_saida is not null
    and c.ultima_saida > c.ultima_entrada
    and c.ultima_saida < now() - make_interval(hours => greatest(p_min_horas, 1))
    and (p_desde is null or c.ultima_saida >= p_desde)
    -- Quem já andou no funil sai: cobrar agendamento de quem já agendou é o jeito mais
    -- rápido de queimar a relação ([[crm_followup_quadro_come_paciente]]).
    and l.stage_id is distinct from 'nao-se-aplica'
    and not exists (select 1 from public.appointments a where a.lead_id = l.id)
    and not exists (select 1 from public.shosp_appointments sa where sa.lead_id = l.id)
    and not exists (select 1 from public.clinic_prebookings pb where pb.lead_id = l.id)
    and not exists (select 1 from public.clinic_sales cs where cs.lead_id = l.id)
  order by c.ultima_saida asc
  limit 200;
$function$;

comment on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) is
  'Paciente que conversou, ouviu sobre a consulta e parou de responder sem agendar. É o recorte que o follow-up (só vê quem espera a gente), o vigia (cobra a equipe) e a retomada da landing (só lead de anúncio) deixam de fora. Alimenta crm-followup-agendamento.';

-- SECURITY DEFINER devolvendo nome e telefone de paciente precisa de grant explícito:
-- PUBLIC executa por padrão, e PUBLIC no Supabase inclui `anon` ([[supabase_rpc_aberta_anon]]).
revoke all on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) from public;
revoke all on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) from anon;
revoke all on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) from authenticated;
grant execute on function public.crm_sem_agendamento_para_nutrir(text, integer, timestamptz, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Onde a cadência guarda o passo
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.crm_followup_agendamento (
  lead_id text primary key references public.leads (id) on delete cascade,
  tenant_id text not null default 'instituto-lorena' references public.tenants (id),

  -- 0 = ninguém falou ainda; 1, 2, 3 = degraus já enviados. Só sobe.
  step smallint not null default 0,
  last_sent_at timestamptz,

  -- Tentativas do degrau ATUAL. O vídeo pode falhar (link expirado, W-API fora do ar);
  -- depois de duas voltas o texto sai sozinho, sem o vídeo, porque a mensagem importa
  -- mais que o anexo.
  attempts smallint not null default 0,
  last_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.crm_followup_agendamento is
  'Passo da cadência de agendamento (24h/48h/7d) por paciente. Cada pessoa recebe cada um dos três degraus UMA vez na vida: o passo só sobe, e conversa nova não reinicia a régua.';

create index if not exists crm_followup_agendamento_step_idx
  on public.crm_followup_agendamento (step, last_sent_at);

alter table public.crm_followup_agendamento enable row level security;

-- A equipe LÊ (a tela mostra quem está na cadência); escrever é da rotina (service_role),
-- que não passa por RLS.
drop policy if exists "followup agendamento tenant read" on public.crm_followup_agendamento;
create policy "followup agendamento tenant read" on public.crm_followup_agendamento
  for select to authenticated
  using (tenant_id = public.current_tenant_id() and public.is_staff_user());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Config: os textos moram no banco, não no deploy
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A equipe reescreve estes textos com frequência (é o que gerou este pedido). Deixá-los
-- em `tenant_integrations.outreach.agendamento`, ao lado do primeiro contato, é o que
-- permite corrigir uma vírgula sem subir código — e é o que a tela de Configurações
-- passa a editar, no lugar do painel de templates dia 1/3/5 que nunca enviou nada
-- (o `crm-followup-worker` que os lia jamais foi agendado).
--
-- `{{primeiro_nome}}` = primeiro nome. `{{saudacao}}` = bom dia/boa tarde/boa noite pela
-- hora de Maringá: os textos da equipe vinham com "boa tarde" e "Bom dia" fixos, e
-- saudação errada é o carimbo mais barato de robô. `{{consulta_medico}}` vira
-- "com a Dra. Lorena" quando a conversa registrou o médico, e some quando não registrou.

insert into public.tenant_integrations (tenant_id, outreach)
values ('instituto-lorena', '{}'::jsonb)
on conflict (tenant_id) do nothing;

update public.tenant_integrations
   set outreach = coalesce(outreach, '{}'::jsonb) || jsonb_build_object(
     'agendamento', jsonb_build_object(
       'enabled', true,
       -- Linha de corte do backlog. now() = a cadência nasce olhando só para a frente.
       'ativado_em', now(),
       'max_dias', 30,
       'cap_por_rodada', 6,
       'video_path', 'institucional/instituto-lorena/primeira-consulta.mp4',
       'passos', jsonb_build_array(
         jsonb_build_object(
           'horas', 24,
           'video', true,
           'texto', 'Olá, {{primeiro_nome}}, {{saudacao}}! Tudo bem?' || chr(10) || chr(10) ||
             'Segue nosso vídeo explicando como será a sua experiência de atendimento aqui no Instituto Lorena Visentainer!' || chr(10) || chr(10) ||
             'Caso tenha alguma dúvida, estamos à disposição.'
         ),
         jsonb_build_object(
           'horas', 48,
           'video', false,
           'texto', '{{saudacao_maiuscula}}, {{primeiro_nome}}!' || chr(10) || chr(10) ||
             'Ficou alguma dúvida em relação à consulta{{consulta_medico}}?' || chr(10) || chr(10) ||
             'Vamos seguir com o seu agendamento?'
         ),
         jsonb_build_object(
           'horas', 168,
           'video', false,
           'texto', 'Olá, {{primeiro_nome}}! 😊' || chr(10) || chr(10) ||
             'Percebemos que ainda não conseguimos dar continuidade ao seu atendimento, mas queremos deixar nossos canais à disposição para que você possa conhecer mais sobre o nosso trabalho e os resultados realizados aqui no Instituto Lorena Visentainer.' || chr(10) || chr(10) ||
             '📲 Instagram: @institutolorenavisentainer e @lorenavisentainer' || chr(10) || chr(10) ||
             '🎥 Acompanhe nossos conteúdos, bastidores, casos e orientações sobre saúde e transplante capilar.' || chr(10) ||
             'Quando desejar, será um prazer receber você por aqui! ✨'
         )
       )
     )
   )
 where tenant_id = 'instituto-lorena';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Cron
-- ─────────────────────────────────────────────────────────────────────────────
--
-- De hora em hora, 9h–19h de Maringá (12–22 UTC), de segunda a sexta. Janela estreita de
-- propósito: mensagem de clínica que chega às 23h de domingo assusta. A guarda anti-ban
-- do `crm-send-message` ainda decide se cada mensagem sai de fato — e é ela que segura o
-- 3º degrau em `cap_proativo_semana_por_lead = 2`, empurrando-o do 7º para o 8º dia. Um
-- dia a mais é preço barato pela guarda que mantém a linha viva.
--
-- O segredo NÃO mora neste arquivo: o repositório é público ([[crm_repo_publico_dado_de_negocio]]).
-- Ele fica em `public.app_cron_secrets` (chave `followup_agendamento`) e no secret
-- `FOLLOWUP_AGENDAMENTO_CRON_SECRET` da função. Sem o par batendo, a função devolve 401.

select cron.unschedule('crm-followup-agendamento-job')
where exists (select 1 from cron.job where jobname = 'crm-followup-agendamento-job');

select cron.schedule(
  'crm-followup-agendamento-job',
  '35 12-22 * * 1-5',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-followup-agendamento',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'followup_agendamento'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);
