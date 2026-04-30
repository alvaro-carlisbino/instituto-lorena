# Tools HTTP do CRM para o n8n (ManyChat + Z.ai no n8n)

Este guia descreve como usar o **n8n** como orquestrador (debounce, AI Agent com **Z.ai**, ramos ManyChat) e o **Supabase** como **fonte de verdade** do lead e do histórico (`interactions`), sem depender da IA automática da Edge.

**URL base:** `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/crm-manychat-webhook`

**Header em todos os pedidos**

- `Content-Type: application/json`
- `x-manychat-crm-secret`: valor do secret `MANYCHAT_CRM_SECRET` (igual ao ManyChat se o n8n for chamado pelo ManyChat com o mesmo secret, ou um secret dedicado ao n8n se duplicares a credencial no workflow).

Contrato geral e erros: [crm-external-http-api.md](crm-external-http-api.md) §1.

---

## Fluxo recomendado (alto nível)

1. **ManyChat** → **Webhook n8n** (payload com `subscriber_id`, texto, nome, tags — como no export [Instituto_Lorena_Visentainer_FIXED.json](../integrations/n8n/workflows/Instituto_Lorena_Visentainer_FIXED.json)).
2. **Debounce** (Postgres + Wait, Smart Delay no ManyChat, ou ambos) até teres o texto final do utilizador.
3. **`crm_ingest`** — `POST` com `"action":"ingest"` grava lead + mensagem **entrada** no CRM (sem IA no Supabase).
4. **`crm_get_thread`** — `POST` com `"action":"get_thread"` obtém `interactions` ordenadas; montas o prompt para o nó **Z.ai** / OpenAI Compatible no n8n.
5. **ManyChat** — `setCustomField` + `sendFlow` (ou só API ManyChat) com a resposta do modelo.
6. **`crm_record_outbound`** — `POST` com `"action":"record_outbound"` e o mesmo `reply` enviado ao cliente para o Kanban reflectir a conversa.

Opcional: **`crm_merge_phone`** quando o utilizador partilha telefone no DM — [crm-external-http-api.md](crm-external-http-api.md) §1.2.

---

## Catálogo de tools (mapear para HTTP Request no n8n)

Cada “tool” é um `POST` ao mesmo endpoint; distingue-se pelo campo **`action`**.

| Nome sugerido (tool) | `action` | Objetivo |
|----------------------|----------|-----------|
| `crm_ingest` | `ingest` | Criar/atualizar lead ManyChat + gravar mensagem **in** |
| `crm_get_thread` | `get_thread` | Ler últimas `interactions` para contexto do modelo |
| `crm_record_outbound` | `record_outbound` | Gravar mensagem **out** depois de enviares ao Instagram |
| `crm_merge_phone` | `merge_phone` | Fundir lead sintético IG com lead por telefone |

### Tool `crm_ingest`

```json
{
  "action": "ingest",
  "subscriber_id": "{{ $json.subscriberId }}",
  "user_name": "{{ $json.fullName }}",
  "text": "{{ $json.msg }}",
  "phone": "{{ $json.phoneOptional }}",
  "context_append": "{{ $json.userContext }}"
}
```

- `context_append` é **opcional**; no `ingest` o CRM grava em `interactions` apenas o campo **`text`** (não duplica o append na linha “in”).

Resposta útil: **`leadId`**.

### Tool `crm_get_thread`

```json
{
  "action": "get_thread",
  "subscriber_id": "{{ $json.subscriberId }}",
  "limit": 40
}
```

Ou, se já guardaste o `leadId` do ingest: `{ "action": "get_thread", "lead_id": "{{ $json.leadId }}", "limit": 40 }`.

Resposta: **`interactions`** (ordenadas do mais antigo ao mais recente). Formata no Code node para texto tipo chat antes de enviar ao Z.ai.

### Tool `crm_record_outbound`

```json
{
  "action": "record_outbound",
  "subscriber_id": "{{ $json.subscriberId }}",
  "user_name": "{{ $json.fullName }}",
  "reply": "{{ $json.aiReply }}",
  "lead_id": "{{ $json.leadId }}"
}
```

- `lead_id` opcional se o lead já estiver associado ao `subscriber_id`.

### Tool `crm_merge_phone`

Ver exemplo em [crm-external-http-api.md](crm-external-http-api.md) §1.2.

---

## AI Agent no n8n (LangChain tool calling)

No nó **AI Agent** do n8n, cada tool pode ser um **HTTP Request Tool** (ou sub-workflow):

- **Descrição curta** para o modelo (ex.: “Grava no CRM a mensagem recebida do cliente antes de responder.” → `crm_ingest`).
- **URL / método / header** fixos; **body** em JSON com expressões `{{ $json... }}` do item actual.

Importante: o agente **não** deve chamar `ingest` e `get_thread` em ordem errada sem `subscriber_id` estável — usa o mesmo identificador ManyChat em todos os passos.

---

## Evitar dupla IA no Supabase

Se o ManyChat ainda apontar para `crm-manychat-webhook` **sem** `action`, a Edge corre **IA + rate limit**. No caminho **n8n + tools**, o ManyChat deve chamar **só o webhook do n8n**; o n8n chama o CRM com `ingest` / `get_thread` / `record_outbound` apenas.

---

## Referências

- Mapa do workflow antigo (FIXED) vs CRM: [n8n-crm-manychat-bridge.md](n8n-crm-manychat-bridge.md#mapa-n8n-fixed-zai).
- Export de referência: [integrations/n8n/workflows/Instituto_Lorena_Visentainer_FIXED.json](../integrations/n8n/workflows/Instituto_Lorena_Visentainer_FIXED.json).
