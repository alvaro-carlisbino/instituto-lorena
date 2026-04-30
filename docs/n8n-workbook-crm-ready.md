# Workbook n8n — CRM Instituto Lorena (pronto para criar nós)

Documento operacional: **URLs fixas**, **headers** e **corpos JSON** para montares o workflow no n8n sem adivinhar o contrato. Para outro projeto Supabase, substitui só o *project ref* na URL (mantém o resto igual).

**Ligações úteis**

- **Workflow JSON pronto a importar (n8n):** [../integrations/n8n/workflows/Instituto_Lorena_Visentainer_CRM_v2.json](../integrations/n8n/workflows/Instituto_Lorena_Visentainer_CRM_v2.json) — após importar, associa credenciais (§2) e copia a URL do **Webhook** para o ManyChat External Request.  
- Contrato detalhado e erros: [crm-external-http-api.md](crm-external-http-api.md)  
- Visão das “tools”: [n8n-crm-tools.md](n8n-crm-tools.md)

---

## 1. Constantes deste ambiente (copiar)

| O quê | Valor |
|--------|--------|
| **Edge `crm-manychat-webhook` (POST)** | `https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-manychat-webhook` |
| **Dashboard Supabase (funções)** | `https://supabase.com/dashboard/project/fgyfpmnvlkmyxtucbxbu/functions` |
| **ManyChat API (raiz)** | `https://api.manychat.com` |
| **Custom field DM (padrão IL)** | `14539456` (`ENVIAR-DM`) |
| **Flow NS entrega DM (padrão IL)** | `content20260430143025_638461` |

**Secrets que tens de ter no Supabase** (Edge → Secrets): `MANYCHAT_CRM_SECRET` (mesmo valor que vais meter no n8n no header `x-manychat-crm-secret`). Opcional no fluxo n8n: token **ManyChat** (Settings → API) para `setCustomField` + `sendFlow`.

**Deploy:** depois de qualquer alteração ao código da função, na máquina do projecto:

`supabase functions deploy crm-manychat-webhook`

---

## 2. Credenciais no n8n (criar uma vez)

### 2.1 CRM (header secreto)

Credencial **Header Auth**: nome do header `x-manychat-crm-secret`, valor = `MANYCHAT_CRM_SECRET` no Supabase (sem `Bearer`). Nos nós **CRM Ingest / get thread / record outbound**, Authentication → essa credencial (não misturar com a do Z.ai). **401:** secret no Supabase vazio ou valor diferente do header.

### 2.2 ManyChat (Bearer)

1. **Credentials → Create → Header Auth** (ou HTTP Bearer conforme o teu n8n).  
2. **Header name:** `Authorization`  
3. **Header value:** `Bearer SEU_TOKEN_MANYCHAT` (token da página **Settings → API**).

Usa esta credencial só nos nós que chamam `api.manychat.com`.

---

## 3. Payload ManyChat → Webhook n8n (normalizar)

O export antigo [Instituto_Lorena_Visentainer_FIXED.json](../integrations/n8n/workflows/Instituto_Lorena_Visentainer_FIXED.json) usa `body.data.id` (subscriber) e `body.msg` (texto). No n8n, após o **Webhook**, adiciona um nó **Set** (modo “Manual”) para teres sempre os mesmos nomes de campo nos nós seguintes:

| Campo no Set | Valor (expressão n8n) |
|---------------|------------------------|
| `subscriber_id` | `{{ $json.body.data.id }}` |
| `text` | `{{ $json.body.msg }}` |
| `user_name` | `{{ $json.body.data.first_name || $json.body.data.name || 'Cliente' }}` |

Se o teu automation ManyChat enviar JSON diferente, ajusta só este **Set**; o resto do workbook mantém-se.

---

## 4. Fluxo mínimo recomendado (ordem dos nós)

1. **Webhook** — `POST` (URL que o ManyChat External Request vai chamar).  
2. **Set** — “Normalizar payload” (secção 3).  
3. **HTTP Request** — `CRM ingest` (gravar entrada no CRM).  
4. **HTTP Request** — `CRM get_thread` (histórico para o modelo).  
5. **Code** (opcional) — formatar `interactions[]` em texto multi-linha para o prompt.  
6. **OpenAI Chat Model** (ou **HTTP Request**) — **Z.ai** com o teu system prompt (secção 6).  
7. **HTTP Request** — ManyChat `setCustomField` + **HTTP Request** — ManyChat `sendFlow` (secção 7).  
8. **HTTP Request** — `CRM record_outbound` (espelhar a resposta no Kanban).

**Regra de ouro:** o ManyChat **não** deve chamar o `crm-manychat-webhook` **sem** `action` se a IA já corre no n8n — senão o Supabase também corre IA. External Request → **URL do webhook do n8n** apenas.

---

## 5. Nós HTTP ao CRM (mesma URL, `action` diferente)

**URL (todos):**  
`https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-manychat-webhook`

**Método:** `POST`  
**Authentication:** credencial secção 2.1  
**Send Headers:** `Content-Type` = `application/json`

### 5.1 `CRM ingest`

**Specify Body:** JSON

```json
{
  "action": "ingest",
  "subscriber_id": "={{ $json.subscriber_id }}",
  "user_name": "={{ $json.user_name }}",
  "text": "={{ $json.text }}"
}
```

- Opcional: `"phone": "={{ $json.phone }}"` se tiveres telefone no Set.  
- Opcional: `"context_append": "={{ $json.context_append }}"` (texto extra só para futuras extensões; no `ingest` o CRM grava na interação **in** apenas o `text`).

**Resposta:** guarda `leadId` — no n8n fica em `{{ $json.leadId }}` na saída deste nó (usa **“Include Response Headers and Status”** se precisares de debug).

### 5.2 `CRM get_thread`

**Specify Body:** JSON

```json
{
  "action": "get_thread",
  "subscriber_id": "={{ $('Set').item.json.subscriber_id }}",
  "lead_id": "={{ $('CRM ingest').item.json.leadId }}",
  "limit": 40
}
```

- Ajusta `'Set'` e `'CRM ingest'` para os **nomes exactos** dos teus nós (n8n usa o nome do nó em `$('...')`).  
- Podes omitir `lead_id` se só usares `subscriber_id`; incluir os dois é válido quando já tens o `leadId` do ingest.

**Resposta:** array `interactions` (cronológico). Campo útil: `{{ $json.interactions }}`.

### 5.3 `CRM record_outbound`

Chama **depois** de enviares a mensagem ao cliente (ManyChat). Corpo:

```json
{
  "action": "record_outbound",
  "subscriber_id": "={{ $('Set').item.json.subscriber_id }}",
  "user_name": "={{ $('Set').item.json.user_name }}",
  "reply": "={{ $json.texto_enviado_ao_cliente }}",
  "lead_id": "={{ $('CRM ingest').item.json.leadId }}"
}
```

- Substitui `texto_enviado_ao_cliente` pela expressão que aponta para a saída do modelo / último nó (ex. `{{ $('OpenAI').item.json.text }}` conforme o teu fluxo).  
- `lead_id` é opcional se o CRM já associa o `subscriber_id` ao lead.

### 5.4 `CRM merge_phone` (opcional)

```json
{
  "action": "merge_phone",
  "subscriber_id": "={{ $('Set').item.json.subscriber_id }}",
  "phone": "={{ $json.phone }}",
  "user_name": "={{ $('Set').item.json.user_name }}",
  "summary": "Telefone recebido no DM"
}
```

`subscriber_id` é **obrigatório** nesta action. Ver [crm-external-http-api.md](crm-external-http-api.md) §1.2.

---

## 6. Z.ai no n8n (OpenAI-compatible)

**Base URL (pay-as-you-go, recomendado para chat):**  
`https://api.z.ai/api/paas/v4`

No nó **OpenAI Chat Model** (LangChain): em **Options** / **Base URL** (ou equivalente na tua versão), define a URL acima **sem** path `/chat/completions` (o nó acrescenta o path).

- **API Key:** a mesma `ZAI_API_KEY` que usas no Supabase (ou chave da conta Z.ai).  
- **Model:** por exemplo `glm-4.7` ou o modelo que a consola Z.ai indicar para `/paas/v4`.

Se usares **HTTP Request** em vez do nó OpenAI:

- **Method:** `POST`  
- **URL:** `https://api.z.ai/api/paas/v4/chat/completions`  
- **Headers:** `Authorization: Bearer SUA_CHAVE`, `Content-Type: application/json`  
- **Body:** JSON no formato OpenAI `messages` (documentação oficial Z.ai / OpenAI-compatible).

**Contexto:** cola no *system* o teu prompt de triagem; no *user* inclui o histórico formatado a partir de `interactions` (nó Code antes deste).

---

## 7. ManyChat — enviar DM (set field + flow)

Dois pedidos **POST** para a API pública. **Authentication:** secção 2.2.

### 7.1 `setCustomField`

- **URL:** `https://api.manychat.com/fb/subscriber/setCustomField`  
- **Body (JSON):**

```json
{
  "subscriber_id": "={{ $('Set').item.json.subscriber_id }}",
  "field_id": 14539456,
  "field_value": "={{ $json.output_do_modelo }}"
}
```

- `field_value`: texto da resposta (limite ~18k caracteres).  
- Se usares outro custom field no ManyChat, altera `field_id`.

### 7.2 `sendFlow`

- **URL:** `https://api.manychat.com/fb/sending/sendFlow`  
- **Body (JSON):**

```json
{
  "subscriber_id": "={{ $('Set').item.json.subscriber_id }}",
  "flow_ns": "content20260430143025_638461"
}
```

Ordem recomendada: **primeiro** `setCustomField`, **depois** `sendFlow` (igual ao CRM em `_shared/manychatPublicApi.ts`).

---

## 8. Code node — exemplo mínimo (`interactions` → texto)

Entre **CRM get_thread** e o modelo, um **Code** (JavaScript) pode fazer:

```javascript
const items = $input.first().json.interactions || [];
const lines = items.map(
  (r) => `${r.direction === 'in' ? 'Cliente' : 'Assistente'}: ${r.content || ''}`
);
return [{ json: { chat_context: lines.join('\n') } }];
```

Liga a saída ao campo *user* do prompt (concatena com `text` actual se quiseres).

---

## 9. Checklist antes de ligar o ManyChat

- [ ] `crm-manychat-webhook` deployada com suporte a `get_thread` (código recente do repositório).  
- [ ] `MANYCHAT_CRM_SECRET` definido no Supabase e igual no n8n.  
- [ ] Teste manual: **Execute Workflow** com um JSON de exemplo no Webhook → vês `200` e `leadId` no ingest.  
- [ ] ManyChat External Request aponta para **URL do n8n**, não para o Supabase (neste modo).  
- [ ] Token ManyChat válido nos nós `api.manychat.com`.  
- [ ] Após `sendFlow`, nó **CRM record_outbound** com o mesmo texto enviado.

---

## 10. Exemplo JSON para “Test URL” no Webhook (simula ManyChat)

```json
{
  "body": {
    "data": { "id": "123456789", "first_name": "Teste" },
    "msg": "Olá, quero informações"
  }
}
```

Substitui `123456789` por um subscriber_id de teste da tua página ManyChat quando fores a produção.
