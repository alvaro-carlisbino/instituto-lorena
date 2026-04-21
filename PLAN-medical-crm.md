# UI/UX Revamp: Instituto Lorena CRM (Medical Clinic)

## Overview
A complete UI/UX overhaul of the "Instituto Lorena" internal CRM. The CRM is used internally by a medical clinic. The current interface has usability bugs (dropdowns rendering incorrectly over the screen, non-functional sidebar) and a generic "AI-generated" appearance. We will rebuild the layout, refine the design system to fit a professional corporate/medical context, and fix usability issues to ensure maximum efficiency for the internal staff.

## Project Type
WEB (React, Vite, Tailwind v4, Shadcn)

## Success Criteria
- [ ] Visual identity conveys a trusted, clean medical/corporate feeling.
- [ ] Sidebar navigation functions correctly (collapsible, responsive).
- [ ] Dropdowns, Popovers, and Select menus open gracefully with correct `z-index`.
- [ ] Kanban and Dashboard pages are visually hierarchized and easy to read.

## Tech Stack
- Frontend: React + Vite
- Styling: Tailwind CSS v4, Shadcn UI
- Fonts: Geist Variable
- Verification: Agent UI Audit Scripts

## File Structure
- `src/index.css`
- `src/layouts/*` 
- `src/components/ui/*`
- `src/pages/DashboardPage.tsx`, `src/pages/KanbanPage.tsx`

## Task Breakdown

### Task 1: Implement Medical Corporate Design System
- **Agent:** `frontend-specialist` 
- **Skills:** `frontend-design`, `tailwind-patterns`
- **INPUT:** `src/index.css`
- **OUTPUT:** Updated `index.css` with a tailored clean-medical color palette.
- **VERIFY:** UI buttons and cards reflect a professional color scheme.

### Task 2: Rebuild Application Layout & Sidebar
- **Agent:** `frontend-specialist`
- **Skills:** `frontend-design`
- **INPUT:** `src/layouts/`, `src/App.tsx`
- **OUTPUT:** A functional Sidebar that toggles and highlights active routes properly.
- **VERIFY:** Nav items route correctly; sidebar collapses smoothly.

### Task 3: Fix Dropdown & Z-Index Usability Bugs
- **Agent:** `frontend-specialist`
- **Skills:** `clean-code`
- **INPUT:** `src/components/ui/select.tsx`, dropdown menus.
- **OUTPUT:** Functional dropdowns floating correctly.
- **VERIFY:** Dropdowns open reliably without pushing page content.

### Task 4: Revamp Proving Grounds (Dashboard & Kanban)
- **Agent:** `frontend-specialist`
- **Skills:** `frontend-design`
- **INPUT:** `src/pages/DashboardPage.tsx`, `src/pages/KanbanPage.tsx`
- **OUTPUT:** Polished flagship pages matching the new design.
- **VERIFY:** Visual inspection confirms a massive improvement.

## Phase X: Verification
- [ ] Linting & Build: `npm run lint && npm run build`
- [ ] UX Audit Script execution.
