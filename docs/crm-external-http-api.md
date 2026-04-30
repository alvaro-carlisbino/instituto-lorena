# APIs HTTP externas (ManyChat, n8n, webhooks CRM)

Base URL das Edge Functions: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/<nome-da-função>`

Todas as respostas são JSON. Erros comuns: `401 unauthorized`, `400 invalid_json` / `missing_*`, `500 processing_failed`.

**Canais “oficiais” Meta (Instagram / WhatsApp no ecossistema Meta):** o caminho recomendado é o **ManyChat** (já integrado às APIs da Meta), chamando o CRM com `crm-manychat-webhook`. Assim evitas duplicar webhooks e tokens Meta no Supabase para o que o ManyChat já cobre. A integração **direta** Meta Cloud no CRM (`crm-whatsapp-webhook` com `WHATSAPP_PROVIDER=official`) fica como opção avançada quando precisas de WhatsApp no CRM sem ManyChat nesse leg.

---

## 1. `crm-manychat-webhook` — ManyChat (Meta) + IA CRM

**Headers obrigatórios**

- `Content-Type: application/json`
- `x-manychat-crm-secret`: igual ao secret `MANYCHAT_CRM_SECRET` no Supabase (Edge Functions → Secrets).

**Secret Supabase:** `MANYCHAT_CRM_SECRET`

### 1.1 `action` omitido ou `message` — mensagem + resposta IA

Corpo JSON:

```json
{
  "subscriber_id": "123456789",
  "user_name": "Nome no Instagram",
  "text": "Olá, quero marcar consulta",
  "phone": "5511999999999",
  "external_message_id": "manychat-msg-unique-id"
}
```

| Campo | Obrigatório | Descrição |
|--------|-------------|-----------|
| `subscriber_id` | sim | ID do subscriber no ManyChat |
| `text` | sim | Texto recebido do utilizador |
| `user_name` | não | Nome para `patient_name` / autor da interação |
| `phone` | não | Se tiver ≥10 dígitos, faz merge com lead existente por telefone (`promoteManychatLeadToRealPhone`) |
| `external_message_id` ou `message_id` | não | Idempotência em `webhook_jobs` (recomendado em produção) |
| `context_append` ou `user_context` | não | Texto extra (ex. tags ManyChat, cidade) enviado **só** ao modelo de IA, após `---`; a interação “in” no CRM continua a guardar só `text` |
| `phone` | não | ≥10 dígitos: atualiza / funde lead com telefone real |

**Resposta 200**

```json
{
  "ok": true,
  "leadId": "lead-…",
  "reply": "Texto para o ManyChat (tag [PRONTO_PARA_CONSULTOR] removida se existir)",
  "handoff_suggested": false,
  "routing": "ai_auto_reply_attempted | manual_handoff"
}
```

- `handoff_suggested`: `true` quando a IA sinalizou handoff com `[PRONTO_PARA_CONSULTOR]` (compatível com o fluxo n8n antigo “Detectar intenção”).
- No n8n: após **HTTP Request**, usar `reply` + `handoff_suggested` nos nós ManyChat existentes. Guia: [n8n-crm-manychat-bridge.md](n8n-crm-manychat-bridge.md).

### 1.2 `action: "merge_phone"` — utilizador enviou telefone no Instagram

```json
{
  "action": "merge_phone",
  "subscriber_id": "123456789",
  "phone": "+55 11 99999-9999",
  "user_name": "Nome",
  "summary": "Pediu orçamento pelo DM"
}
```

**Resposta 200**

```json
{ "ok": true, "leadId": "lead-…", "merged": true, "action": "merge_phone" }
```

`merged: true` quando existia lead sintético ManyChat e um lead distinto com o mesmo telefone — dados foram fundidos no lead do telefone.

---

## 2. `crm-ingest-webhook` — ingestão genérica (forms, n8n)

**Header:** `x-webhook-secret` = `CRM_WEBHOOK_SECRET`

**Corpo:** ver [`crm-ingest-webhook`](../supabase/functions/crm-ingest-webhook/index.ts) — `patient_name`, `phone`, `source` (`meta_instagram`, `whatsapp`, …), `field_mapping` opcional.

Não devolve `reply` de IA; serve para criar/atualizar lead sem conversa síncrona.

---

## 3. `crm-whatsapp-webhook` — WhatsApp no CRM (Evolution ou Cloud API **direta**)

Usa-se para a **linha WhatsApp ligada ao CRM** (Evolution ou webhook Meta direto). Para conversas que já correm no **ManyChat** com APIs oficiais Meta, preferir a secção 1 (`crm-manychat-webhook`).

- **Evolution:** assinatura `x-webhook-secret` se `EVOLUTION_WEBHOOK_SECRET` estiver definido.
- **Official (`WHATSAPP_PROVIDER=official`):** opcional — assinatura `X-Hub-Signature-256` (Meta). **GET** com `hub.verify_token` = `WHATSAPP_CLOUD_VERIFY_TOKEN` para subscrição do webhook.

Secrets Cloud API (só se usares Meta **sem** ManyChat neste leg):

- `WHATSAPP_CLOUD_APP_SECRET`, `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_VERIFY_TOKEN`, opcional `WHATSAPP_CLOUD_API_VERSION`

**Multi-linha Meta direta:** `meta_phone_number_id` em `whatsapp_channel_instances` (migração `20260430140000_wa_meta_phone_number_id.sql`).

---

## 4. n8n — padrão recomendado

1. **Webhook** n8n recebe evento (ManyChat, formulário, etc.).
2. Nó **HTTP Request** para `crm-manychat-webhook` ou `crm-ingest-webhook` com o header de secret correto.
3. Para ManyChat com IA: usar a resposta `reply` noutro nó HTTP que chama a API do ManyChat para enviar a mensagem ao utilizador (se não enviares só pelo fluxo ManyChat com o valor devolvido).

Limites de taxa de IA automática contam em conjunto `whatsapp-webhook` + `manychat-webhook` (`max_ai_replies_per_hour` em `crm_ai_configs`).
