# CRM Limitless - Instituto Lorena

CRM comercial com frontend React + Supabase, com operacao configuravel por banco e controle por papeis.

## Modos de dados

- `mock`: dados locais para prototipacao
- `supabase`: leitura/escrita real no Supabase

## Setup

```bash
cp .env.example .env
```

Variaveis:

- `VITE_DATA_MODE=mock` ou `VITE_DATA_MODE=supabase`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (ou `VITE_SUPABASE_PUBLISHABLE_KEY`)

## Banco e seguranca (RLS)

Rode no projeto linkado:

```bash
npx supabase db query --linked --file "supabase/schema.sql"
```

O schema inclui:

- tabelas de operacao (`leads`, `pipelines`, `pipeline_stages`, `interactions`)
- tabelas de configuracao (`channel_configs`, `metric_configs`, `workflow_fields`, `permission_profiles`, `notification_rules`, `tv_widgets`, `dashboard_widgets`)
- `app_profiles` com role por usuario autenticado
- RLS por role (`admin`, `gestor`, `sdr`) via funcoes SQL
- `audit_logs` + triggers para rastrear alteracoes de configuracao

## Seed inicial

No app, use `Seed dados` para popular dados de teste.

## Assistente IA (`crm-ai-assistant`)

Edge Function que chama a API Z.ai (modelos GLM) com snapshot do CRM obtido **com o JWT do utilizador** (RLS).

1. No dashboard Supabase (ou CLI), defina secrets: `ZAI_API_KEY` (obrigatório). Opcionais: `ZAI_MODEL`, `ZAI_API_BASE`.
   - **Pay-as-you-go** (saldo na conta): omita `ZAI_API_BASE` ou use `https://api.z.ai/api/paas/v4`.
   - **Coding Plan** (`ZAI_API_BASE` = `https://api.z.ai/api/coding/paas/v4`): na [documentação Z.ai](https://docs.z.ai/api-reference/introduction), este URL destina-se a um conjunto fechado de ferramentas (IDEs, agentes de código). Um **assistente CRM customizado** pode receber erros genéricos (ex. HTTP 500 `Operation failed`). Para chat de produto geral, a Z.ai recomenda **`https://api.z.ai/api/paas/v4`** com **saldo pay-as-you-go** (não defina `ZAI_API_BASE` ou aponte explicitamente para `/paas/v4`). O código do modelo (`glm-4.7`, …) é o mesmo nos dois URLs.
2. Migrações: tabelas `crm_assistant_threads` e `crm_assistant_messages` guardam o **histórico de conversas** por utilizador (RLS). Aplique com `supabase db push` (ou SQL no Dashboard).
3. Deploy: `supabase functions deploy crm-ai-assistant`
4. No app: **Operação → Assistente IA** (`/assistente`). Pode abrir-se a partir de um lead no Kanban; o histórico de conversas fica na coluna esquerda.

A função antiga `user-ai-assistant` foi substituída por esta. Integrações futuras (Meta, WhatsApp, Evolution) podem ampliar o snapshot sem mudar o contrato básico (`messages`, `model`, `context`).

## Canais Meta (oficial) via ManyChat

**Operação sem n8n:** o **ManyChat** fala com a Meta (Instagram, etc.); o **CRM** (Supabase) recebe cada mensagem por HTTPS, grava lead + histórico e gera a resposta da IA no **Edge** (`crm-ai-assistant` + Z.ai). O ManyChat só precisa de **External Request** + passo que envia o campo **`reply`** ao cliente.

**Recomendação de produto:** ManyChat como camada “oficial” para Instagram (e WhatsApp se esse número estiver no ManyChat em paralelo à linha Evolution do CRM).

- Edge Function **`crm-manychat-webhook`**: ManyChat **External Request** com `subscriber_id`, `text`, opcionalmente `phone`; resposta JSON com **`reply`** e `handoff_suggested`.
- Secrets: **`MANYCHAT_CRM_SECRET`**, **`CRM_AI_INTERNAL_SECRET`**, **`ZAI_API_KEY`** (ver [docs/manychat-setup.md](docs/manychat-setup.md)).
- Contratos: [docs/crm-external-http-api.md](docs/crm-external-http-api.md).
- **Passo a passo ManyChat + CRM:** [docs/manychat-setup.md](docs/manychat-setup.md).
- Legado (export n8n / guia de migração antigo): [integrations/n8n/](integrations/n8n/), [docs/n8n-crm-manychat-bridge.md](docs/n8n-crm-manychat-bridge.md) — **não** necessário para o arranque atual.

## WhatsApp (linha técnica no CRM: Evolution ou Meta Cloud direto)

Para o número que o **CRM** envia/recebe fora do ManyChat (ex. Evolution ligado ao Kanban), mantém-se o provider interno:

- Inbound: `crm-whatsapp-webhook` (assinatura + normalização + lead + interação + IA automática quando ativa)
- Outbound: `crm-send-message`
- Triagem: `ai-triage`
- Provider: `WHATSAPP_PROVIDER=evolution|official` (`official` = webhook e envio **diretos** à Meta Cloud API, opcional se todo o atendimento WhatsApp passar pelo ManyChat)

### Secrets (Edge Functions)

Defina no Supabase:

- `WHATSAPP_PROVIDER` (`evolution` por padrão)
- Evolution: `EVOLUTION_API_BASE`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_SECRET` (opcional)
- Meta Cloud **direto** no CRM (`WHATSAPP_PROVIDER=official`, sem ManyChat neste leg): `WHATSAPP_CLOUD_APP_SECRET`, `WHATSAPP_CLOUD_ACCESS_TOKEN`, `WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_VERIFY_TOKEN`, opcional `WHATSAPP_CLOUD_API_VERSION`
- `MANYCHAT_CRM_SECRET` (ManyChat → `crm-manychat-webhook` — **canais Meta “oficiais” via ManyChat, sem n8n**)
- `CRM_AI_INTERNAL_SECRET` (≥16 caracteres): `crm-manychat-webhook` / WhatsApp auto-reply chamam `crm-ai-assistant` com header `x-crm-ai-internal-secret`; sem isto o JSON pode vir com `reply` vazio
- Opcional — Instagram DM após IA: `MANYCHAT_API_KEY` (ManyChat **Settings → API**), `MANYCHAT_DM_FIELD_ID`, `MANYCHAT_DM_FLOW_NS`, opcional `MANYCHAT_SEND_FLOW_MESSAGE_TAG`, `MANYCHAT_PUSH_DISABLED` — ver [docs/manychat-setup.md](docs/manychat-setup.md) §1
- `CRM_WEBHOOK_SECRET` (webhook genérico `crm-ingest-webhook`)
- Opcional — `crm-send-message`: `CRM_MANUAL_SEND_MIN_GAP_SECONDS` (segundos entre envios manuais por lead; `0` desativa), `CRM_SEND_MESSAGE_HOURLY_CAP` (máx. de envios WhatsApp contados na última hora antes de 429)

Deploy:

```bash
supabase functions deploy crm-whatsapp-webhook
supabase functions deploy crm-send-message
supabase functions deploy crm-manychat-webhook
supabase functions deploy crm-ai-assistant
supabase functions deploy ai-triage
supabase functions deploy crm-ingest-webhook
```

### Meta Cloud API direta no CRM (opcional)

Só necessário se quiseres webhook/envio WhatsApp **sem** passar pelo ManyChat. Implementação: `OfficialWhatsappProvider` em `supabase/functions/_shared/whatsapp/official.ts`; multi-linha com `meta_phone_number_id` em `whatsapp_channel_instances` (migração `20260430140000_wa_meta_phone_number_id.sql`). Idempotência: `webhook_jobs` com chave `event:official:…`.

## Rodar local

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Telas principais

- `/dashboard` dashboard operacional configuravel
- `/dashboard-config` configuracao dos cards do dashboard
- `/boards` configuracao de pipelines/etapas
- `/kanban` quadro de leads
- `/assistente` assistente de IA (GLM / Z.ai) sobre dados do CRM conforme RLS
- `/canais` configuracao de canais
- `/metricas` configuracao de metricas
- `/usuarios` gestao de usuarios internos
- `/configuracoes` workflow, permissoes e notificacoes
- `/tv-config` configuracao da tela TV
- `/tv` painel para monitor/televisao

## Checklist de QA antes do go-live

Use com **modo mock** (sem Supabase) ou com **Supabase** ligado, conforme o ambiente de teste.

### Administrador

- Iniciar sessão com perfil admin.
- Abrir **Utilizadores**: convidar ou editar um utilizador (se aplicável ao backend).
- **Canais**: criar ou editar canal, mapear campos com linhas (campo CRM + caminho no payload) e guardar sem erros.
- **Configurações**: adicionar campo ao workflow (rótulo, tipo em português), expandir chave interna só se necessário.
- **TV** e **Dashboard**: alterar título, métrica, posição na grelha e confirmar que a **TV** (`/tv`) e o **dashboard** mostram o esperado.
- **Métricas** e **Quadros**: alterar uma regra e uma etapa e confirmar que persistem após recarregar.

### Gestor

- **Quadros** e **Roteamento** (se tiver permissão): mover lead ou alterar etapa e verificar Kanban.

### SDR

- **Kanban**: arrastar card, abrir detalhe do lead, registar nota ou alteração de estado.
- **Dashboard**: confirmar cards visíveis conforme permissões.

### Qualidade técnica (local ou CI)

```bash
npm run lint
npm run build
```

### Testes E2E (smoke, modo mock)

Na primeira máquina, instale o browser do Playwright: `npx playwright install chromium`.

O servidor de teste usa a porta **5174** para não colidir com `npm run dev` na 5173.

```bash
npm run test:e2e
```
