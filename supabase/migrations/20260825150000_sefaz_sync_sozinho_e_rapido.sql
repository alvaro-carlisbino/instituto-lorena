-- SEFAZ: a rodada que não fazia nada levava 25 SEGUNDOS, e por isso ninguém confiava nela.
--
-- Medido em 25/ago contra produção, com a base já em dia (0 nota nova, 0 XML pra baixar, 0
-- lançamento): **24,8s**. Não é a SEFAZ lenta nem a Focus — é a própria função refazendo
-- trabalho já feito, toda vez:
--
--   1. `listarRecebidas` relia a JANELA INTEIRA da Focus a cada rodada. 374 linhas em 4
--      páginas de 100, das quais 284 distintas — todas já capturadas desde 17/ago.
--   2. O laço "adota o que já entrou por fora" fazia **um UPDATE por nota lançada**, em
--      sequência, contra o PostgREST: 340 idas e voltas para descobrir que não havia nada a
--      adotar. Esse laço nunca teve teto de tempo, então crescia junto com o histórico —
--      quanto mais a clínica lança, mais lenta fica a rodada que não tem o que fazer.
--
-- O efeito na tela: o botão "Sincronizar agora" ficava 25s a 110s girando. Quem clica duas
-- vezes acha que travou, e "não sincroniza" vira a conclusão — quando na verdade sincroniza,
-- devagar, e o cron de 2x/dia deixava a nota nova esperando até 12 horas.
--
-- Esta migration resolve o item 2 e dá o lugar onde o item 1 guarda a marca d'água.
--
-- ── 1. Onde parou a leitura da Focus ──────────────────────────────────────────────────────
--
-- `GET /v2/nfes_recebidas` pagina por `versao` e responde `X-Max-Version`. Pedir a partir da
-- última versão lida devolve só o que mudou — e "mudou" inclui a nota que ganhou versão nova
-- porque o XML completo ficou disponível, que é exatamente o que a captura precisa ver.
--
-- A marca d'água avança POR PÁGINA, depois de gravar a página. Rodada que morre no meio deixa
-- a marca no que de fato entrou; a seguinte continua dali, sem buraco.
--
-- `varredura_completa_em` existe porque marca d'água é aposta: se a Focus renumerar versão, ou
-- se uma rodada gravar e não avançar, o incremental nunca mais enxerga aquela nota. Uma vez por
-- dia a rodada ignora a marca e relê a janela inteira. Custa os mesmos 25s de antes, uma vez
-- por dia, de madrugada, sem ninguém olhando.
create table if not exists public.sefaz_sync_state (
  tenant_id text primary key,
  versao bigint not null default 0,
  varredura_completa_em timestamptz,
  ultima_rodada_em timestamptz,
  ultimo_resultado jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.sefaz_sync_state is
  'Onde a leitura da Focus parou por polo. `versao` = X-Max-Version já gravado; a rodada pede a partir dele em vez de reler a janela toda. `varredura_completa_em` força uma releitura completa por dia.';

alter table public.sefaz_sync_state enable row level security;

-- Leitura pela equipe do polo: o painel mostra QUANDO a última rodada foi, que é o que
-- transforma "não sincroniza" em algo conferível. Escrita é só do servidor (service_role
-- ignora RLS) — não há política de insert/update de propósito.
drop policy if exists "sefaz_sync_state tenant read" on public.sefaz_sync_state;
create policy "sefaz_sync_state tenant read" on public.sefaz_sync_state
  for select using (tenant_id = current_tenant_id());

-- ── 2. A adoção, em UMA instrução ─────────────────────────────────────────────────────────
--
-- Nota lançada por fora (upload manual de XML, ZIP do contador, painel) precisa ser marcada
-- como lançada no staging, senão a rodada seguinte tenta lançar de novo e toma erro de chave
-- duplicada em vez de reconhecer o serviço feito.
--
-- Isso é um join, não um laço: `UPDATE ... FROM` casa as duas tabelas por `nfe_key` dentro do
-- banco. 340 idas e voltas viram uma. O `status = 'novo'` no filtro é o que torna a chamada
-- idempotente e barata quando não há nada a adotar — que é o caso comum.
--
-- SECURITY DEFINER porque quem chama é o service_role da edge function, mas `p_tenant` vem do
-- chamador: sem o filtro por polo isto adotaria nota de outro negócio. Revogado de anon e
-- authenticated — ninguém no navegador tem o que fazer com isto (ver a RPC aberta pra anon que
-- vazou nome+CPF de paciente).
create or replace function public.crm_sefaz_adotar_lancadas(p_tenant text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_adotadas integer;
begin
  if coalesce(trim(p_tenant), '') = '' then
    raise exception 'crm_sefaz_adotar_lancadas: polo obrigatório';
  end if;

  update public.sefaz_documentos d
     set status     = 'lancado',
         invoice_id = i.id,
         updated_at = now()
    from public.purchase_invoices i
   where i.tenant_id = p_tenant
     and d.tenant_id = p_tenant
     and i.nfe_key   = d.chave
     and d.status    = 'novo';

  get diagnostics v_adotadas = row_count;
  return v_adotadas;
end;
$$;

revoke all on function public.crm_sefaz_adotar_lancadas(text) from public, anon, authenticated;
grant execute on function public.crm_sefaz_adotar_lancadas(text) to service_role;

-- ── 3. De 2x por dia para de hora em hora ─────────────────────────────────────────────────
--
-- Com a rodada incremental custando segundos em vez de meio minuto, não há razão para a nota
-- do fornecedor esperar até 12 horas para aparecer. O minuto 25 fica: o casamento com o
-- extrato roda no 27, então a nota que entrou já sai conciliada dois minutos depois, na mesma
-- hora — em vez de esperar a próxima virada.
--
-- `orcamentoMs` continua em 100s: é teto, não duração. Rodada rotineira nem chega perto.
select cron.unschedule('crm-sefaz-sync-job') where exists (
  select 1 from cron.job where jobname = 'crm-sefaz-sync-job'
);

select cron.schedule(
  'crm-sefaz-sync-job',
  '25 * * * *',
  $cron$
  select net.http_post(
    url := 'https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-sefaz-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select secret from public.app_cron_secrets where key = 'sefaz'), '')
    ),
    body := '{"orcamentoMs":100000}'::jsonb,
    timeout_milliseconds := 145000
  );
  $cron$
);
