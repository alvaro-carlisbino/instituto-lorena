-- Staging do que a SEFAZ tem contra o CNPJ do polo.
--
-- Existe por causa de um prazo que não é nosso: a SEFAZ guarda o documento ~90 dias, mas o XML
-- COMPLETO só existe se houve ciência da operação nos 10 dias da emissão. Perdeu, o XML nunca
-- mais volta e sobra o resumo. Então a captura (guardar o XML enquanto ele existe) tem que ser
-- diária e automática, e o lançamento pode acontecer depois sem relógio correndo.
--
-- tenant_id NÃO tem default current_tenant_id(): quem escreve aqui é o cron por service_role,
-- e nesse contexto auth.uid() é nulo, então o default sairia nulo. O polo vem explícito.
create table if not exists public.sefaz_documentos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      text not null,
  chave          text not null,
  numero         text,
  emitente       text,
  cnpj_emitente  text,
  valor_cents    integer not null default 0,
  data_emissao   date,
  situacao       text,
  manifestacao   text,
  -- O que a Focus diz: se o XML inteiro (com itens) está disponível.
  xml_completo   boolean not null default false,
  -- O XML cru, guardado no momento em que ainda existia. É o ativo irreversível.
  xml            text,
  xml_baixado_em timestamptz,
  -- novo = capturado, não lançado. lancado = virou purchase_invoice.
  -- ignorado = decisão humana (nota indevida contra o CNPJ). erro = falhou, com motivo.
  status         text not null default 'novo'
                 check (status in ('novo', 'lancado', 'ignorado', 'erro')),
  invoice_id     uuid references public.purchase_invoices(id) on delete set null,
  erro           text,
  -- Primeira vez que a SEFAZ mostrou esta nota. Serve pra medir o atraso do lançamento.
  visto_em       timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- A chave é a única comparação confiável: número de nota se repete entre fornecedores, e dois
-- "NF 3035" diferentes já derrubaram um lote inteiro em julho.
create unique index if not exists sefaz_documentos_tenant_chave_uniq
  on public.sefaz_documentos (tenant_id, chave);

create index if not exists sefaz_documentos_tenant_status_idx
  on public.sefaz_documentos (tenant_id, status);

-- Fila da captura: nota completa cujo XML ainda não foi guardado. É a consulta quente do cron.
create index if not exists sefaz_documentos_xml_pendente_idx
  on public.sefaz_documentos (tenant_id)
  where xml_completo and xml is null;

alter table public.sefaz_documentos enable row level security;

drop policy if exists "sefaz_documentos tenant read"   on public.sefaz_documentos;
drop policy if exists "sefaz_documentos tenant insert" on public.sefaz_documentos;
drop policy if exists "sefaz_documentos tenant update" on public.sefaz_documentos;
drop policy if exists "sefaz_documentos tenant delete" on public.sefaz_documentos;

create policy "sefaz_documentos tenant read"   on public.sefaz_documentos
  for select using (tenant_id = current_tenant_id());
create policy "sefaz_documentos tenant insert" on public.sefaz_documentos
  for insert with check (tenant_id = current_tenant_id());
create policy "sefaz_documentos tenant update" on public.sefaz_documentos
  for update using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id());
create policy "sefaz_documentos tenant delete" on public.sefaz_documentos
  for delete using (tenant_id = current_tenant_id());

-- Produto que nasceu de import automático fica marcado. O ensaio de 14/ago mostrou que metade
-- do que a NF-e cria não é estoque clínico (whisky, Bíblia, Smart TV, frigideira): é compra de
-- obra e pessoal. Sem a marca, isso some no meio de 1.068 itens e ninguém acha depois.
alter table public.stock_items
  add column if not exists needs_review boolean not null default false;

create index if not exists stock_items_needs_review_idx
  on public.stock_items (tenant_id) where needs_review;
