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
