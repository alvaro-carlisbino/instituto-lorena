# Workflows n8n (Instituto Lorena)

Esta pasta guarda **exports de referência** dos fluxos n8n usados com ManyChat e o CRM.

| Ficheiro | Descrição |
|----------|-----------|
| [workflows/Instituto_Lorena_Visentainer_FIXED.json](workflows/Instituto_Lorena_Visentainer_FIXED.json) | Referência legada: ManyChat → debounce Postgres → OpenAI Agent + memória Postgres → setField **14539456** + **sendFlow** `content20260430143025_638461`. |
| [workflows/Instituto_Lorena_Visentainer_CRM_v2.json](workflows/Instituto_Lorena_Visentainer_CRM_v2.json) | **Importar no n8n:** debounce + contexto + **CRM** + **Z.ai**; DM ao cliente com **um só** `POST /fb/sending/sendContent` (evita duplicar setField+sendFlow). Credenciais: Postgres, Header Auth CRM, Header Auth Z.ai, Bearer ManyChat. |

**Segurança:** o JSON do n8n contém IDs de credenciais e metadados da instância; **não** inclui passwords em texto claro, mas não publiques o repositório como público sem rever o export.

**Duas operações:** (1) ManyChat → CRM directo com IA no Edge (Z.ai) — [docs/manychat-setup.md](../../docs/manychat-setup.md). (2) ManyChat → **n8n** (debounce, Z.ai no n8n) → CRM como **tools** HTTP — [docs/n8n-crm-tools.md](../../docs/n8n-crm-tools.md); **guia operacional copy-paste:** [docs/n8n-workbook-crm-ready.md](../../docs/n8n-workbook-crm-ready.md). O guia [docs/n8n-crm-manychat-bridge.md](../../docs/n8n-crm-manychat-bridge.md#mapa-n8n-fixed-zai) compara nó-a-nó o `Instituto_Lorena_Visentainer_FIXED.json` com o stack actual.
