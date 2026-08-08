-- Chave de acesso da NF-e (44 dígitos) na nota de compra.
--
-- Por que: o import por XML só sabia comparar número da nota, e número se repete entre
-- fornecedores. Em julho o backlog da clínica entrou por dois caminhos diferentes (carga em
-- lote e upload pela tela) e três notas da ENIFAR deram entrada DUAS vezes no estoque.
-- A chave é única por definição (UF + CNPJ + modelo + série + número + código), então o
-- índice abaixo torna a repetição impossível em vez de depender de quem está importando.

alter table public.purchase_invoices
  add column if not exists nfe_key text;

comment on column public.purchase_invoices.nfe_key is
  'Chave de acesso da NF-e (44 dígitos, do Id de infNFe). Única por polo — trava reimportação.';

-- Parcial: nota lançada na mão continua sem chave e não colide com as outras.
create unique index if not exists purchase_invoices_nfe_key_uniq
  on public.purchase_invoices (tenant_id, nfe_key)
  where nfe_key is not null;
