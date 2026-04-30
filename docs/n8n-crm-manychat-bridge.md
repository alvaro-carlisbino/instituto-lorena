# n8n + CRM: migrar a triagem IA para o Supabase

> **Estado actual do produto:** Instagram + IA correm **só no CRM** (ManyChat → `crm-manychat-webhook` → Supabase / Z.ai). **Não precisas de n8n** para arrancar. Este documento e o JSON em `integrations/n8n/` ficam como **referência de migração** a partir do fluxo antigo.

---

O export [integrations/n8n/workflows/Instituto_Lorena_Visentainer_FIXED.json](../integrations/n8n/workflows/Instituto_Lorena_Visentainer_FIXED.json) fazia:

1. **Webhook** (payload ManyChat: `body.data.id` = subscriber, `body.msg` = texto).
2. **Debounce** em Postgres (`lorena_debounce`) + espera 6s + “sou o último?” — evita disparar a IA a cada tecla.
3. **ManyChat API** `subscriber/getInfo` + código **Montar contexto** (nome, cidade, tags).
4. **AI Agent** (OpenAI `gpt-4o`) + memória `n8n_chat_histories_lorena`.
5. **Detectar intenção** (`[PRONTO_PARA_CONSULTOR]`) → ramos erro / normal / handoff → **setCustomField** + **sendFlow**.

Se **ainda** usares n8n, faz sentido **manter no n8n** só o que for orquestração extra (debounce, flows) e **mover para o CRM** a IA + histórico + Kanban via `crm-manychat-webhook`. Quem **não** usa n8n faz tudo no ManyChat + Supabase conforme [manychat-setup.md](manychat-setup.md).

## Arquitetura alvo

```mermaid
flowchart LR
  MC[ManyChat]
  N8[n8n_webhook]
  DB[(lorena_debounce_opcional)]
  CRM[crm_manychat_webhook]
  MC2[ManyChat_setField_sendFlow]

  MC --> N8
  N8 --> DB
  DB --> CRM
  CRM -->|JSON_reply_handoff| N8
  N8 --> MC2
```

### Variante: Z.ai **Coding Plan** no n8n (CRM só histórico + lead)

Quando a resposta síncrona `action: message` não serve (ex. **Coding Plan** só no n8n, ou evitar `already_processed` ao reutilizar o mesmo id de teste):

```mermaid
flowchart LR
  MC[ManyChat]
  N8[n8n]
  CRM1[CRM_ingest]
  Z[Z.ai_Coding_Plan]
  MC2[ManyChat_sendFlow]
  CRM2[CRM_record_outbound]

  MC --> N8
  N8 -->|POST action ingest| CRM1
  N8 --> Z
  Z -->|texto| MC2
  MC2 --> MC
  N8 -->|POST action record_outbound| CRM2
```

1. **HTTP Request** → `crm-manychat-webhook` com `"action":"ingest"`, `subscriber_id`, `user_name`, `text` (mesmo header `x-manychat-crm-secret`).
2. Nó **Z.ai** (Coding Plan) com o prompt/contexto que já usavas.
3. **ManyChat**: `setCustomField` + **sendFlow** (ou API dinâmica) com o texto gerado.
4. **HTTP Request** → `crm-manychat-webhook` com `"action":"record_outbound"`, `subscriber_id`, `reply` (texto enviado), opcional `lead_id` do passo 1.

Contrato: [crm-external-http-api.md](crm-external-http-api.md) §1.3–1.4.

## 1. System prompt no CRM

Copia o texto longo do **AI Agent** (system message do Instituto Lorena) para o registo **`crm_ai_configs`** (`system_prompt` do id `default`) no Supabase, ou usa `prompt_override` por lead em `crm_conversation_states` quando precisares de exceções.

Assim o modelo passa a ser o configurado no CRM (ex. Z.ai via `crm-ai-assistant`), alinhado ao WhatsApp.

## 2. Substituir “Montar contexto” → HTTP Request (CRM)

Depois do nó **Deletar e recuperar msgs** (ou equivalente com `msg` + `subscriberId` + `fullName`):

- **Método:** `POST`
- **URL:** `https://<PROJECT>.supabase.co/functions/v1/crm-manychat-webhook`
- **Headers:**
  - `Content-Type: application/json`
  - `x-manychat-crm-secret: <MANYCHAT_CRM_SECRET>`

**Body (JSON)** — espelha o que o código “Montar contexto” já produz:

```json
{
  "subscriber_id": "={{ $json.subscriberId }}",
  "user_name": "={{ $json.fullName }}",
  "text": "={{ $json.msg }}",
  "external_message_id": "={{ $execution.id }}",
  "context_append": "={{ $json.userContext }}"
}
```

- `text`: mensagem (ou bloco debounced) do cliente.
- `context_append`: mesmo conteúdo que hoje vai em `userContext` (nome, cidade, tags ManyChat). O CRM junta isto **só** ao pedido à IA; a interação “in” no CRM guarda apenas `text` visível no chat.

**Resposta:**

| Campo | Uso no n8n |
|--------|------------|
| `reply` | Texto limpo para **setCustomField** / mensagem ao utilizador |
| `handoff_suggested` | `true` quando a IA usou a tag `[PRONTO_PARA_CONSULTOR]` (removida do `reply` antes de devolver) — substitui o nó **Detectar intenção** para o ramo consultor |
| `leadId` | Opcional: gravar em custom field ManyChat ou chamar outra tool CRM |

## 3. Nós a desligar / simplificar

- **AI Agent**, **OpenAI Chat Model**, **Postgres Chat Memory** — removidos depois da migração (o histórico de negócio fica em `interactions` + assistente CRM).
- **Detectar intenção** — opcional: podes usar só `{{ $json.handoff_suggested }}` na resposta HTTP (se o n8n parsear o body da última chamada).

## 4. Manter no n8n

- Webhook + debounce (ou migrar debounce para Supabase numa fase 2).
- **Buscar dados do usuário** ManyChat (se quiseres enriquecer `context_append` além do CRM).
- **Salvar resposta** + **sendFlow** (IDs de custom field e `flow_ns` continuam iguais ao fluxo atual).
- **Gerar resumo para consultor** — podes manter ou, noutra fase, gravar `consultorSummary` num campo do lead via novo endpoint ou `crm-ingest-webhook` estendido.

## 5. Contrato completo

Ver também [crm-external-http-api.md](crm-external-http-api.md) (secção `crm-manychat-webhook`).
