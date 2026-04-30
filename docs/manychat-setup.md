# ManyChat — ligar o Instagram ao CRM (Supabase)

**Caminho A — sem n8n:** o ManyChat chama **diretamente** a Edge Function (`crm-manychat-webhook` com IA no Supabase + Z.ai). **Caminho B — com n8n:** ManyChat → webhook n8n → CRM como [tools HTTP](n8n-crm-tools.md) (`ingest`, `get_thread`, …) e Z.ai **dentro do n8n**; o mapa do fluxo antigo FIXED está em [n8n-crm-manychat-bridge.md](n8n-crm-manychat-bridge.md#mapa-n8n-fixed-zai).

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
| `CRM_AI_INTERNAL_SECRET` | **Obrigatório** para resposta IA no ManyChat: string aleatória com **pelo menos 16 caracteres** (ex. 32+). O `crm-manychat-webhook` envia este valor no header `x-crm-ai-internal-secret` ao chamar `crm-ai-assistant` (chamada servidor-a-servidor, sem JWT de utilizador). |

**Opcional — envio automático Instagram (API ManyChat a partir do CRM):**

| Nome | Valor |
|------|--------|
| `MANYCHAT_API_KEY` | Token **Settings → API** no ManyChat (Bearer). Se existir, após gerar `reply` a função chama `POST /fb/subscriber/setCustomField` + `POST /fb/sending/sendFlow` para o subscriber. |
| `MANYCHAT_DM_FIELD_ID` | ID numérico do custom field da DM (omissão: **14539456** / `ENVIAR-DM`). |
| `MANYCHAT_DM_FLOW_NS` | `flow_ns` do flow de entrega (omissão: **`content20260430143025_638461`**). |
| `MANYCHAT_SEND_FLOW_MESSAGE_TAG` | Só se a ManyChat/Meta exigir tag no `sendFlow` (ex. valor permitido pela tua conta). |
| `MANYCHAT_PUSH_DISABLED` | `true` para desligar o push mantendo a key (testes). |
| `MANYCHAT_ASYNC_ACK` | `false` força **síncrono** (`reply` no JSON; risco timeout ~10s no ManyChat). **`true` ou omisso:** só entra em modo **`queued`** (resposta imediata sem `reply`) se existir **`MANYCHAT_API_KEY`** — senão o CRM mantém **síncrono** para o ManyChat poder mapear `reply` no External Request. |

Com `MANYCHAT_API_KEY` definido, **remove** do automation ManyChat os passos duplicados **Set Custom Field + Send Flow** logo a seguir ao External Request — senão o cliente pode receber **duas** DMs. Podes forçar só JSON com `"manychat_skip_push": true` no body do `POST` (testes).

3. Garante também os secrets da IA usados por `crm-ai-assistant` (ex. `ZAI_API_KEY`), conforme o [README](../README.md).

Sem `MANYCHAT_CRM_SECRET`, a função responde `401 unauthorized`.

Sem `CRM_AI_INTERNAL_SECRET` válido (≥16 caracteres) nas Edge Functions, o pedido pode devolver `200` com **`reply` vazio** (a chamada interna ao `crm-ai-assistant` falha). Define o secret e faz **deploy** de `crm-ai-assistant` e `crm-manychat-webhook` quando alterares código ou secrets.

---

## 2. No ManyChat — fluxo geral

Objetivo (caminho A): quando o utilizador enviar mensagem (Instagram), o CRM (`crm-manychat-webhook`) gera o texto da IA e regista no histórico; **no Instagram**, a entrega faz-se via **ManyChat** — ou **automaticamente** (secret `MANYCHAT_API_KEY`, §1) ou à mão / segundo flow (§2.3.1–2.3.2). No **caminho B** (n8n), o External Request aponta para o **n8n**; o CRM só recebe `ingest` / `record_outbound` etc. conforme [n8n-crm-tools.md](n8n-crm-tools.md).

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

**Erro `UNAUTHORIZED_NO_AUTH_HEADER` / `Missing authorization header`:** o gateway do Supabase, por defeito, exige `Authorization: Bearer …` **antes** de o teu código correr. Neste repo, `supabase/config.toml` define **`verify_jwt = false`** para `crm-manychat-webhook` (e outros webhooks). Depois de alterar o ficheiro, faz deploy: `supabase functions deploy crm-manychat-webhook` (com o CLI autenticado no projecto). **Workaround** no ManyChat: acrescenta também `Authorization: Bearer <anon key>` e header `apikey` com o **mesmo** valor da anon key (chave pública do projecto — menos ideal que desligar o JWT na função).

Garante que `x-manychat-crm-secret` está configurado **uma vez** (evita duplicar o mesmo header no pedido).

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

**Importante (diferença do n8n):** o CRM **só devolve JSON** no HTTP. **Não** envia mensagem ao Instagram por conta própria. Tens de **publicar** o `reply` no canal Meta via ManyChat — seja no **mesmo** automation (§2.3.2) ou no **padrão em dois flows + API** (§2.3.1), que a equipa usa quando a IA demora e não se quer depender de encadear “reply → Send Message” logo a seguir ao External Request.

### 2.3.1 Padrão em dois flows + variável pela API ManyChat (recomendado quando a IA demora)

**Com `MANYCHAT_API_KEY` no Supabase (§1):** o próprio `crm-manychat-webhook` já faz **setCustomField + sendFlow** depois da IA — o Flow A no ManyChat pode ser **apenas** o External Request (sem Set Field / Send Flow a seguir, para não duplicar DM).

**Sem** esse secret (ou com orquestrador externo), o padrão manual é:

1. **Flow A** — **External Request** ao `crm-manychat-webhook` (…). O CRM devolve JSON com **`reply`**. Se a IA corre **toda** nesta chamada, aplica-se o **limite ~10 s** do ManyChat (§2.7); para contornar, endpoint intermédio que responde rápido + processo assíncrono, etc.
2. **Orquestrador** — [API ManyChat](https://api.manychat.com/swagger): `setCustomField` / `setCustomFieldByName` com o `reply`, depois **`sendFlow`** com o `flow_ns` do Flow B.
3. **Flow B** — **Send Message** no Instagram (ou lê **ENVIAR-DM** / id **14539456**, flow `content20260430143025_638461`).

Assim o tempo da IA **não** fica acoplado ao bloco que manda a DM quando tudo corre **fora** do ManyChat; com push no CRM, o ManyChat só precisa de esperar **uma** resposta HTTP (atenção ao §2.7 se a IA + API ManyChat somarem > ~10 s).

### 2.3.2 Variante simples — tudo no mesmo automation (quando cabe em ~10 s)

**Importante:** só faz sentido se o External Request **voltar a tempo** com JSON completo; caso contrário preferir §2.3.1 ou §2.7.

Se vires `status: "already_processed"` e `reply` vazio: o **`external_message_id`** deste pedido **já foi usado** noutra chamada (idempotência). Gera um **id único por mensagem** (ex. `{{message.id}}` ou `{{conversation.id}}-{{message.id}}-{{timestamp}}`) ou muda o id para voltar a correr a IA.

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
2. Se usas **Custom Field** + **Flow** para publicar: grava `reply` no custom field e dispara o **Flow** que lê esse campo.
3. **`handoff_suggested`** = `true` → ramifica no ManyChat (notificar consultor, tag, outro flow, etc.). O CRM remove a marca `[PRONTO_PARA_CONSULTOR]` do texto em `reply` antes de devolver.

#### Exemplo Instituto Lorena — campo **ENVIAR-DM** + Flow (DM ao utilizador), em série no mesmo automation

Útil quando o JSON com `reply` chega dentro do timeout do ManyChat; em alternativa ver **§2.3.1** (dois flows + API).

Valores da conta ManyChat (rever no editor se ManyChat renumerar campos/flows):

| O quê | Valor |
|--------|--------|
| **Custom field** (nome) | `ENVIAR-DM` |
| **Field ID** (API / Set Custom Field) | `14539456` |
| **Flow** (ID / namespace a disparar depois de preencher o campo) | `content20260430143025_638461` |

**Ordem no automation (após o External Request ao CRM):**

1. **Set Custom Field** (ou “Set Subscriber Custom Field”): campo **14539456** / `ENVIAR-DM` ← valor = **`reply`** vindo do corpo JSON da resposta do `crm-manychat-webhook` (mapeamento do External Request).
2. **Send Flow** / **Start Flow** / **Execute Flow** (conforme o teu ManyChat): enviar o subscriber para o flow **`content20260430143025_638461`**, que no ManyChat deve estar configurado para **ler o campo `ENVIAR-DM`** e enviar essa mensagem ao utilizador no Instagram.

Sem o passo (1) o flow pode ficar vazio; sem o passo (2) o texto fica no campo mas o cliente não recebe DM.

**Sintoma:** a resposta aparece no **painel do CRM** (histórico), mas o cliente **não** vê mensagem no Instagram.

- O webhook **já fez a parte dele**: gravou a linha `out` na BD. Isso **não** chama a API do ManyChat.
- Falta **publicar** o `reply` no Instagram: ou **(A)+(B)** no **mesmo** automation após o External Request (§2.3.2), ou o **Flow B** depois de **set via API ManyChat** + disparo do flow (§2.3.1). Sem a entrega no ManyChat, o Instagram fica mudo mesmo com CRM correcto.
- Se o ManyChat mostrou **timeout ~10 s** (§2.7), o fluxo pode **nunca ter corrido** os passos (A)+(B) porque o pedido HTTP foi cortado antes de devolver JSON — nesse caso o CRM pode ainda ter registado resposta (ex. pedido completou no Supabase depois), mas o ManyChat não recebeu `reply` a tempo para mapear para o campo / flow.

### 2.4 Debounce (várias mensagens seguidas)

O CRM **não** inclui debounce de 6s (isso era padrão antigo com orquestrador externo). Opções:

- Configurar no ManyChat um **Smart Delay** ou só disparar o External Request quando o utilizador “parar”, ou
- Uma chamada por mensagem com `external_message_id` estável e único por mensagem.

### 2.5 IA **só no CRM** (recomendado — sem n8n)

- Corpo **sem** `action` (ou `"action": "message"`): o ManyChat envia `subscriber_id` + `text` → `crm-manychat-webhook` cria/atualiza o lead, grava a interação e chama **`crm-ai-assistant`** no Supabase (Z.ai com `ZAI_API_KEY`). A resposta traz **`reply`** para o passo seguinte no ManyChat.
- Secrets: `MANYCHAT_CRM_SECRET`, `CRM_AI_INTERNAL_SECRET`, `ZAI_API_KEY` (e, se precisares, `ZAI_API_BASE` / modelo — ver [README](../README.md) sobre **pay-as-you-go** `…/paas/v4` vs endpoint **Coding** `…/coding/…` no Edge).

Ações opcionais **`ingest`** e **`record_outbound`** continuam disponíveis para testes, reenvio manual ou integrações à parte — **não** são necessárias para o fluxo principal ManyChat + IA no CRM. Contrato: [crm-external-http-api.md](crm-external-http-api.md) §1.3–1.4.

### 2.6 Resposta **manual** da equipa (Instagram) — mesmo esquema que `sendFlow`

O botão **Enviar** do CRM chama `crm-send-message`, que fala com **Evolution / WhatsApp Cloud** no número do lead. Leads só **Instagram (ManyChat)** usam telefone sintético `888001…`: **não** há linha WhatsApp nesse número, e podes ver **429** por limites de segurança da função.

Para o operador responder no **Instagram** como já fazias:

1. No **ManyChat**, podes reutilizar o mesmo campo **`ENVIAR-DM` (14539456)** e o flow **`content20260430143025_638461`** (ver tabela acima), ou outro campo + flow dedicados a mensagens manuais.
2. Quando o texto estiver pronto (CRM ou operador): **HTTP** à API ManyChat que **preenche o custom field** e dispara **Send Flow** / execução do flow (variável + `sendFlow`).
3. **Registar no CRM** com `POST` a `crm-manychat-webhook`, `"action": "record_outbound"`, `subscriber_id` + `reply` com o texto enviado (ver §1.4 em [crm-external-http-api.md](crm-external-http-api.md)).

Assim o histórico no painel fica alinhado com o que o cliente recebeu no DM, **sem** passar por `crm-send-message`.

### 2.7 Erro **Operation timed out after ~10002 ms** (0 bytes received)

O ManyChat impõe um **timeout curto (~10 s)** nos pedidos **External Request** para domínios que **não** sejam `openai.com` (não há como aumentar esse valor no editor). Se o External Request ManyChat → `crm-manychat-webhook` fizer **IA completa na mesma chamada**, o caminho é:

`ManyChat → crm-manychat-webhook` (Edge) → base de dados → **`functions.invoke('crm-ai-assistant')`** (outra Edge) → **Z.ai**.

Cold start, rede e o tempo do modelo podem **ultrapassar 10 s**; o ManyChat corta e mostra erro de timeout / 0 bytes, mesmo que o Supabase acabe por concluir depois.

**Comportamento actual do CRM:** com **`MANYCHAT_API_KEY`** configurada, por omissão o webhook pode responder **já** com `accepted` + `routing: queued` e correr **IA + push ManyChat** em segundo plano (evita timeout ~10 s no External Request). **Sem** `MANYCHAT_API_KEY`, o pedido fica **síncrono** e o JSON traz **`reply`** para o ManyChat mapear (ex. Set Custom Field) — caso contrário o ManyChat recebia `200` mas sem texto para enviar ao cliente. Força síncrono com **`manychat_sync: true`** ou secret **`MANYCHAT_ASYNC_ACK=false`**.

**Outras mitigações:** modelo *flash*, `system_prompt` mais curto; ou o padrão manual §2.3.1 (dois flows + API ManyChat).

---

## 3. Testar no Admin Lab (opcional)

No CRM, **Ferramentas** → origem **ManyChat / Instagram (IA)** permite simular um pedido com `VITE_MANYCHAT_CRM_SECRET` no `.env` local (igual ao secret do Supabase). Ver [Admin Lab](../src/pages/AdminLabPage.tsx) e [.env.example](../.env.example).

---

## 4. Checklist rápido

- [ ] Secrets `MANYCHAT_CRM_SECRET` e **`CRM_AI_INTERNAL_SECRET`** (≥16 caracteres) no Supabase; o segundo evita `reply` vazio no JSON  
- [ ] Mesmo `MANYCHAT_CRM_SECRET` no header ManyChat  
- [ ] URL correta da função `crm-manychat-webhook`  
- [ ] Body JSON com `subscriber_id` e `text`  
- [ ] Entrega Instagram: secret **`MANYCHAT_API_KEY`** (push no CRM, §1) **ou** **§2.3.2** (Set Field + **Send Flow** no ManyChat) **ou** orquestração externa §2.3.1 — **nunca** dois destes ao mesmo tempo (evita DM duplicada)  
- [ ] (Opcional) Ramo se `handoff_suggested` for true  
- [ ] Prompt de triagem no **Dashboard Supabase** → tabela `crm_ai_configs` (`system_prompt`)  
- [ ] Se aparecer timeout ~10 s no ManyChat: ver §2.7 (limite do ManyChat, não do Supabase)  

---

## 5. Referência técnica

- Contrato HTTP completo: [crm-external-http-api.md](crm-external-http-api.md)  
- n8n — workbook com URL Supabase e nós prontos: [n8n-workbook-crm-ready.md](n8n-workbook-crm-ready.md)  
- n8n como orquestrador + CRM como tools (visão): [n8n-crm-tools.md](n8n-crm-tools.md)  
- Mapa do fluxo FIXED (referência): [n8n-crm-manychat-bridge.md](n8n-crm-manychat-bridge.md)  

Se o ManyChat mostrar erros **401**, verifica o header `x-manychat-crm-secret`. Erros **500** → logs em **Supabase → Edge Functions → crm-manychat-webhook → Logs**.
