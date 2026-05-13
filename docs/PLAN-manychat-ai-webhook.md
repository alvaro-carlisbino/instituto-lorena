# PLAN-manychat-ai-webhook

## Overview
Transição da API não oficial do WhatsApp para a API Oficial via ManyChat. O fluxo recebe requisições External Request do ManyChat (webhook), faz o "ack" imediato em modo assíncrono para evitar timeouts, processa a mensagem do lead usando a IA do CRM (que já gerencia o histórico via Supabase), e finalmente usa a API do ManyChat para setar a resposta em uma variável/custom field e disparar o fluxo de envio (`/sendFlow`).

## Project Type
**BACKEND**

## Success Criteria
- [x] Webhook retorna HTTP 200 de imediato (modo assíncrono) para prevenir retentativas do ManyChat.
- [x] Histórico e contexto da conversa do WhatsApp são salvos no banco `interactions` associado ao `lead_id`.
- [x] A resposta gerada pela IA é registrada no custom field definido no ManyChat.
- [x] O fluxo de ManyChat correto é acionado chamando a rota da API (ex: `/wa/sending/sendFlow` ou `/fb/sending/sendFlow`).

## Tech Stack
- **Supabase Edge Functions (Deno)**: Ambiente serverless onde o webhook já roda.
- **ManyChat REST API**: Usaremos `/subscriber/setCustomField` para armazenar a resposta e a rota de envio de flow para ativar a automação no painel do ManyChat.
- **PostgreSQL (Supabase)**: Já usado para salvar `crm_conversation_states` e `interactions`.

## File Structure
- `supabase/functions/_shared/manychatPublicApi.ts`: Inclusão das rotas específicas para WhatsApp.
- `supabase/functions/crm-manychat-webhook/index.ts`: Atualização para reconhecer o canal (WhatsApp vs Instagram) e despachar a resposta para o endpoint ManyChat adequado.

## Task Breakdown

### Task 1: Adicionar suporte a WhatsApp Push na API Compartilhada
- **Agent:** `backend-specialist`
- **Skills:** `api-patterns`
- **Input:** `supabase/functions/_shared/manychatPublicApi.ts`
- **Output:** Nova função `pushManychatWhatsappDmAfterReply` que faz um POST para o ManyChat gravando a variável e chamando `/wa/sending/sendFlow` (ou a rota genérica/correspondente).
- **Verify:** A função compila sem erros de tipo e a formatação do JSON corresponde à doc do ManyChat.

### Task 2: Atualizar o Webhook do ManyChat para Roteamento
- **Agent:** `backend-specialist`
- **Skills:** `nodejs-best-practices`
- **Input:** `supabase/functions/crm-manychat-webhook/index.ts`
- **Output:** Ao receber o payload do ManyChat, verificar de onde veio a requisição (por exemplo, lendo uma variável `channel` do payload ou configurando via `.env`). Se for WhatsApp, usar a nova função criada na Task 1 em background.
- **Verify:** Em modo dev, ao simular a requisição do WhatsApp, a função executa a pipeline async e chama a API do WhatsApp.

### Task 3: Gerir Variáveis de Ambiente
- **Agent:** `backend-specialist`
- **Skills:** `deployment-procedures`
- **Input:** `.env.example` / `_shared/manychatPublicApi.ts`
- **Output:** Criar as vars `MANYCHAT_WA_DM_FIELD_ID` e `MANYCHAT_WA_DM_FLOW_NS` para que o WhatsApp possa apontar para o flow correto (já que é um canal diferente do IG).
- **Verify:** `readManychatPushConfigFromEnv` consegue ler e retornar as configurações do WhatsApp com fallbacks seguros.

## Phase X: Verification
- [x] Linting and type-checking das Edge Functions.
- [x] Security Scan (verificação de que o secret do webhook está sendo verificado).
- [x] Teste manual usando cURL ou Postman para disparar um webhook mock do WhatsApp.
- [x] Mensagem de Sucesso gerada com a finalização do setup.

## ✅ PHASE X COMPLETE
- Lint: ✅ Pass (as edges de Manychat)
- Date: 2026-05-13
