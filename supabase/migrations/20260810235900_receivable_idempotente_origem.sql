-- Importação de venda (Shosp / planilha da recepção) para contas a receber.
--
-- Duas colunas, e as duas existem por um motivo que já custou dinheiro em outros importadores
-- deste sistema:
--
--   external_id  — a MESMA venda importada duas vezes não pode virar duas contas a receber.
--     O relatório do Shosp é exportado à mão e reexportado quando alguém corrige um
--     lançamento; sem chave, a segunda importação do mês dobra o faturamento. A chave é a
--     identidade da venda na origem: 'shosp:<Cod>' e 'lion:<aaaa-mm-dd>:<linha>:<coluna>'.
--     Ver [[crm_nfe_chave_trava_reimport]], que é exatamente o mesmo erro em outra tela.
--
--   source       — de onde veio. Sem isto não dá pra reimportar corrigindo: apagar "o que
--     veio do Shosp em julho" precisa saber o que veio do Shosp.
--
-- Por que conta a RECEBER e não lançamento de caixa: o extrato do banco já entra sozinho em
-- fin_transactions (Open Finance, 3x/dia). Lançar a venda lá também contaria o mesmo dinheiro
-- duas vezes. A venda é o direito de receber; o extrato é o dinheiro; a conciliação amarra os
-- dois. Único caso em que a venda também vira lançamento: caixa SEM extrato (dinheiro em
-- espécie, conta de terceiro) — lá não existe feed nenhum pra casar.

alter table public.fin_receivables
  add column if not exists external_id text,
  add column if not exists source      text;

comment on column public.fin_receivables.external_id is
  'Identidade da venda na origem (ex.: shosp:10316). Reimportar o mesmo arquivo atualiza a '
  'linha em vez de criar outra. Nulo em conta a receber criada na mão.';
comment on column public.fin_receivables.source is
  'Origem do registro: shosp | lion | manual. Permite reimportar um mês corrigindo, sem '
  'varrer o que foi lançado na mão.';

-- Índice único SIMPLES, não parcial, de propósito: parcial não pode ser alvo de ON CONFLICT
-- pelo PostgREST, e não precisa ser — no Postgres NULL é distinto de NULL em índice único,
-- então conta a receber criada na mão (external_id nulo) continua podendo existir aos montes.
create unique index if not exists fin_receivables_external_uk
  on public.fin_receivables (tenant_id, external_id);

create index if not exists fin_receivables_source_idx
  on public.fin_receivables (tenant_id, source, due_date);
