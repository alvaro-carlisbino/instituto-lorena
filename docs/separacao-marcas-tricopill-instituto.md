# Separação total das marcas: Tricopill × Instituto Lorena

## O que estava misturado

O link de pagamento nascia de uma constante global, não do polo da venda:

- `APP_BASE_URL` em `crmAiOpsExecutor.ts` e `crm-cart-recovery`, default `https://instituto-lorena.vercel.app`
- `window.location.origin` do operador, mandado pelo painel em `crmRede.ts` / `crmAsaas.ts`

Resultado: **as 174 cobranças do Tricopill** (13/jun a 10/ago/26) foram enviadas ao cliente
como `instituto-lorena.vercel.app/pagar/<id>` — domínio interno, marca errada, e a aba do
navegador dizendo "Instituto Lorena CRM · INTERNO" enquanto o cliente digitava o cartão.

O vazamento acontecia nos dois sentidos:

| Ponto | Antes | Agora |
|---|---|---|
| Link de pagamento (Rede e Asaas) | domínio global, sempre o da clínica | domínio do polo, resolvido dentro de `createRedeIntent`/`createAsaasCardIntent` |
| Tela `/pagar/:id` | sem marca nenhuma, título "Instituto Lorena CRM · INTERNO" | marca, telefone e site do polo; título "Pagamento · `<marca>`" |
| Remetente de e-mail | `Tricopill <contato@tricopill.com.br>` para os dois polos | `brand_config.email_from` do polo; vazio = canal desligado |
| Templates de e-mail Tricopill | podiam sair para lead da clínica | recusam qualquer polo que não seja `tricopill` |
| Conversão Meta/GA4 | `event_source_url` e nome de produto fixos em Tricopill | site e nome de marca do polo da venda |
| Placeholder de e-mail no gateway | `cliente@tricopill.com.br` para os dois | `cliente@<domínio do polo>` |

## Onde a marca mora agora

Uma fonte só: `tenants.brand_config`, lida por `supabase/functions/_shared/tenantBrand.ts`.

```jsonc
{
  "app_name":          "Tricopill",
  "checkout_base_url": "https://pagar.tricopill.com.br",       // base do /pagar/<id>
  "site_url":          "https://tricopill.com.br",
  "email_from":        "Tricopill <contato@tricopill.com.br>", // "" desliga o e-mail do polo
  "support_phone":     "+5544999067665"
}
```

**Regra:** nada cai para o outro polo. Marca não configurada => erro (link) ou canal
desligado (e-mail). Mandar com a marca errada é pior que não mandar.

Coberto por `tenantBrand.test.ts` (9 testes), incluindo os casos "polo novo sem domínio
estoura" e "nenhum domínio carrega a marca do outro".

## Domínios

| Polo | Cobrança | Situação em 11/ago/26 |
|---|---|---|
| Tricopill | `pagar.tricopill.com.br` | **falta criar** — `tricopill.com.br` já está na Vercel |
| Instituto Lorena | `pagar.institutolorenavisentainer.com.br` | **falta criar** — apex hospedado fora da Vercel (187.0.210.61) |

`institutolorena.com.br` **não está registrado** (consulta no registro.br em 11/ago/26). O
domínio da clínica é `institutolorenavisentainer.com.br`, de LoviDerm Clínica Médica LTDA.
Se quiserem o nome curto, é preciso registrar antes e trocar o valor na migration.

## Ordem de publicação (importa)

As três partes são acopladas. Publicar uma sem as outras quebra a geração de link:
o painel para de mandar `appBaseUrl` e a função antiga responde `missing_app_base_url`;
a função nova sem a migration não encontra `checkout_base_url` e recusa gerar o link.

1. **DNS + Vercel** — adicionar os dois domínios ao projeto do CRM na Vercel e criar o
   CNAME que a Vercel indicar. Conferir:
   ```bash
   dig +short pagar.tricopill.com.br && curl -sI https://pagar.tricopill.com.br/pagar/x | head -1
   ```
2. **Migration** — `20260811160000_marca_por_polo_nao_se_mistura.sql`. Ela tem uma trava
   final: aborta se algum tenant ativo ficar sem `checkout_base_url`.
3. **Edge functions** — `crm-rede-link`, `crm-rede-pay`, `crm-asaas`, `crm-cart-recovery`,
   `crm-frete-ship`, `crm-tracking-poll`, `crm-subscription-admin`,
   `crm-payment-confirm-watch`, `crm-leadmagnet-followup` (mais tudo que importa
   `rede.ts` / `asaas.ts` / `conversions.ts` / `pagbank.ts`).
4. **Frontend** — push na master.

Conferência depois de publicar: gerar um link de teste em cada polo e olhar o domínio.

```sql
select tenant_id, id, created_at from rede_payments order by created_at desc limit 5;
```

## O que ficou de fora, de propósito

- **E-mail da clínica está desligado** (`email_from: ""`). A conta Resend só tem
  `tricopill.com.br` verificado; o único jeito de a clínica mandar e-mail hoje seria
  assinando como Tricopill. Verificar o domínio da clínica no Resend e preencher
  `email_from` religa o canal, sem deploy.
- **Aviso interno de venda** (para `TEAM_EMAIL`) segue no remetente padrão, mas agora com
  o polo no assunto: `[Tricopill] ...` / `[Instituto Lorena Visentainer] ...`. É e-mail para
  a equipe, não para cliente.
- **Textos de assinatura no `asaas.ts`** ("Assinatura Tricopill — ciclo N") continuam
  literais: o clube de assinatura é produto exclusivo do Tricopill.
- **User-agent do Melhor Envio** (`contato@institutolorena.com.br` em `melhorEnvio.ts`)
  é identificação da integração na API, não vai para o cliente. O remetente da etiqueta
  já é por polo.
