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
2. Deploy: `supabase functions deploy crm-ai-assistant`
3. No app, abra **Operação → Assistente IA** ou `/assistente`. Opcional: `?leadId=<uuid>&focus=lead` para contexto de um lead.

A função antiga `user-ai-assistant` foi substituída por esta. Integrações futuras (Meta, WhatsApp, Evolution) podem ampliar o snapshot sem mudar o contrato básico (`messages`, `model`, `context`).

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
