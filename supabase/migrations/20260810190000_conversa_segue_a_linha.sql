-- Uma pessoa pode ser paciente da clínica E cliente do Tricopill ao mesmo tempo.
-- O Ismael é os dois: consultou com a Dra. Lorena, faz implante quinta, e está
-- tentando comprar Tricopill pela linha de vendas desde 07/ago.
--
-- O modelo antigo forçava "uma pessoa = um polo". O lead dele nasceu em
-- `instituto-lorena` (veio do Meta em 20/mai) e `upsertLeadByPhone` nunca reescreve
-- `tenant_id` de lead que já existe. Quando ele voltou pela linha do Tricopill, o
-- webhook carimbou as MENSAGENS com o tenant da LINHA (`tricopill`) e o lead ficou
-- na clínica. Como `tenant_isolation` é RESTRICTIVE, isso escondeu a conversa dos
-- DOIS lados: no workspace Tricopill o lead nem aparece, no workspace Clínica as
-- mensagens são cortadas. 17 leads e 90 mensagens de venda nesse estado.
--
-- Mover essas pessoas de polo não resolve: 10 delas têm prontuário e agenda no
-- Shosp, 6 com consulta marcada. Tirar do Kanban da clínica um paciente que tem
-- consulta na semana é pior que o bug.
--
-- A regra passa a ser: a CONVERSA segue a LINHA, a PESSOA continua onde está.
-- Quem é dono da linha enxerga o lead e a conversa que acontece nela, sem que o
-- lead troque de polo. `tenant_id` continua sendo a verdade para financeiro e
-- métricas, então os polos seguem sem somar um com o outro.

-- ---------------------------------------------------------------------------
-- Predicados
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER de propósito: subquery dentro de policy roda como o usuário da
-- consulta, então um EXISTS direto em `leads` sofreria o próprio RLS de `leads` e
-- devolveria falso justamente no caso cross-polo que queremos liberar.
--
-- Ambas devolvem só um boolean derivado do tenant de QUEM CHAMA, nunca dado de
-- outro polo. Para `anon`, `current_tenant_id()` é nulo e o retorno é sempre false.
create or replace function public.current_tenant_owns_instance(p_instance_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p_instance_id is not null
     and exists (
       select 1
       from public.whatsapp_channel_instances w
       where w.id = p_instance_id
         and w.tenant_id = public.current_tenant_id()
     );
$function$;

create or replace function public.current_tenant_can_see_lead(p_lead_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p_lead_id is not null
     and exists (
       select 1
       from public.leads l
       where l.id = p_lead_id
         and (
           l.tenant_id = public.current_tenant_id()
           or public.current_tenant_owns_instance(l.whatsapp_instance_id)
         )
     );
$function$;

-- Custo alto para o planner deixar a comparação barata de `tenant_id` na frente do
-- OR. Assim a chamada de função só acontece nas poucas linhas cross-polo (hoje 90
-- de 35.869 interactions), e não uma vez por linha da tabela inteira.
alter function public.current_tenant_owns_instance(text) cost 500;
alter function public.current_tenant_can_see_lead(text) cost 500;

comment on function public.current_tenant_owns_instance(text) is
  'True quando a linha de WhatsApp informada pertence ao tenant ativo do usuário.';
comment on function public.current_tenant_can_see_lead(text) is
  'True quando o lead é do tenant ativo OU conversa por uma linha desse tenant.';

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- O lead aparece para quem é dono da linha em que ele está falando.
drop policy if exists tenant_isolation on public.leads;
create policy tenant_isolation on public.leads
  as restrictive
  for all
  using (
    tenant_id = public.current_tenant_id()
    or public.is_super_admin()
    or public.current_tenant_owns_instance(whatsapp_instance_id)
  )
  with check (
    tenant_id = public.current_tenant_id()
    or public.is_super_admin()
    or public.current_tenant_owns_instance(whatsapp_instance_id)
  );

-- Tudo que pendura no lead enxerga junto com o lead. Sem isso a conversa continua
-- partida: dá para ver o card e não dá para ver a mensagem (ou o contrário).
do $$
declare
  t text;
begin
  foreach t in array array[
    'interactions',
    'crm_conversation_states',
    'crm_media_items',
    'crm_lead_followup_state',
    'lead_tag_assignments'
  ]
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format($f$
      create policy tenant_isolation on public.%I
        as restrictive
        for all
        using (
          tenant_id = public.current_tenant_id()
          or public.is_super_admin()
          or public.current_tenant_can_see_lead(lead_id)
        )
        with check (
          tenant_id = public.current_tenant_id()
          or public.is_super_admin()
          or public.current_tenant_can_see_lead(lead_id)
        )
    $f$, t);
  end loop;
end
$$;
