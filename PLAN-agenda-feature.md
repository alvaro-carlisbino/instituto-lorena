# Feature Plan: Visual Agenda & Chat Scheduling

## Overview
Transform the current text-based `AgendaPage.tsx` into a highly visual, daily/weekly timeline calendar. Additionally, enable quick and intuitive appointment scheduling directly from the `ChatWorkspacePage.tsx` (via slash command or inline widget), drastically improving user workflow.

## Success Criteria
- [x] `AgendaPage.tsx` displays a visual timeline (Day/Week view) constructed with Tailwind, avoiding heavy external calendar libraries.
- [x] Appointments show up as blocks on the timeline.
- [x] In `LeadChatThread.tsx` or `ChatWorkspacePage.tsx`, typing `/agendar` opens a quick-scheduling popover/modal pre-filled with the current Lead.
- [x] The scheduling component links Lead + Date/Time + Room + Professional.

## Task Breakdown

### Task 1: Build the Visual Timeline Component
- **Agent:** `frontend-specialist`
- **Skills:** `frontend-design`
- **INPUT:** `src/pages/AgendaPage.tsx`
- **OUTPUT:** A custom timeline grid showing hours on the Y-axis and days (or rooms) on the X-axis. 
- **VERIFY:** Appointments overlay correctly on the grid based on `startsAt` and `endsAt`.

### Task 2: Create the Universal Scheduling Widget
- **Agent:** `frontend-specialist`
- **Skills:** `frontend-design`
- **INPUT:** `src/components/leads/` (Create `ScheduleAppointmentDialog.tsx` or similar)
- **OUTPUT:** A polished form connecting Lead, Date, Time, Duration, and Room.
- **VERIFY:** It successfully saves an `Appointment` to the CRM context.

### Task 3: Integrate Scheduling into Chat
- **Agent:** `frontend-specialist`
- **INPUT:** `src/components/leads/LeadChatThread.tsx`, `ChatWorkspacePage.tsx`
- **OUTPUT:** Implement a `/agendar` slash command listener in the chat input, or a dedicated "Agendar" button near the text area.
- **VERIFY:** Triggering the action opens the Universal Scheduling Widget for the active lead.

## Phase X: Verification
- [x] Verify if appointments span the correct duration visually.
- [x] Test the `/agendar` flow.
- [x] Linting & Build.
