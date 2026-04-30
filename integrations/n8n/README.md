# Workflows n8n (Instituto Lorena)

Esta pasta guarda **exports de referência** dos fluxos n8n usados com ManyChat e o CRM.

| Ficheiro | Descrição |
|----------|-----------|
| [workflows/Instituto_Lorena_Visentainer_FIXED.json](workflows/Instituto_Lorena_Visentainer_FIXED.json) | Fluxo original: webhook ManyChat → debounce Postgres → OpenAI (Agent) → memória Postgres → ManyChat (custom field + flow). |

**Segurança:** o JSON do n8n contém IDs de credenciais e metadados da instância; **não** inclui passwords em texto claro, mas não publiques o repositório como público sem rever o export.

**Próximo passo (IA no CRM):** seguir [docs/n8n-crm-manychat-bridge.md](../../docs/n8n-crm-manychat-bridge.md) para substituir o nó **AI Agent** por um pedido HTTP ao `crm-manychat-webhook`, mantendo debounce e envio ManyChat no n8n.
