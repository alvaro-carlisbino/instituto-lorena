# ManyChat — ligar o Instagram ao CRM (Supabase)

Este guia assume que **não usas n8n** no meio: o ManyChat chama **diretamente** a Edge Function do projeto.

**URL da função** (substitui pelo teu project ref se for outro):

`https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-manychat-webhook`

Dashboard Supabase deste projeto: `https://supabase.com/dashboard/project/fgyfpmnvlkmyxtucbxbu/functions`

---

## 1. Secrets no Supabase (obrigatório)

1. Abre **Project Settings → Edge Functions → Secrets** (ou **Edge Functions** → gerir secrets).
2. Cria o secret:

| Nome | Valor |
|------|--------|
| `MANYCHAT_CRM_SECRET` | Uma string longa e aleatória (ex. 32+ caracteres). **A mesma** vais colar no ManyChat. |

3. Garante também os secrets da IA usados por `crm-ai-assistant` (ex. `ZAI_API_KEY`), conforme o [README](../README.md).

Sem `MANYCHAT_CRM_SECRET`, a função responde `401 unauthorized`.

---

## 2. No ManyChat — fluxo geral

Objetivo: quando o utilizador enviar mensagem (Instagram), o ManyChat faz um **External Request** ao CRM, recebe JSON com `reply` (e opcionalmente `handoff_suggested`) e no passo seguinte **envia essa resposta** na conversa (texto ou custom field + flow, como já fazias com n8n).

### 2.1 Criar ou editar um Automation / Flow

1. **Automation** → **New Automation** (ou abre o fluxo onde queres a IA).
2. Trigger típico: **“User sends a message”** / **“Keyword”** / o bloco que já usavas para falar com o webhook antigo.
3. Adiciona ação **External Request** (por vezes em **Actions → External Request** ou **Smart Delay** + Request, conforme o teu plano ManyChat).

### 2.2 Configurar o External Request

| Campo | Valor |
|--------|--------|
| **Method** | `POST` |
| **URL** | `https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-manychat-webhook` |
| **Headers** | Adiciona um header: nome `x-manychat-crm-secret`, valor = **o mesmo** que definiste em `MANYCHAT_CRM_SECRET` no Supabase. |
| **Content-Type** | `application/json` (se o ManyChat não preencher sozinho, adiciona header `Content-Type: application/json`). |

**Body (JSON)** — usa as variáveis do ManyChat para subscriber e texto. Os nomes exatos dos campos dependem do ManyChat; abaixo está o **contrato** que o CRM espera:

```json
{
  "subscriber_id": "{{subscriber.id}}",
  "user_name": "{{subscriber.first_name}} {{subscriber.last_name}}",
  "text": "{{last_input_text}}",
  "external_message_id": "{{conversation.id}}-{{message.id}}"
}
```

Ajusta `{{...}}` ao que o editor do ManyChat mostrar (por exemplo `user.first_name`, `last_message`, etc.). O importante é:

- `subscriber_id` — ID numérico/string do subscriber (obrigatório).
- `text` — texto que o cliente acabou de enviar (obrigatório).
- `user_name` — opcional mas recomendado (nome no CRM).
- `external_message_id` — **recomendado** para idempotência (evita processar duas vezes a mesma mensagem). Pode ser combinação única por mensagem.
- `phone` — opcional, se tiveres campo com telefone (≥10 dígitos) para fundir com lead WhatsApp.
- `context_append` — opcional, texto extra só para a IA (tags, cidade, etc.).

### 2.3 Depois do External Request — usar a resposta

A resposta HTTP 200 é JSON, por exemplo:

```json
{
  "ok": true,
  "leadId": "lead-…",
  "reply": "Texto da IA para mostrar ao cliente",
  "handoff_suggested": false,
  "routing": "ai_auto_reply_attempted"
}
```

No ManyChat:

1. **Send Message** (ou **Reply**) — corpo da mensagem = campo **`reply`** da resposta (no mapeamento do External Request costuma aparecer como corpo JSON parseado; se vier string bruta, usa um passo “Set Custom Field” intermédio).
2. Se usas **Custom Field** + **Flow** para publicar (como no n8n antigo): grava `reply` no custom field e dispara o **Flow** que lê esse campo.
3. **`handoff_suggested`** = `true` → podes ramificar para “notificar consultor”, “tag”, “outro flow”, etc. (substitui a lógica da tag `[PRONTO_PARA_CONSULTOR]` no n8n; o CRM já remove a tag do texto em `reply`).

### 2.4 Debounce (várias mensagens seguidas)

O CRM **não** replica o wait de 6s do n8n. Opções:

- Configurar no ManyChat um **Smart Delay** ou só disparar o External Request quando o utilizador “parar” (regra de negócio no fluxo), ou
- Aceitar uma chamada por mensagem (cada uma com `external_message_id` diferente).

---

## 3. Testar no Admin Lab (opcional)

No CRM, **Ferramentas** → origem **ManyChat / Instagram (IA)** permite simular um pedido com `VITE_MANYCHAT_CRM_SECRET` no `.env` local (igual ao secret do Supabase). Ver [Admin Lab](../src/pages/AdminLabPage.tsx) e [.env.example](../.env.example).

---

## 4. Checklist rápido

- [ ] Secret `MANYCHAT_CRM_SECRET` no Supabase + mesmo valor no header ManyChat  
- [ ] URL correta da função `crm-manychat-webhook`  
- [ ] Body JSON com `subscriber_id` e `text`  
- [ ] Passo ManyChat a enviar `reply` ao utilizador  
- [ ] (Opcional) Ramo se `handoff_suggested` for true  
- [ ] Prompt de triagem no **Dashboard Supabase** → tabela `crm_ai_configs` (`system_prompt`), alinhado ao que tinhas no n8n  

---

## 5. Referência técnica

- Contrato HTTP completo: [crm-external-http-api.md](crm-external-http-api.md)  
- Arquitetura ManyChat vs n8n: [n8n-crm-manychat-bridge.md](n8n-crm-manychat-bridge.md)  

Se o ManyChat mostrar erros **401**, verifica o header `x-manychat-crm-secret`. Erros **500** → logs em **Supabase → Edge Functions → crm-manychat-webhook → Logs**.
