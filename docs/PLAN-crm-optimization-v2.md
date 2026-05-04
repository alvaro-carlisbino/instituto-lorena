# PLAN-crm-optimization-v2.md - Otimização de Fluxo e Automação

Este plano detalha a implementação de melhorias críticas para o SDR, automações de follow-up e refinamento visual do Pipeline do Instituto Lorena.

---

## 🛠️ Fase 1: Visibilidade e UX (Kanban & Chat)

### 1.1 Indicadores no Kanban
- **Badge de Status IA**: Adicionar um indicador visual no card do lead mostrando se ele está em "Triagem IA" ou "Aguardando SDR" (quando a IA para).
- **Filtro de Ociosidade**: Implementar no topo do Kanban um filtro para ordenar leads que estão há mais tempo sem resposta (calculado por `last_inbound_at` vs `last_interaction_at`).
- **Resumo de Progresso**: Exibir no card o "Tipo de Atendimento" identificado pela IA (ex: "Transplante Masculino").

### 1.2 Mensagens Rápidas (Shortcuts)
- **Interface de Atalhos**: No `LeadChatThread`, implementar o acionador `/` (barra) para abrir uma lista de mensagens pré-padronizadas.
- **Configuração**: Adicionar aba na página de Settings para gerenciar esses templates de mensagens.

### 1.3 Motivo de Perda
- **Modal de Encerramento**: Ao mover um lead para a etapa "Encerrado", abrir um modal obrigatório perguntando o motivo da perda e permitindo uma observação.

---

## 🔔 Fase 2: Sistema de Notificações In-App

### 2.1 Engine de Notificação
- **DB**: Criar tabela `crm_notifications` (id, user_id, lead_id, message, read, created_at).
- **Trigger**: No `crm-whatsapp-webhook`, quando a IA devolver a tag `[PRONTO_PARA_CONSULTOR]`, inserir uma notificação para o SDR/Dandara.
- **Realtime**: Usar Supabase Realtime para que o sino de notificação no CRM balance/acenda na hora.

---

## 🤖 Fase 3: Automações de Follow-up (D1/D3/D5)

### 3.1 Fila de Automação
- **Lógica**: Criar uma Edge Function agendada (Cron) que verifica leads nas etapas de "Follow UP".
- **Regra de Interrupção**: Se houver qualquer mensagem `inbound` do paciente após a entrada na etapa, a automação de follow-up é cancelada para esse lead.
- **Templates**: Definir mensagens específicas para o Dia 1, 3 e 5.

### 3.2 Movimentação de Pipeline
- **Transição de Sucesso**: Ao marcar um atendimento como "Realizado" no agendamento, mover automaticamente o lead para o Pipeline de "Transplante Capilar" ou "Protocolo" (via parâmetro de configuração).

---

## 📋 Checklist de Verificação

### [ ] UX
- [ ] O card no Kanban mostra claramente quem deve falar agora (IA ou Humano)?
- [ ] O atalho `/` no chat carrega as mensagens rápidas?

### [ ] Automação
- [ ] O follow-up do Dia 3 não é enviado se o lead respondeu no Dia 2?
- [ ] O lead "pula" de pipeline após a consulta realizada?

### [ ] Notificação
- [ ] O SDR recebe um alerta visual na plataforma quando a IA termina a triagem?

---

## Próximos Passos
1. Validar os textos dos Follow-ups (D1, D3, D5).
2. Definir os motivos de perda padrão (Preço, Concorrência, Desistência, etc).
3. Iniciar execução via `/create`.
