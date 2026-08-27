-- Porta de entrada do lead, e a qualidade de cada porta.
--
-- A pergunta do Álvaro em 27/ago/2026: "tem como separar os leads que chegam via
-- landing page, os que vieram de formulário, os que vieram direto no WhatsApp?
-- quero separar e ver a qualidade de todos".
--
-- Por que uma função nova, e não o `por_origem` do `crm_funil_comercial`: aquele
-- agrupa por `attribution_channel`, caindo em `leads.source`, e NENHUM dos dois diz
-- por que porta a pessoa entrou. Medido em 27/ago: dos 881 leads `meta_instagram`
-- da clínica, 810 são formulário do Meta Lead Ads. Agrupar por `source` mistura
-- formulário com quem escreveu no WhatsApp e apaga exatamente a comparação pedida.
--
-- A porta sai de EVIDÊNCIA no próprio lead, da mais forte para a mais fraca, e a
-- ordem importa porque a mesma pessoa pode ter entrado por mais de um caminho:
--   landing     · `custom_fields.origem_landing` (só a /consulta escreve isso, e o
--                 upsert por telefone preserva o carimbo em quem já existia)
--   formulario  · `custom_fields.lead_form` (Meta Lead Ads)
--   whatsapp    · entrou conversando, sem formulário nenhum (CTWA e inbound direto)
--   importacao  · planilha. NÃO é canal de aquisição: são listas de gente que já
--                 comprou, carregadas depois. Aparece com 68% de compra por viés de
--                 seleção, e a tela precisa dizer isso ou o número vira mentira.
--   presencial  · cadastrado na recepção
--
-- Qualidade, em quatro degraus que só descem: falamos → respondeu → agendou →
-- comprou. "Respondeu" é o degrau honesto de engajamento: `first_touch_sent` já
-- provou que carimbar envio não prova nada (ver crm_leadform_primeiro_contato_nao_chega).
--
-- Interação `direction='system'` (sync Shosp, automação de etapa) nunca conta como
-- fala: é ruído de máquina, e foi o que fazia lead abandonado parecer atendido.

create or replace function public.crm_leads_por_porta(
  p_start timestamptz default (now() - interval '30 days'),
  p_end timestamptz default now(),
  p_tenant text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_portas jsonb;
  v_total int;
begin
  create temp table _lpp on commit drop as
  select
    l.id,
    l.created_at,
    l.lost_reason,
    nullif(l.custom_fields->>'triagem_score', '')::numeric as triagem_score,
    case
      when l.custom_fields->>'origem_landing' is not null then 'landing'
      when l.custom_fields ? 'lead_form'                  then 'formulario'
      when l.source like 'planilha%'                      then 'importacao'
      when l.source = 'consulta_presencial'               then 'presencial'
      when l.source in ('meta_whatsapp', 'whatsapp', 'meta_instagram', 'meta_messenger')
                                                          then 'whatsapp'
      else 'outro'
    end as porta
  from public.leads l
  where l.deleted_at is null
    and coalesce(l.excluded_from_metrics, false) = false
    and l.created_at >= p_start
    and l.created_at <= p_end
    and (p_tenant is null or l.tenant_id = p_tenant);

  select count(*) into v_total from _lpp;

  create temp table _lpp_q on commit drop as
  select
    b.id,
    b.porta,
    b.created_at,
    b.lost_reason,
    b.triagem_score,
    (
      select min(i.created_at)
      from public.interactions i
      where i.lead_id = b.id
        and i.direction = 'out'
        and i.channel <> 'system'
        and i.created_at >= b.created_at
    ) as primeira_saida,
    exists (
      select 1 from public.interactions i
      where i.lead_id = b.id
        and i.direction = 'in'
        and i.channel = 'whatsapp'
        and i.created_at >= b.created_at
    ) as respondeu,
    exists (
      select 1 from public.shosp_appointments a where a.lead_id = b.id
    ) as agendou,
    (
      select coalesce(sum(s.value_cents), 0)
      from public.clinic_sales s
      where s.lead_id = b.id
        and s.canceled_at is null
        and coalesce(s.status, '') <> 'canceled'
    ) as valor_cents
  from _lpp b;

  select coalesce(jsonb_agg(x order by (x->>'leads')::int desc), '[]'::jsonb)
    into v_portas
  from (
    select jsonb_build_object(
      'porta', porta,
      'leads', count(*),
      'falamos', count(*) filter (where primeira_saida is not null),
      'responderam', count(*) filter (where respondeu),
      'agendaram', count(*) filter (where agendou),
      'compraram', count(*) filter (where valor_cents > 0),
      'valor_cents', coalesce(sum(valor_cents), 0),
      'perdidos', count(*) filter (where lost_reason is not null),
      -- Mediana em minutos até alguém falar com a pessoa. Só de quem foi falado:
      -- misturar quem nunca recebeu mensagem puxaria a mediana para o infinito e
      -- esconderia que o problema ali é COBERTURA, não velocidade.
      'mediana_resposta_min', (
        select round(percentile_cont(0.5) within group (
          order by extract(epoch from (q.primeira_saida - q.created_at)) / 60
        ))
        from _lpp_q q
        where q.porta = t.porta and q.primeira_saida is not null
      ),
      'score_medio', round(avg(triagem_score) filter (where triagem_score is not null), 1)
    ) as x
    from _lpp_q t
    group by porta
  ) p;

  v_result := jsonb_build_object(
    'periodo', jsonb_build_object('start', p_start, 'end', p_end),
    'total_leads', v_total,
    'portas', v_portas
  );
  return v_result;
end;
$$;

-- O Postgres concede EXECUTE a PUBLIC em toda função nova, e no Supabase PUBLIC
-- inclui `anon` — a mesma chave que a landing /consulta carrega no navegador de
-- quem vem do anúncio. Isto aqui devolve o funil comercial da clínica inteiro.
-- Revogar ANTES de conceder, sempre (ver supabase_rpc_aberta_anon).
revoke all on function public.crm_leads_por_porta(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.crm_leads_por_porta(timestamptz, timestamptz, text) to authenticated, service_role;
