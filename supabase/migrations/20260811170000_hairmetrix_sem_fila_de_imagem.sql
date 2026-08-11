-- Desfaz a fila de imagem criada horas antes, no mesmo dia.
--
-- A decisão do Álvaro (11/08/2026): a foto não sobe. Mesmo com a fila sob demanda,
-- foto de tricoscopia é storage do Supabase para sempre, e o valor dela na consulta
-- pode ser entregue de outro jeito — montando a leitura visual a partir das medidas
-- que já estão no banco. Ver src/lib/campoFolicular.ts e src/lib/feixeDeFios.ts.
--
-- Migration é forward-only: a de trás fica no histórico, esta desfaz. Reescrever a
-- anterior esconderia que a tabela existiu em produção por algumas horas.

drop function if exists public.hairmetrix_pedir_imagens(uuid);
drop function if exists public.hairmetrix_imagens_paciente(uuid);
drop table if exists public.hairmetrix_pedidos_imagem;

-- A policy de select no bucket FICA. `hairmetrix_imagens` continua existindo e a
-- edge function ainda aceita `action: 'imagem'`; sem a policy, uma foto avulsa que
-- alguém suba um dia ficaria ilegível para todo mundo.
