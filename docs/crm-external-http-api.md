# APIs HTTP externas (ManyChat, webhooks CRM; n8n como orquestrador opcional)

Base URL das Edge Functions: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/<nome-da-função>`

Todas as respostas são JSON. Erros comuns: `401 unauthorized` (campo opcional **`hint`**: secret não configurado no Supabase, header `x-manychat-crm-secret` em falta, ou valor diferente de `MANYCHAT_CRM_SECRET`), `400 invalid_json` / `missing_*`, `500 processing_failed`.

**Canais “oficiais” Meta (Instagram / WhatsApp no ecossistema Meta):** o caminho recomendado é o **ManyChat** (já integrado às APIs da Meta), chamando o CRM com `crm-manychat-webhook`. Assim evitas duplicar webhooks e tokens Meta no Supabase para o que o ManyChat já cobre. A integração **direta** Meta Cloud no CRM (`crm-whatsapp-webhook` com `WHATSAPP_PROVIDER=official`) fica como opção avançada quando precisas de WhatsApp no CRM sem ManyChat nesse leg.

**Configurar o ManyChat (External Request, checklist):** ver [manychat-setup.md](manychat-setup.md).

---

## 1. `crm-manychat-webhook` — ManyChat (Meta) + IA CRM

**Headers obrigatórios**

- `Content-Type: application/json`
- `x-manychat-crm-secret`: igual ao secret `MANYCHAT_CRM_SECRET` no Supabase (Edge Functions → Secrets).

**Secrets Supabase:** `MANYCHAT_CRM_SECRET` (header ManyChat `x-manychat-crm-secret`) e **`CRM_AI_INTERNAL_SECRET`** (≥16 caracteres; usado só entre Edge Functions para o `crm-ai-assistant` devolver texto em `reply`). Sem o segundo, a resposta pode ser `200` com `reply: ""`. Opcional: **`MANYCHAT_API_KEY`** (+ `MANYCHAT_DM_FIELD_ID`, `MANYCHAT_DM_FLOW_NS`, …) para o CRM chamar a API ManyChat (`setCustomField` + `sendFlow`) após a IA — ver [manychat-setup.md](manychat-setup.md) §1.

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
| `manychat_skip_push` | não | Se `true`, não chama a API ManyChat mesmo com `MANYCHAT_API_KEY` (evita DM duplicada em testes) |
| `manychat_sync` | não | Se `true`, resposta **síncrona** com `reply` no mesmo JSON |
| `manychat_async` | não | Se `true`, força `queued` em segundo plano (útil com `MANYCHAT_API_KEY`) |

**Resposta 200 (modo assíncrono — só quando existe `MANYCHAT_API_KEY` ou `manychat_async: true`)**

```json
{
  "ok": true,
  "accepted": true,
  "routing": "queued",
  "external_message_id": "…",
  "subscriber_id": "…",
  "reply": "",
  "handoff_suggested": false,
  "manychat_push": { "attempted": false, "skipped_reason": "async_pending" },
  "hint": "…"
}
```

**Resposta 200 (modo síncrono — `manychat_sync: true` ou `MANYCHAT_ASYNC_ACK=false`)**

```json
{
  "ok": true,
  "leadId": "lead-…",
  "reply": "Texto para o ManyChat (tag [PRONTO_PARA_CONSULTOR] removida se existir)",
  "handoff_suggested": false,
  "routing": "ai_auto_reply_attempted | manual_handoff",
  "manychat_push": {
    "attempted": true,
    "ok": true
  }
}
```

- `manychat_push`: se `MANYCHAT_API_KEY` estiver definido e houver `reply`, o CRM tenta **setCustomField** + **sendFlow**; `attempted: false` com `skipped_reason` quando não há key, `reply` vazio, `manychat_skip_push`, ou `MANYCHAT_PUSH_DISABLED`. Erro ManyChat em `manychat_push.error` (HTTP 200 na mesma — o histórico CRM já foi gravado).
- `handoff_suggested`: `true` quando a IA sinalizou handoff com `[PRONTO_PARA_CONSULTOR]` (ramifica no ManyChat).
- Se **não** usares `MANYCHAT_API_KEY`: no ManyChat, usa `reply` + `handoff_suggested` no passo seguinte ao External Request (Send Message / Flow).
- Se repetires o mesmo `external_message_id` no modo `message`, a API devolve `status: "already_processed"`, `reply` vazio e um campo **`hint`** (a IA **não** corre outra vez). Gera um **id único por mensagem** ou usa `action: "ingest"` (§1.3).

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

### 1.3 `action: "ingest"` — só CRM (sem IA, sem idempotência do fluxo `message`)

Para **ingestar só no CRM** sem IA no Supabase (motor de IA externo, testes, ou evitar `already_processed` com o mesmo `external_message_id` do modo `message`): grava lead + mensagem **entrada** e devolve `leadId` **sem** chamar `crm-ai-assistant` e **sem** a idempotência do modo `message`.

```json
{
  "action": "ingest",
  "subscriber_id": "123456789",
  "user_name": "Nome no Instagram",
  "text": "Olá"
}
```

**Resposta 200**

```json
{
  "ok": true,
  "leadId": "lead-…",
  "status": "ingested",
  "reply": "",
  "handoff_suggested": false,
  "routing": "ingest_only"
}
```

### 1.4 `action: "record_outbound"` — gravar resposta **saída** no CRM (depois do ManyChat)

Depois de enviares a mensagem ao cliente (ManyChat: `sendFlow` / custom field / mensagem directa) e quiseres **espelhar** essa linha no histórico do CRM:

```json
{
  "action": "record_outbound",
  "subscriber_id": "123456789",
  "user_name": "Nome no Instagram",
  "reply": "Texto enviado ao cliente (pode incluir [PRONTO_PARA_CONSULTOR])",
  "lead_id": "lead-…"
}
```

- `reply` ou `text`: corpo gravado como interação **out** (canal `meta`). Preferir `reply` para não confundir com a mensagem do cliente.
- `lead_id`: opcional; se omitido, resolve pelo `manychat_subscriber_id` no lead.

**Resposta 200**

```json
{
  "ok": true,
  "leadId": "lead-…",
  "status": "outbound_recorded",
  "handoff_suggested": false,
  "routing": "record_outbound"
}
```

`handoff_suggested` reflete se o texto continha `[PRONTO_PARA_CONSULTOR]` (removido ao guardar no CRM).

### 1.5 `action: "get_thread"` — ler histórico do CRM (n8n / agente externo)

Para **orquestração no n8n** com Z.ai (ou outro modelo) no n8n: depois de `ingest`, podes obter as últimas interações do lead em ordem cronológica e montar o contexto no agente.

**Corpo JSON** — envia **`subscriber_id`** ou **`lead_id`** (pelo menos um):

```json
{
  "action": "get_thread",
  "subscriber_id": "123456789",
  "limit": 40
}
```

| Campo | Obrigatório | Descrição |
|--------|-------------|-----------|
| `subscriber_id` | um dos dois | Resolve `lead_id` pelo custom field ManyChat no lead |
| `lead_id` | um dos dois | Atalho quando já tens o `leadId` do `ingest` |
| `limit` | não | Máximo de mensagens (1–100; omissão **40**) |

**Resposta 200** (`status: "ok"`)

```json
{
  "ok": true,
  "leadId": "lead-…",
  "status": "ok",
  "interactions": [
    {
      "id": "…",
      "channel": "meta",
      "direction": "in",
      "author": "Nome",
      "content": "Olá",
      "happened_at": "2026-04-30T12:00:00.000Z"
    }
  ],
  "action": "get_thread"
}
```

Se ainda não existir lead: `leadId: null`, `interactions: []`, `status: "no_lead"` e **`hint`** (HTTP 200).

Catálogo n8n (HTTP Request / AI Tool): [n8n-crm-tools.md](n8n-crm-tools.md).

---

## 2. `crm-ingest-webhook` — ingestão genérica (forms, integrações)

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

### 3.1 `crm-send-message` — envio manual pela equipa (só WhatsApp)

**Auth:** `Authorization: Bearer <JWT do utilizador>` (sessão Supabase).

Envia texto pela instância WhatsApp (Evolution ou Cloud) associada ao lead. **Não** serve para Instagram DM via ManyChat; para isso usa ManyChat (custom field + `sendFlow`) e `crm-manychat-webhook` com `action: record_outbound` ([manychat-setup.md](manychat-setup.md) §2.6).

**429 `cooldown`:** intervalo mínimo entre envios manuais **no mesmo lead** (por defeito **10 s**). Secrets opcionais: `CRM_MANUAL_SEND_MIN_GAP_SECONDS` (`0` = desativar).

**429 `rate_limited`:** teto de linhas `webhook_jobs` com `outbound:%` na última hora (por defeito **180**). Secret opcional: `CRM_SEND_MESSAGE_HOURLY_CAP`.

---

## 4. Orquestração no n8n (ManyChat → n8n → CRM como “tools”)

Há dois arranques válidos:

1. **Directo:** ManyChat → `crm-manychat-webhook` (IA no Edge + Z.ai) — [manychat-setup.md](manychat-setup.md).
2. **Com n8n:** ManyChat → **n8n** (debounce, ramos, **Z.ai no n8n**) → o CRM expõe **ações HTTP** no mesmo `crm-manychat-webhook` (`ingest`, `get_thread`, `record_outbound`, `merge_phone`) como *tools*; ver [n8n-crm-tools.md](n8n-crm-tools.md).

Limites de taxa de IA automática no Edge (`action` omitido / `message`) contam em conjunto `whatsapp-webhook` + `manychat-webhook` (`max_ai_replies_per_hour` em `crm_ai_configs`). Se a IA corre **só no n8n** e usas apenas `ingest` / `get_thread` / `record_outbound`, esses limites **não** aplicam-se à geração de texto no n8n.
