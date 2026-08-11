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

| Polo | Cobrança | Situação |
|---|---|---|
| Tricopill | `pagar.tricopill.com.br` | **no ar** — serve o checkout do próprio site (Next.js), com Pix além do cartão, lendo a mesma `rede_payments` |
| Instituto Lorena | `instituto-lorena.vercel.app` | domínio do próprio CRM, provisório — a clínica não tem site com checkout, o link cai na tela `/pagar/:id` do CRM |

Para dar um subdomínio bonito à clínica (`pagar.institutolorenavisentainer.com.br`), aponte
um domínio novo para o **projeto do CRM** na Vercel e troque `checkout_base_url` no banco.
Não precisa de deploy.

`institutolorena.com.br` **não está registrado** (consulta no registro.br em 11/ago/26). O
domínio da clínica é `institutolorenavisentainer.com.br`, de LoviDerm Clínica Médica LTDA.
Se quiserem o nome curto, é preciso registrar antes e trocar o valor na migration.

## Publicado em 11/ago/26

Config no banco, 22 edge functions (fecho transitivo de quem importa os módulos
alterados) e frontend na master. As partes são acopladas — publicar uma sem as outras
quebra a geração de link, então numa próxima vez siga: config → functions → frontend.

Conferência (o segundo campo mostra onde o link nasceria hoje):

```sql
select p.id, p.tenant_id, i.tenant_id as polo_da_linha,
       (select brand_config->>'checkout_base_url' from tenants t
         where t.id = coalesce(i.tenant_id, p.tenant_id)) || '/pagar/' || p.id as link
from rede_payments p
left join leads l on l.id = p.lead_id
left join whatsapp_channel_instances i on i.id = l.whatsapp_instance_id
where p.status = 'pending' order by p.created_at desc limit 5;
```

## Segundo bug, achado na conferência: a venda seguia a PESSOA, não a LINHA

Quem é paciente da clínica **e** cliente do Tricopill vive no tenant da clínica e escreve
na linha do Tricopill. O `crmAiOpsExecutor` carimbava a cobrança com o tenant do **lead**,
então em 11/ago/26 dois kits Tricopill viraram venda da clínica:

| Cobrança | Estado | Estrago |
|---|---|---|
| `fdf961a7f7244742` | paga 14:19 | pedido Bling **26573386331** no CNPJ da clínica |
| `c2d86cec5fe84d63` | pendente | link sairia com a marca da clínica |

A conta Rede é a mesma nos dois polos (mesmo PV e token), então **nenhum dinheiro caiu na
conta errada** — o estrago é de estoque, nota e atribuição de receita.

Corrigido: cobranças, frete e o aviso de venda quente passam a usar o tenant da **linha**
de WhatsApp vinculada ao lead. A pessoa segue o polo dela; a venda segue a linha, porque é
a linha que define catálogo, cupom, gateway, Bling e marca.

**Os dois registros acima continuam com o polo errado no banco** — o fix é para frente. Ver
"Pendências".

## Pendências

- Corrigir `c2d86cec5fe84d63` (pendente) para `tenant_id = 'tricopill'`, senão, se o cliente
  pagar, nasce outro pedido no Bling da clínica.
- Decidir o que fazer com o pedido Bling `26573386331`, já emitido na clínica.
- Subdomínio próprio para o checkout da clínica (opcional, ver acima).
- Verificar o domínio da clínica no Resend para religar o e-mail dela.

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
