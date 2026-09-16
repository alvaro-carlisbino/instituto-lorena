-- A Sofia para de prometer "em instantes" quando a Aline só chega no dia seguinte.
--
-- Leitura de 356 conversas em 16/09/2026 (painel "Raio-X do Fechamento"): 145 encaminhamentos
-- da Sofia para a equipe em 30 dias, 61% FORA do expediente. O texto do Passo 3 promete que a
-- Aline passa os detalhes "em instantes"; fora do turno a primeira palavra humana veio, em
-- mediana, 12h depois (46h no fim de semana), e só 2 de 59 desses leads marcaram consulta,
-- contra 12 de 57 dos encaminhados dentro do turno. Em 18 conversas a promessa nem foi cumprida.
--
-- O que muda no prompt:
--   1. As frases de encaminhamento perdem o "em instantes".
--   2. Regra nova no Passo 3: dizer QUANDO a Aline chama, pelo contexto temporal que o
--      `crm-ai-assistant` já injeta ("estamos DENTRO/FORA do horário comercial"), e, fora do
--      turno, perguntar o melhor dia e período para a Aline chegar com horários.
--   3. Nome: "Certo, Maringá!" e saudação com e-mail apareceram na leitura. Só nome de gente.
--
-- Backup do prompt anterior em `crm_ai_configs_backup_20260916`, no padrão dos anteriores.

create table if not exists public.crm_ai_configs_backup_20260916 as
  select * from public.crm_ai_configs where tenant_id = 'instituto-lorena';
alter table public.crm_ai_configs_backup_20260916 enable row level security;
revoke all on public.crm_ai_configs_backup_20260916 from anon, authenticated;

do $migration$
declare
  p text;

  a_encaminhar constant text :=
    '> Vou encaminhar seu atendimento para a nossa consultora **Aline Fenato**, que irá confirmar o melhor horário disponível e te passar todos os detalhes da sua consulta em instantes.';

  a_sem_preferencia constant text :=
    '> Ela confirma o melhor horário disponível, te diz qual profissional vai te atender e passa todos os detalhes da sua consulta em instantes.';

  a_passo3 constant text := '### Passo 3 — Apresentação do médico e encaminhamento
';

  a_nome constant text := '- Use o nome do paciente sempre que souber.';
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  if position(a_encaminhar in p) = 0 then
    raise exception 'âncora da frase de ENCAMINHAMENTO sumiu, revisar antes de aplicar';
  end if;
  p := replace(p, a_encaminhar,
    '> Vou encaminhar seu atendimento para a nossa consultora **Aline Fenato**, que vai confirmar o melhor horário disponível e te passar todos os detalhes da sua consulta.');

  if position(a_sem_preferencia in p) = 0 then
    raise exception 'âncora do bloco SEM PREFERÊNCIA sumiu, revisar antes de aplicar';
  end if;
  p := replace(p, a_sem_preferencia,
    '> Ela confirma o melhor horário disponível, te diz qual profissional vai te atender e passa todos os detalhes da sua consulta.');

  if position(a_passo3 in p) = 0 then
    raise exception 'âncora do título do PASSO 3 sumiu, revisar antes de aplicar';
  end if;
  p := replace(p, a_passo3, a_passo3 || '
**Quando a Aline chama (vale para TODA mensagem de encaminhamento abaixo).** O paciente precisa saber quando vai ser atendido. Olhe o contexto temporal e complete a frase da Aline com o momento real:

- **Dentro do horário comercial:** "ela já te chama por aqui".
- **Fora do horário:** nunca escreva "em instantes", "em breve" nem "já já". Diga quando a Aline começa:
  - segunda a quinta, depois das 18h → "amanhã cedo, a partir das 8h"
  - sexta, depois das 18h → "amanhã (sábado), a partir das 8h"
  - sábado depois das 12h, ou domingo → "na segunda, a partir das 8h"
  - dia útil antes das 8h → "hoje, a partir das 8h"
- **Fora do horário, na mesma mensagem**, pergunte uma vez só: "Pra ela já chegar com horários pra você: qual dia e período ficam melhores?" Isso não segura o encaminhamento: envie `[PRONTO_PARA_CONSULTOR]` do mesmo jeito.

Promessa de "em instantes" que chega no dia seguinte é o que mais faz o paciente desistir antes da consulta.
');

  if position(a_nome in p) = 0 then
    raise exception 'âncora da regra de NOME sumiu, revisar antes de aplicar';
  end if;
  p := replace(p, a_nome,
    '- Use o primeiro nome do paciente quando ele for claramente um nome de gente. **Nunca** chame a pessoa pelo nome da cidade ("Certo, Maringá!"), por e-mail, por número ou por apelido do perfil. Na dúvida, escreva sem nome.');

  -- O prompt já esteve cortado no meio de uma frase por edição pela tela.
  if length(p) < 15000 then
    raise exception 'prompt ficou curto demais (% caracteres), abortando', length(p);
  end if;
  -- A regra nova CITA "em instantes" (para proibir), então a checagem é das frases antigas.
  if position(a_encaminhar in p) > 0 or position(a_sem_preferencia in p) > 0 then
    raise exception 'ainda sobrou promessa de "em instantes" nos blocos do Passo 3, abortando';
  end if;
  if position('Quando a Aline chama' in p) = 0 then
    raise exception 'regra de quando a Aline chama não entrou, abortando';
  end if;

  update crm_ai_configs
     set system_prompt = p, updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  raise notice 'prompt atualizado: % caracteres', length(p);
end
$migration$;
