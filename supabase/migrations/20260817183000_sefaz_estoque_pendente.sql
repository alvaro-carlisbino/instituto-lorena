-- Nota completa lançada pelo servidor entra com o FINANCEIRO certo (documento + as duplicatas
-- reais do XML), mas sem estoque: o casamento de item com o catálogo mora no navegador e
-- duplicar aquela cascata aqui é o que estragou as cargas de julho e agosto.
--
-- Esta coluna é a fila do que falta: nota já lançada no financeiro, esperando entrada de estoque.
-- Sem ela, "importei tudo" seria lido como "o estoque está certo", que é justamente a leitura
-- errada que a tela de agosto foi desenhada pra evitar.
alter table public.sefaz_documentos
  add column if not exists estoque_pendente boolean not null default false;

create index if not exists sefaz_documentos_estoque_pendente_idx
  on public.sefaz_documentos (tenant_id) where estoque_pendente;
