# Feature Plan: Kanban Checkboxes & Custom Fields

## Overview
Implement support for `boolean` custom fields (checkboxes/switches) across the CRM, particularly addressing the user's request for "campos, checkbox, follow-ups" to be supported by default. This enables clinics to create custom Yes/No tracking fields (like "Primeira Consulta?") that are immediately editable in the Lead Sidebar and visibly represented as ✅ / ⬜ on Kanban cards.

## Success Criteria
- [x] Data Mock: Add `boolean` to `WorkflowField` types and inject an initial `primeira_consulta` checkbox.
- [x] Settings Page: Admin can now create custom fields of type `boolean` (Sim/Não Checkbox).
- [x] Dynamic Renderer: The `DynamicFieldRenderer` natively supports `boolean` fields, rendering them as a toggle Switch.
- [x] Kanban Views: Both `KanbanLeadCard` and `KanbanListView` display boolean states with visual indicators (✅ / ⬜).

## Task Breakdown
- **Agent:** `frontend-specialist`

### Phase X: Verification
- [x] Ensure `boolean` type renders correctly in Kanban cards.
- [x] Ensure it can be toggled inside the chat workspace.
- [x] Linting & Build.
