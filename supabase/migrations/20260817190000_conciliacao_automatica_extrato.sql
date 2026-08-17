-- CONCILIAÇÃO AUTOMÁTICA: quem sabe se a nota foi paga é o extrato, e ele já está aqui.
--
-- A captura da SEFAZ virou cron (`crm-sefaz-sync`) e o extrato do banco virou cron
-- (`crm-banco-mcp-sync-job`, de hora em hora). As duas pontas entram sozinhas e **ninguém
-- encosta uma na outra**: sobraram 277 parcelas "em aberto" somando R$ 313 mil que em boa
-- parte já saíram da conta. Enquanto isso a clínica lê dívida onde não há, o DRE conta a
-- mesma despesa duas vezes (a parcela E o lançamento do banco) e o número de "vencidas"
-- assusta sem motivo.
--
-- Nem a SEFAZ nem o XML dizem se foi pago — isso continua verdade. O que muda é que agora
-- o casamento com o extrato roda sozinho, logo depois do banco sincronizar.
--
-- ── O DESENHO, e por que ele é conservador ────────────────────────────────────────────────
--
-- Valor EXATO em centavos é a condição de entrada. Não há tolerância de juros/desconto de
-- propósito: aproximar valor é onde a conciliação automática começa a inventar pagamento.
--
-- A janela vai até +60 dias do vencimento porque a realidade é larga: os boletos desta
-- clínica caem com 28 a 31 dias de atraso com frequência (White Martins, EPS, Beauty
-- Solutions). Janela de 5 dias — a do motor antigo, no navegador — enxergava quase nada.
--
-- Do lado de ANTES do vencimento a janela é curta, e por um caso real: uma parcela da Beauty
-- Solutions com vencimento em 06/09 casava, por valor, com um "BOLETO PAGO COUNTRY CLUB" de
-- 17/08. Ninguém paga boleto 20 dias adiantado; aquilo era coincidência de R$ 1.980,00. Sem
-- o nome pra confirmar, pagamento anterior a 10 dias do vencimento não vale.
--
-- A confiança decide se carimba ou se pergunta:
--   • `alta`  — valor exato + o nome do fornecedor aparece na descrição do extrato
--               ("BOLETO PAGO WHITE MARTIN" × WHITE MARTINS GASES). Carimba.
--   • `media` — valor exato, o par é único dos DOIS lados (aquela parcela só tem aquele
--               candidato e aquele lançamento só serve pra ela) e o pagamento não é
--               adiantado demais. Carimba.
--   • `baixa` — mais de um candidato e nenhum nome pra desempatar, ou adiantado sem nome.
--               NÃO carimba: escolher no par ou ímpar é pior do que deixar em aberto. Vai
--               pra fila de conferência.
--
-- Um lançamento paga UMA parcela e uma parcela é paga por UM lançamento. O laço é guloso,
-- na ordem "nome bate primeiro, depois menor distância de data", e queima os dois ids.
-- Sem isso, um PIX de R$ 1.160 quitaria as três parcelas de R$ 1.160 do mês.
--
-- ── O que este arquivo NÃO faz ────────────────────────────────────────────────────────────
--
-- Não cria lançamento nenhum. A parcela e o lançamento do banco são o MESMO dinheiro; criar
-- uma saída na baixa (o que `setPayableStatus` faz quando alguém paga na mão) dobraria a
-- despesa — o mesmo erro que [[crm_importar_vendas_financeiro]] evita do lado da receita.
-- E não toca em valor nem em data do extrato: conciliar é interpretação POR CIMA, ver
-- [[crm_rateio_extrato_nao_se_mexe]].

-- ────────────────────────────────────────────── carimbo de origem (e o desfazer)

alter table public.payable_installments
  add column if not exists auto_reconciled_at timestamptz,
  add column if not exists auto_reconciled_confidence text;

comment on column public.payable_installments.auto_reconciled_at is
  'Quando a conciliação automática deu esta parcela por paga. Null = foi gente. É o que '
  'permite listar "o robô fez isto" e desfazer sem caçar no histórico.';
comment on column public.payable_installments.auto_reconciled_confidence is
  '`alta` (nome do fornecedor bate no extrato) ou `media` (só valor e data, par único). '
  'Fica na tela: baixa automática sem etiqueta é baixa que ninguém confere.';

create index if not exists payable_installments_auto_rec_idx
  on public.payable_installments (tenant_id, auto_reconciled_at desc)
  where auto_reconciled_at is not null;

-- ────────────────────────────────────────────── normalização de texto

-- `unaccent` seria o certo, mas é STABLE e não pode entrar em índice (ver
-- [[crm_conciliacao_quem_e_quem_extrato]]). `translate` é IMMUTABLE e resolve o alfabeto
-- que aparece em razão social brasileira.
create or replace function public.crm_txt_chave(p text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(
    translate(
      coalesce(p, ''),
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'),
    '[^a-zA-Z]', '', 'g'))
$$;

comment on function public.crm_txt_chave(text) is
  'Texto reduzido a letras minúsculas sem acento. Serve pra comparar nome de fornecedor com '
  'a descrição do extrato, que vem truncada e em caixa alta.';

-- Os pedaços do nome que identificam o fornecedor. O extrato TRUNCA a razão social
-- ("BOLETO PAGO WHITE MARTIN"), então a comparação é por prefixo de token, nunca por
-- igualdade. Palavra de 4 letras fica de fora: "casa", "mais" e "nova" casam com meio mundo.
create or replace function public.crm_fornecedor_tokens(p_nome text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(t.tok), array[]::text[])
  from (
    select public.crm_txt_chave(w) as tok
    from unnest(regexp_split_to_array(coalesce(p_nome, ''), '[^[:alnum:]]+')) as w
  ) t
  where length(t.tok) >= 5
    and t.tok <> all (array[
      'ltda','limitada','eireli','comercio','comercial','distribuidora','distribuicao',
      'industria','industrial','produtos','produto','servicos','servico','importacao',
      'exportacao','representacoes','representacao','materiais','material','medicos',
      'medico','hospitalar','hospitalares','farmacia','manipulacao','brasil','filial',
      'grupo','sociedade','empresa','cirurgicos','cirurgica','equipamentos','solutions',
      'company','holding','participacoes','varejista','atacadista','eletronicos','digital',
      'ecommerce','tecnologia','nacional','nacionais'
    ])
$$;

comment on function public.crm_fornecedor_tokens(text) is
  'Tokens úteis da razão social (>=5 letras, sem as palavras que toda empresa tem). Vazio '
  'quando o nome é só sigla — aí a conciliação cai pra confiança `media` e o par tem que '
  'ser único dos dois lados.';

-- ────────────────────────────────────────────── o motor

drop function if exists public.crm_conciliar_auto(text, boolean);

create or replace function public.crm_conciliar_auto(p_tenant text, p_dry_run boolean default false)
returns table (
  parcela_id uuid,
  transacao_id uuid,
  confianca text,
  valor_cents bigint,
  vencimento date,
  pago_em date,
  dias integer,
  fornecedor text,
  extrato text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  usadas_parcelas uuid[] := array[]::uuid[];
  usados_lancamentos uuid[] := array[]::uuid[];
begin
  for r in
    with abertas as (
      select
        p.id,
        p.amount_cents,
        p.due_date,
        coalesce(nullif(btrim(s.name), ''), nullif(btrim(p.counterparty), ''), p.description) as fornecedor,
        public.crm_fornecedor_tokens(coalesce(s.name, p.counterparty, '')) as toks
      from public.payable_installments p
      left join public.stock_suppliers s on s.id = p.supplier_id
      where p.tenant_id = p_tenant
        and p.status = 'aberto'
    ),
    extrato as (
      -- Só o que já saiu da conta e ainda não explica nada. `reconciled_ref_id is null` é o
      -- que impede um lançamento de quitar duas parcelas em rodadas diferentes.
      select
        t.id,
        t.account_id,
        t.date,
        abs(t.amount_cents) as amt,
        t.description,
        public.crm_txt_chave(coalesce(t.description, '') || ' ' || coalesce(t.counterparty, '')) as chave
      from public.fin_transactions t
      where t.tenant_id = p_tenant
        and t.direction = 'out'
        and t.reconciled_ref_id is null
    ),
    pares as (
      select
        a.id as pid,
        e.id as tid,
        a.amount_cents,
        a.due_date,
        a.fornecedor,
        e.date as tdate,
        e.description as tdesc,
        e.account_id,
        (e.date - a.due_date) as gap,
        exists (
          select 1 from unnest(a.toks) k
          where position(left(k, 10) in e.chave) > 0
        ) as nome_bate
      from abertas a
      join extrato e
        on e.amt = a.amount_cents
       and e.date between a.due_date - 20 and a.due_date + 60
    ),
    por_parcela as (select pid, count(*) as n from pares group by pid),
    por_lancamento as (select tid, count(*) as n from pares group by tid)
    select
      pr.*,
      case
        when pr.nome_bate then 'alta'
        -- `gap >= -10`: sem o nome confirmando, pagamento muito antes do vencimento é
        -- coincidência de valor, não quitação.
        when pp.n = 1 and pl.n = 1 and pr.gap >= -10 then 'media'
        else 'baixa'
      end as confianca
    from pares pr
    join por_parcela pp on pp.pid = pr.pid
    join por_lancamento pl on pl.tid = pr.tid
    -- Quem tem nome escolhe primeiro; depois quem está mais perto da data. Assim o par bom
    -- reserva o lançamento antes do par duvidoso encostar nele.
    order by (case when pr.nome_bate then 0 else 1 end), abs(pr.gap), pr.pid
  loop
    continue when r.confianca = 'baixa';
    continue when r.pid = any (usadas_parcelas) or r.tid = any (usados_lancamentos);

    usadas_parcelas := usadas_parcelas || r.pid;
    usados_lancamentos := usados_lancamentos || r.tid;

    if not p_dry_run then
      update public.fin_transactions
         set reconciled_ref_type = 'payable',
             reconciled_ref_id = r.pid
       where id = r.tid;

      update public.payable_installments
         set status = 'pago',
             -- A data do pagamento é a do BANCO, nunca now(): carimbar a hora da conciliação
             -- joga a despesa pro mês errado.
             paid_at = (r.tdate::text || ' 12:00:00')::timestamptz,
             account_id = coalesce(account_id, r.account_id),
             auto_reconciled_at = now(),
             auto_reconciled_confidence = r.confianca,
             updated_at = now()
       where id = r.pid;
    end if;

    parcela_id := r.pid;
    transacao_id := r.tid;
    confianca := r.confianca;
    valor_cents := r.amount_cents;
    vencimento := r.due_date;
    pago_em := r.tdate;
    dias := r.gap;
    fornecedor := r.fornecedor;
    extrato := r.tdesc;
    return next;
  end loop;
end $$;

comment on function public.crm_conciliar_auto(text, boolean) is
  'Casa parcela em aberto com saída do extrato e dá a parcela por paga. `p_dry_run` devolve '
  'o que faria sem escrever nada. Tenant explícito porque o cron roda sem auth.uid().';

revoke all on function public.crm_conciliar_auto(text, boolean) from public, anon, authenticated;

-- ────────────────────────────────────────────── o que sobra pra gente

drop function if exists public.crm_conciliacao_pendentes();

create or replace function public.crm_conciliacao_pendentes()
returns table (
  parcela_id uuid,
  transacao_id uuid,
  motivo text,
  valor_cents bigint,
  valor_extrato_cents bigint,
  vencimento date,
  data_extrato date,
  dias integer,
  fornecedor text,
  extrato text
)
language sql
stable
security definer
set search_path = public
as $$
  with abertas as (
    select
      p.id,
      p.tenant_id,
      p.amount_cents,
      p.due_date,
      coalesce(nullif(btrim(s.name), ''), nullif(btrim(p.counterparty), ''), p.description) as fornecedor,
      public.crm_fornecedor_tokens(coalesce(s.name, p.counterparty, '')) as toks
    from public.payable_installments p
    left join public.stock_suppliers s on s.id = p.supplier_id
    where p.tenant_id = public.current_tenant_id()
      and p.status = 'aberto'
      and public.current_user_can_finance()
  ),
  extrato as (
    select
      t.id, t.date, abs(t.amount_cents) as amt, t.description,
      public.crm_txt_chave(coalesce(t.description, '') || ' ' || coalesce(t.counterparty, '')) as chave
    from public.fin_transactions t
    where t.tenant_id = public.current_tenant_id()
      and t.direction = 'out'
      and t.reconciled_ref_id is null
  ),
  -- 1) valor exato, mas sem nome que confirme: ou tem mais de um candidato, ou o pagamento
  --    é adiantado demais pra ser quitação. Os dois casos o motor se recusou a carimbar.
  ambiguo as (
    select
      a.id as pid, e.id as tid,
      case when e.date < a.due_date - 10
        then 'mesmo valor, mas pago muito antes do vencimento'
        else 'mesmo valor, mais de um candidato' end as motivo,
      a.amount_cents, e.amt, a.due_date, e.date, (e.date - a.due_date) as gap,
      a.fornecedor, e.description
    from abertas a
    join extrato e
      on e.amt = a.amount_cents
     and e.date between a.due_date - 20 and a.due_date + 60
    where not exists (
      select 1 from unnest(a.toks) k where position(left(k, 10) in e.chave) > 0
    )
  ),
  -- 2) pagamento pro mesmo fornecedor na janela, com valor diferente: juros, desconto,
  --    boleto agrupado. Aqui o valor não prova nada — só gente sabe. Mas esconder isso é o
  --    que faz a parcela envelhecer em aberto pra sempre.
  mesmo_nome as (
    select
      a.id as pid, e.id as tid,
      'mesmo fornecedor, valor diferente' as motivo,
      a.amount_cents, e.amt, a.due_date, e.date, (e.date - a.due_date) as gap,
      a.fornecedor, e.description
    from abertas a
    join extrato e
      on e.date between a.due_date - 30 and a.due_date + 75
     and e.amt <> a.amount_cents
     and exists (select 1 from unnest(a.toks) k where position(left(k, 10) in e.chave) > 0)
    where not exists (
      select 1 from extrato x
      where x.amt = a.amount_cents and x.date between a.due_date - 20 and a.due_date + 60
    )
  )
  -- No máximo 3 candidatos por parcela, os mais próximos da data. Um fornecedor de boleto
  -- semanal (Health Tech: 17 pagamentos na janela) enche a tela sozinho e transforma a fila
  -- de conferência em algo que ninguém abre.
  select pid, tid, motivo, amount_cents::bigint, amt::bigint, due_date, date, gap, fornecedor, description
  from (
    select u.*, row_number() over (partition by u.pid order by abs(u.gap), u.tid) as ordem
    from (select * from ambiguo union all select * from mesmo_nome) u
  ) r
  where r.ordem <= 3
  order by due_date, abs(gap)
  limit 500;
$$;

comment on function public.crm_conciliacao_pendentes() is
  'Os pares que a automação se recusou a carimbar: empate por valor sem nome, e pagamento ao '
  'mesmo fornecedor com valor diferente. É a fila de conferência da tela de conciliação.';

revoke all on function public.crm_conciliacao_pendentes() from public, anon;
grant execute on function public.crm_conciliacao_pendentes() to authenticated;

-- ────────────────────────────────────────────── as portas: tela e cron

-- Rodar na mão, no polo de quem está logado. Continua exigindo permissão de financeiro.
create or replace function public.crm_conciliar_auto_ui(p_dry_run boolean default false)
returns table (
  parcela_id uuid, transacao_id uuid, confianca text, valor_cents bigint,
  vencimento date, pago_em date, dias integer, fornecedor text, extrato text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;
  return query select * from public.crm_conciliar_auto(public.current_tenant_id(), p_dry_run);
end $$;

revoke all on function public.crm_conciliar_auto_ui(boolean) from public, anon;
grant execute on function public.crm_conciliar_auto_ui(boolean) to authenticated;

-- O que o motor já deu por pago. A tela precisa disto pra que a baixa automática seja
-- CONFERÍVEL: 88 parcelas mudarem de status sem lugar nenhum pra ver quais foram é o mesmo
-- que a regra de classificação em massa sem tela, que já custou caro aqui.
create or replace function public.crm_conciliacao_automaticas(p_limite integer default 200)
returns table (
  parcela_id uuid,
  confianca text,
  valor_cents bigint,
  vencimento date,
  pago_em date,
  fornecedor text,
  extrato text,
  conciliado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.auto_reconciled_confidence,
    p.amount_cents::bigint,
    p.due_date,
    (p.paid_at at time zone 'America/Sao_Paulo')::date,
    coalesce(nullif(btrim(s.name), ''), nullif(btrim(p.counterparty), ''), p.description),
    coalesce(t.description, ''),
    p.auto_reconciled_at
  from public.payable_installments p
  left join public.stock_suppliers s on s.id = p.supplier_id
  left join public.fin_transactions t
    on t.reconciled_ref_type = 'payable' and t.reconciled_ref_id = p.id
  where p.tenant_id = public.current_tenant_id()
    and p.auto_reconciled_at is not null
    and public.current_user_can_finance()
  order by p.auto_reconciled_at desc, p.due_date desc
  limit greatest(1, least(coalesce(p_limite, 200), 500));
$$;

revoke all on function public.crm_conciliacao_automaticas(integer) from public, anon;
grant execute on function public.crm_conciliacao_automaticas(integer) to authenticated;

-- Conciliar UM par à mão, da fila de conferência. Mesmo efeito do motor: liga o lançamento
-- à parcela e usa a data do BANCO como data de pagamento. Existe como RPC (em vez de dois
-- updates no navegador) pra "conciliar" significar a mesma coisa nos dois caminhos.
create or replace function public.crm_conciliacao_confirmar(p_parcela uuid, p_transacao uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant text := public.current_tenant_id();
  v_data date;
  v_conta uuid;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  -- `reconciled_ref_id is null` na condição: dois usuários na mesma fila não podem gastar o
  -- mesmo lançamento em duas parcelas.
  select t.date, t.account_id into v_data, v_conta
  from public.fin_transactions t
  where t.id = p_transacao
    and t.tenant_id = v_tenant
    and t.direction = 'out'
    and t.reconciled_ref_id is null;

  if v_data is null then
    return false;
  end if;

  update public.fin_transactions
     set reconciled_ref_type = 'payable', reconciled_ref_id = p_parcela
   where id = p_transacao and reconciled_ref_id is null;

  update public.payable_installments
     set status = 'pago',
         paid_at = (v_data::text || ' 12:00:00')::timestamptz,
         account_id = coalesce(account_id, v_conta),
         updated_at = now()
   where id = p_parcela and tenant_id = v_tenant and status = 'aberto';

  return true;
end $$;

revoke all on function public.crm_conciliacao_confirmar(uuid, uuid) from public, anon;
grant execute on function public.crm_conciliacao_confirmar(uuid, uuid) to authenticated;

-- Desfazer. Existe porque baixa automática sem desfazer é pior do que baixa nenhuma: no dia
-- que o motor errar, quem descobrir não tem como consertar sem SQL.
create or replace function public.crm_conciliacao_desfazer(p_parcela uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if not public.current_user_can_finance() then
    raise exception 'sem permissão de financeiro';
  end if;

  update public.fin_transactions
     set reconciled_ref_type = null, reconciled_ref_id = null
   where tenant_id = public.current_tenant_id()
     and reconciled_ref_type = 'payable'
     and reconciled_ref_id = p_parcela;

  update public.payable_installments
     set status = 'aberto',
         paid_at = null,
         auto_reconciled_at = null,
         auto_reconciled_confidence = null,
         updated_at = now()
   where tenant_id = public.current_tenant_id()
     and id = p_parcela;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.crm_conciliacao_desfazer(uuid) from public, anon;
grant execute on function public.crm_conciliacao_desfazer(uuid) to authenticated;

-- O cron. SQL puro em vez de edge function pelo mesmo motivo de `crm_estoque_alerts` e
-- `crm_banco_sync_health`: cron→edge esbarra nos gotchas de verify_jwt/401
-- (ver [[crm_cron_auth_gotcha]]) e aqui as duas tabelas moram no mesmo banco.
create or replace function public.crm_conciliar_auto_job()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  total integer := 0;
  n integer;
begin
  -- Só polo que tem extrato entrando. Sem conta de Open Finance não há o que conciliar, e
  -- varrer polo sem banco só gasta rodada.
  for t in
    select distinct a.tenant_id
    from public.fin_accounts a
    where a.active and a.of_account_id is not null
  loop
    select count(*) into n from public.crm_conciliar_auto(t.tenant_id, false);
    total := total + n;
  end loop;
  return total;
end $$;

revoke all on function public.crm_conciliar_auto_job() from public, anon, authenticated;

-- 20 minutos depois do sync bancário (`crm-banco-mcp-sync-job`, minuto 7): o extrato da hora
-- já entrou quando isto roda.
select cron.unschedule('crm-conciliar-auto-job')
where exists (select 1 from cron.job where jobname = 'crm-conciliar-auto-job');

select cron.schedule(
  'crm-conciliar-auto-job',
  '27 * * * *',
  $cron$ select public.crm_conciliar_auto_job() $cron$
);
