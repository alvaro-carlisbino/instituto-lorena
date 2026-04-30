# Workflows n8n (Instituto Lorena)

Esta pasta guarda **exports de referência** dos fluxos n8n usados com ManyChat e o CRM.

| Ficheiro | Descrição |
|----------|-----------|
| [workflows/Instituto_Lorena_Visentainer_FIXED.json](workflows/Instituto_Lorena_Visentainer_FIXED.json) | Referência legada: ManyChat → debounce Postgres → OpenAI Agent + memória Postgres → setField **14539456** + **sendFlow** `content20260430143025_638461`. No produto actual o mesmo raciocínio corre no CRM com **Z.ai**. |

**Segurança:** o JSON do n8n contém IDs de credenciais e metadados da instância; **não** inclui passwords em texto claro, mas não publiques o repositório como público sem rever o export.

**Operação actual:** IA (Z.ai) e histórico no CRM **sem** n8n — ver [docs/manychat-setup.md](../../docs/manychat-setup.md). O guia [docs/n8n-crm-manychat-bridge.md](../../docs/n8n-crm-manychat-bridge.md#mapa-n8n-fixed-zai) descreve o **mapa 1:1** do `Instituto_Lorena_Visentainer_FIXED.json` (OpenAI) para o stack Supabase + Z.ai; o JSON em `workflows/` espelha o export que tinhas no n8n.
