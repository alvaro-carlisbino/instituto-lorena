# CRM Limitless - Frontend + Supabase

Este projeto ja roda em dois modos:

- `mock`: dados locais para prototipacao
- `supabase`: leitura/escrita real no Supabase

## Configuracao

1. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

2. Preencha:

- `VITE_DATA_MODE=mock` ou `VITE_DATA_MODE=supabase`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` (ou `VITE_SUPABASE_PUBLISHABLE_KEY`)

## Supabase (primeiro uso)

1. Abra o SQL Editor do Supabase.
2. Rode o script `supabase/schema.sql`.
3. No app, clique em `Seed usuarios + dados`.

Isso cria usuarios de teste e dados iniciais de pipeline/leads/interacoes.

Usuarios de teste criados:

- Ana Costa (sdr)
- Bruno Lima (sdr)
- Carla Souza (sdr)
- Diego Moura (gestor)

## Rodar local

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Deploy na Vercel

1. Conectar repo GitHub na Vercel.
2. Confirmar framework `Vite`.
3. Definir variaveis:
   - `VITE_DATA_MODE`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY` ou `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Deploy.

## Arquivos principais

- `src/App.tsx`: UI e acoes principais (sync/seed)
- `src/services/crmSupabase.ts`: camada de dados Supabase
- `src/lib/supabaseClient.ts`: cliente Supabase
- `supabase/schema.sql`: schema minimo para comecar
