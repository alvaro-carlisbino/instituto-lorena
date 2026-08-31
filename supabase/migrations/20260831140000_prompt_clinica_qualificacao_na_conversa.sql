-- A qualificação entra no FLUXO do prompt, não só nas regras de op do código.
--
-- A instrução de perguntar cidade e prazo e emitir <<<CRM_OPS>>> qualificar_lead
-- vive em `crm-ai-assistant/index.ts`, junto das outras regras de op. Só que o
-- fluxo de atendimento mora aqui, no banco, e ele é lido na mesma mensagem. Se
-- o fluxo não citar a qualificação, a Sofia segue o roteiro do banco (Passo 1 →
-- Passo 2 → Passo 3 → encaminha) e a pergunta nunca acontece.
--
-- É a armadilha de 17/08 de novo ([[crm_agenda_lorena_regra_no_prompt]]): regra
-- em prosa espalhada em pontos que precisam mudar juntos.
--
-- O lugar da pergunta é entre o direcionamento e o encaminhamento: o paciente
-- já sabe com quem vai, e a resposta é o que a Aline precisa para priorizar.

do $migration$
declare
  p text;
  anchor_passo3 constant text := '### Passo 3 — Apresentação do médico e encaminhamento';
  anchor_resumo constant text := 'Passo 2: Direcionamento do médico — NUNCA pergunte qual médico';
begin
  select system_prompt into p from crm_ai_configs where tenant_id = 'instituto-lorena' and id = 'default';
  if p is null then
    raise exception 'crm_ai_configs (instituto-lorena/default) não encontrado';
  end if;

  if position(anchor_passo3 in p) = 0 then
    raise exception 'âncora do Passo 3 sumiu — revisar antes de aplicar';
  end if;

  p := replace(p, anchor_passo3, $novo$### Passo 2b — As duas perguntas que a Aline precisa

Antes de encaminhar, você pergunta **a cidade** e **o prazo**, numa mensagem só e com naturalidade:

> Só pra já deixar tudo certinho com a Aline: você é de Maringá, de Londrina ou de outra cidade? 😊
> E tá pensando em fazer nos próximos meses, ou ainda tá pesquisando?

**Pergunte UMA vez.** Se ele responder só uma das duas, siga com o que veio e não insista: essas perguntas servem para a Aline chegar sabendo, e **nunca** podem segurar o encaminhamento. Se ele ignorar as duas e já pedir para falar com alguém, encaminhe do mesmo jeito.

Depois de perguntar, siga direto para o Passo 3 na mesma conversa.

---

$novo$ || anchor_passo3);

  if position(anchor_resumo in p) = 0 then
    raise exception 'âncora do fluxo resumido sumiu — revisar antes de aplicar';
  end if;
  p := replace(p, anchor_resumo, 'Passo 2b: perguntar CIDADE e PRAZO (uma vez só, nunca segura o encaminhamento)
  ↓
Passo 2: Direcionamento do médico — NUNCA pergunte qual médico');

  update crm_ai_configs
     set system_prompt = p, updated_at = now()
   where tenant_id = 'instituto-lorena' and id = 'default';

  if position('Passo 2b' in p) = 0 then
    raise exception 'Passo 2b não entrou no prompt — abortando';
  end if;

  raise notice 'qualificação no fluxo: % caracteres', length(p);
end
$migration$;
