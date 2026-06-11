# Atribuição de campanha Meta (anúncios de conversa)

Captura **de qual anúncio/campanha veio o lead** nos anúncios *Click-to-WhatsApp* e
*Click-to-Instagram* (anúncios de conversa). O dado é gravado uma única vez, na
**primeira mensagem** após o clique (regra *first-touch*), e fica visível no
detalhe do lead, no bloco **"Origem da campanha"**.

> Lead Ads (formulário dentro do Facebook/Instagram) é uma frente separada
> (`crm-meta-leadform-webhook`) e não está coberta aqui.

## Como o dado chega

| Caminho | De onde vem a atribuição | Ação necessária |
|---|---|---|
| **ManyChat** (caminho principal) | Campos de anúncio mapeados no corpo do External Request | Configurar o ManyChat (abaixo) |
| **WhatsApp Cloud oficial** | Objeto `referral` nativo da mensagem (`msg.referral`) | Nada — automático |
| **Evolution** (provider atual) | — não recebe `referral` | Sem atribuição por este caminho |

O que o CRM grava em cada lead:

- `attribution` (jsonb) — bloco bruto do anúncio.
- `attribution_channel` — `ctwa_whatsapp` | `ctwa_instagram`.
- `attribution_campaign` — campanha (quando disponível; indexada).
- `attribution_ad_id` — ID do anúncio (indexado).
- Espelho compacto em `custom_fields.attribution` (o front lê daqui).

## Configuração no ManyChat (caminho principal)

No mesmo **External Request** já usado para o CRM (ver
[manychat-setup.md](manychat-setup.md)), acrescente os campos de anúncio ao
corpo JSON. O CRM aceita tanto um objeto `attribution` aninhado quanto campos
soltos no topo — use o que for mais fácil de mapear no editor do ManyChat.

**Objeto aninhado (recomendado):**

```json
{
  "subscriber_id": "{{subscriber.id}}",
  "user_name": "{{subscriber.first_name}} {{subscriber.last_name}}",
  "text": "{{last_input_text}}",
  "external_message_id": "{{conversation.id}}-{{message.id}}",
  "channel": "whatsapp",
  "attribution": {
    "ad_id": "{{last_ad_id}}",
    "ad_title": "{{last_ad_title}}",
    "campaign": "{{last_ad_campaign}}",
    "source_url": "{{last_ad_url}}",
    "ctwa_clid": "{{ctwa_clid}}"
  }
}
```

**Campos soltos (alternativa):** `ad_id`, `ad_title`, `campaign`, `source_url`,
`ctwa_clid` diretamente na raiz do JSON.

Notas:

- Os nomes `{{...}}` dependem do que o ManyChat expõe na sua conta (System
  Fields de "Last Ad" / referral, ou custom fields que você preenche num passo
  anterior do fluxo). Ajuste ao editor.
- **Todos os campos são opcionais.** Se nenhum vier, o lead simplesmente fica sem
  atribuição — comportamento idêntico ao de hoje, sem erro.
- Como a regra é *first-touch*, basta o anúncio aparecer na **primeira** mensagem;
  mensagens seguintes podem mandar os campos vazios sem problema.

## Configuração no WhatsApp Cloud oficial

Nada a fazer no código — o parser já lê `msg.referral`. Requisitos do lado da Meta:

- O número estar na **WhatsApp Cloud API** (provider `official`), não no Evolution.
- Os anúncios serem do tipo **Click-to-WhatsApp** apontando para esse número.

A Meta entrega `referral` automaticamente na primeira mensagem originada do anúncio.

## Como validar

1. Clique num anúncio de conversa de teste e mande a primeira mensagem.
2. Abra o lead no CRM → deve aparecer o bloco **"Origem da campanha"**.
3. Em SQL, confira as colunas indexadas:

```sql
select id, patient_name, attribution_channel, attribution_campaign, attribution_ad_id
from leads
where attribution_channel is not null
order by created_at desc
limit 20;
```

## Próximos passos

- **Lead Ads (Frente B):** webhook `crm-meta-leadform-webhook` + app Meta com
  `leads_retrieval`. Reaproveita estas mesmas colunas (`attribution_channel =
  'lead_ads'`).
- **Dashboard "leads por campanha":** as colunas já estão indexadas para o
  agrupamento; o painel agregado entra depois de confirmar que o dado chega limpo.
