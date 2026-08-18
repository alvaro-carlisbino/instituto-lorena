-- O polo enxerga o lead com quem ELE conversou — não só o lead que está na linha dele.
--
-- 17/ago/2026, terceiro passo do dia. Fechar a leitura por polo (`20260817200000` e
-- `20260817210000`) deixou à mostra um buraco que já era da EQUIPE desde 10/ago:
--
--   17 leads da clínica, SEM `whatsapp_instance_id`, com 263 mensagens carimbadas
--   `tricopill` — Fran, Géh Souza, Renatha, Carla, Fabricio, André, e alguns contatos
--   internos. Gente que falou na linha de vendas ANTES de o lead passar a guardar a
--   linha. A Ingrid via as mensagens (o carimbo é dela) e NÃO via o card. Sem card, a
--   tela não desenha nada: 263 mensagens que não existem para ninguém.
--
-- O CONSERTO ÓBVIO ERA ERRADO. Carimbar `whatsapp_instance_id = tricopill-wapi` nesses
-- leads faria o card aparecer — e faria o trigger `_stamp_tenant_id_from_lead` passar a
-- carimbar TUDO desses leads como Tricopill, porque ele segue a linha. `insertInteraction`
-- no front não manda tenant (nem ~65 outros pontos), então a nota que a Aline escrever no
-- prontuário da Renatha viraria mensagem do Tricopill e sumiria da clínica. É o bug de
-- 14/ago espelhado, e em cima de paciente de cirurgia.
--
-- Então a visibilidade passa a seguir o que de fato aconteceu: **conversou comigo, eu
-- enxergo o card**. O carimbo de cada mensagem não muda, o polo do lead não muda, e a
-- leitura da CONVERSA continua estritamente por polo (`tenant_isolation_read` é
-- RESTRICTIVE e entra em AND com tudo isto aqui) — o Tricopill vê o card da Renatha com a
-- metade dele, e só.
--
-- Medido antes: entram 17 leads no Tricopill e ZERO na clínica. Não é regra nova, é a
-- mesma de 10/ago com a fonte certa — a linha era só um proxy de "falou comigo", e um
-- proxy que vem nulo em ManyChat, Instagram e cadastro na mão.
--
-- A resposta da Ingrid nesses cards nasce certa: `crm-send-message` carimba pelo polo de
-- QUEM ENVIA quando ele difere do lead (`assuntoDeOutroPolo`), e escreve com service_role.

-- Índice para o predicado novo não pesar no caminho quente (/leads pagina 3x1000 no boot).
create index if not exists idx_interactions_tenant_lead on public.interactions (tenant_id, lead_id);

create or replace function public.current_tenant_talked_lead_ids()
returns setof text
language sql
stable security definer
set search_path to 'public'
as $function$
  select distinct i.lead_id
  from public.interactions i
  where i.tenant_id = (select public.current_tenant_id())
    and i.lead_id is not null
$function$;

revoke all on function public.current_tenant_talked_lead_ids() from public;
grant execute on function public.current_tenant_talked_lead_ids() to authenticated, service_role;

-- `visible_lead_ids` alimenta as policies de interactions, mídia, tags, follow-up e estado
-- da conversa. Sem incluir aqui, o card dos 17 apareceria PELA METADE: sem tag, sem
-- follow-up, e o botão de ligar/desligar a IA falharia calado ao gravar.
create or replace function public.current_tenant_visible_lead_ids()
returns setof text
language sql
stable security definer
set search_path to 'public'
as $function$
  select l.id
  from public.leads l
  where l.tenant_id = (select public.current_tenant_id())
     or l.whatsapp_instance_id in (select public.current_tenant_instance_ids())
  union
  select public.current_tenant_talked_lead_ids()
$function$;

drop policy if exists tenant_isolation_read on public.leads;
create policy tenant_isolation_read on public.leads
  as restrictive
  for select
  using (
    tenant_id = (select public.current_tenant_id())
    or whatsapp_instance_id in (select public.current_tenant_instance_ids())
    or id in (select public.current_tenant_talked_lead_ids())
  );

-- A `for all` também precisa saber, senão ela barra a leitura no AND (e a Ingrid não
-- consegue mexer no card que enxerga). O `is_super_admin` continua aqui de propósito:
-- esta é a policy da ESCRITA, e é o dono quem conserta lead carimbado errado.
drop policy if exists tenant_isolation on public.leads;
create policy tenant_isolation on public.leads
  as restrictive
  for all
  using (
    tenant_id = (select public.current_tenant_id())
    or (select public.is_super_admin())
    or whatsapp_instance_id in (select public.current_tenant_instance_ids())
    or id in (select public.current_tenant_talked_lead_ids())
  );
