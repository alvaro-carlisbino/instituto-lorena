# Propostas comerciais

Pasta para versionamento das propostas comerciais relacionadas ao CRM do Instituto Lorena e expansões para empresas associadas.

## Tricopill / Limitless

| Versão | Arquivo | Resumo |
|---|---|---|
| v3 (atual) | [Proposta_Tricopill_Instituto_Lorena_v3.docx](./Proposta_Tricopill_Instituto_Lorena_v3.docx) / [PDF](./Proposta_Tricopill_Instituto_Lorena_v3.pdf) | E-commerce 100% IA Tricopill + 3 expansões Instituto. 22 páginas, R$ 52k setup + R$ 4.8k/mês. Inclui premissas, arquitetura, métricas, decisões pendentes, riscos e glossário. |

### Como editar e regerar

O `.docx` é gerado a partir do script JS correspondente (`*.build.js`) usando a biblioteca `docx-js`. Para regerar após edição do script:

```bash
# Instalar docx globalmente (uma vez)
npm install -g docx

# Regenerar
cd /tmp && mkdir -p proposta-build && cd proposta-build
cp /Users/alvarocarlisbino/Documents/instituto-lorena/docs/propostas/Proposta_Tricopill_Instituto_Lorena_v3.build.js build.js
NODE_PATH="$(npm root -g)" node build.js
# Output em ~/Downloads/Proposta_Tricopill_Instituto_Lorena_v3.docx
```

Para converter pra PDF (precisa LibreOffice instalado):

```bash
soffice --headless --convert-to pdf ~/Downloads/Proposta_Tricopill_Instituto_Lorena_v3.docx --outdir ~/Downloads/
```
