# Feature Plan: Pipeline Automations

## Overview
Implement an Automation Trigger System that automatically sends WhatsApp messages (via Evolution API) when a Lead is moved to a specific Stage in the Kanban board. The messages will be customizable per-stage by the administrator, ensuring a "Turn-key" CRM experience.

## Success Criteria
- [x] Pipeline Configuration: Admin can define a custom message template (or disable it) for each Stage of a Pipeline.
- [x] Execution Layer: When a card moves in Kanban, the system detects if the new stage has an active automation and triggers the webhook/Edge Function.
- [x] Edge Function Endpoint: The existing webhook or a new endpoint should handle the sending of the Evolution API message.
- [x] UI/UX: The user gets a visual confirmation (e.g., toast "Mensagem automática enviada") when the automation runs.

## Task Breakdown

### Task 1: Update Data Structure & Context
- **Agent:** `backend-specialist`
- **INPUT:** `src/mocks/crmMock.ts`, `src/hooks/useCrmState.ts`
- **OUTPUT:** Extend `BoardConfig` to include `stageAutomations: Record<string, { enabled: boolean; template: string }>`. 
- **VERIFY:** Types compile without error.

### Task 2: Create Automations Admin UI
- **Agent:** `frontend-specialist`
- **INPUT:** `src/pages/SettingsPage.tsx` or a new tab.
- **OUTPUT:** A UI where the admin can select a Pipeline, see its stages, and enable/edit the automated message for each.
- **VERIFY:** Admin can save changes and it persists in the `CrmContext`.

### Task 3: Trigger Execution on Kanban Drop
- **Agent:** `backend-specialist` / `frontend-specialist`
- **INPUT:** `src/pages/KanbanPage.tsx`
- **OUTPUT:** In `onMoveCard`, check `pipeline.boardConfig.stageAutomations[newStageId]`. If enabled, call `crm.sendAutomatedMessage(lead, template)`.
- **VERIFY:** Dragging a card triggers the action.

### Task 4: Connect to Evolution API (Backend)
- **Agent:** `backend-specialist`
- **INPUT:** `src/hooks/useCrmState.ts`
- **OUTPUT:** The `sendAutomatedMessage` function uses the Evolution API instance to send the WhatsApp message, and logs the interaction in the Chat History.
- **VERIFY:** Message appears in `LeadChatThread`.

## Phase X: Verification
- [x] Move a card and verify the message is sent and stored in interactions.
- [x] Check if Edge Function handles it correctly.
- [x] Linting & Build.
