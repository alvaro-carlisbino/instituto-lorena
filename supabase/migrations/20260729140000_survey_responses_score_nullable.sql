-- Avaliação só com comentário deixa de ser perdida em silêncio.
--
-- O webhook do ManyChat aceita nota E/OU comentário (a checagem é
-- `if (score === null && !comment) return 400`), mas `survey_responses.score` era
-- `integer NOT NULL`. Um envio só com comentário violava a restrição (23502) e, como o
-- supabase-js devolve `{ data, error }` em vez de lançar, o `try/catch` do webhook não
-- pegava nada: o código seguia adiante, gravava a avaliação na ficha do lead, agradecia
-- o cliente pelo WhatsApp e respondia `ok: true`. A nota nunca chegava ao painel.
--
-- Materializou em produção: das 4 avaliações registradas na ficha dos leads, só 3 estão
-- em `survey_responses`.
--
-- O front JÁ trata nota ausente em todos os pontos (`score: number | null`, e cada
-- agregação de NPS guarda com `score != null`), então soltar a restrição não altera
-- nenhum cálculo: comentário sem nota entra como comentário e fica fora da média.
alter table public.survey_responses
  alter column score drop not null;

comment on column public.survey_responses.score is
  'Nota de 0 a 10. NULO quando o cliente respondeu só com comentário: conta como feedback, mas fica fora da média e da divisão promotor/neutro/detrator.';
