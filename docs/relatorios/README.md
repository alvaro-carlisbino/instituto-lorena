# Relatórios

Documentos técnico-comerciais sobre o estado do CRM e operação. Servem como referência para apresentar o sistema a terceiros (decisores, parceiros, novos usuários).

## Estado atual do CRM

| Documento | Quando usar |
|---|---|
| [Relatorio_CRM_Instituto_Lorena_Estado_Atual.docx](./Relatorio_CRM_Instituto_Lorena_Estado_Atual.docx) / [PDF](./Relatorio_CRM_Instituto_Lorena_Estado_Atual.pdf) | Apresentar o que está em produção hoje (módulos, stack, segurança, linha do tempo) para decisores avaliando expansão (ex.: Tricopill/Limitless). |

### Como editar e regerar

Igual ao processo da pasta `docs/propostas/`:

```bash
cd /tmp && mkdir -p relatorio-build && cd relatorio-build
cp /Users/alvarocarlisbino/Documents/instituto-lorena/docs/relatorios/Relatorio_CRM_Instituto_Lorena_Estado_Atual.build.js build.js
NODE_PATH="$(npm root -g)" node build.js
# Output em ~/Downloads/Relatorio_CRM_Instituto_Lorena_Estado_Atual.docx
```
