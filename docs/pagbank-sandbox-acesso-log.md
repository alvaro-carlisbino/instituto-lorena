# PagBank — Log de requisição (SANDBOX)

Conta/Loja: **Tricopill** · E-mail do cadastro: **fabriciobeltrani@gmail.com**
Ambiente: **SANDBOX** · Endpoint: `POST https://sandbox.api.pagseguro.com/orders` · Data/hora: **2026-06-17 13:12:25 UTC**
Resultado: **HTTP 201**

**IDs de rastreio:** x-amzn-requestid `36b23a1b-1643-4bef-973f-5697d3e32dfe` · cf-ray `a0d24e498c7caf70-GRU`

## Requisição
```http
POST https://sandbox.api.pagseguro.com/orders
Authorization: Bearer 91b1b724...d299d6 (100 chars)
Content-Type: application/json
accept: application/json
```
```json
{
  "reference_id": "teste-conexao-tricopill",
  "customer": {
    "name": "Teste Conexao",
    "email": "teste@tricopill.com.br",
    "tax_id": "12345678909"
  },
  "items": [
    {
      "reference_id": "teste",
      "name": "Teste conexao PIX",
      "quantity": 1,
      "unit_amount": 100
    }
  ],
  "qr_codes": [
    {
      "amount": {
        "value": 100
      },
      "expiration_date": "2026-06-17T14:12:25-03:00"
    }
  ],
  "notification_urls": [
    "https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-pagbank-webhook"
  ]
}
```

## Resposta (HTTP 201)
Headers:
```
HTTP/2 201 
date: Wed, 17 Jun 2026 13:12:26 GMT
content-type: application/json
content-length: 1392
cf-ray: a0d24e498c7caf70-GRU
cf-cache-status: DYNAMIC
cache-control: no-cache, no-store, max-age=0, must-revalidate
expires: 0
server: cloudflare
strict-transport-security: max-age=15552000; includeSubDomains
pragma: no-cache
referrer-policy: no-referrer
x-amz-apigw-id: fG2BHHEPIAMEZ5g=
x-amzn-remapped-connection: keep-alive
x-amzn-remapped-content-length: 1392
x-amzn-remapped-date: Wed, 17 Jun 2026 13:12:26 GMT
x-amzn-remapped-server: envoy
x-amzn-requestid: 36b23a1b-1643-4bef-973f-5697d3e32dfe
x-content-type-options: nosniff
x-envoy-upstream-service-time: 295
x-frame-options: DENY
x-xss-protection: 1 ; mode=block
vary: accept-encoding

```
Body:
```json
{
  "id": "ORDE_339980F2-EBE9-4A8E-82CE-266B1BEE6354",
  "reference_id": "teste-conexao-tricopill",
  "created_at": "2026-06-17T10:12:26.098-03:00",
  "customer": {
    "name": "Teste Conexao",
    "email": "teste@tricopill.com.br",
    "tax_id": "12345678909"
  },
  "items": [
    {
      "reference_id": "teste",
      "name": "Teste conexao PIX",
      "quantity": 1,
      "unit_amount": 100
    }
  ],
  "qr_codes": [
    {
      "id": "QRCO_24C17A60-AF0A-4C6F-AD5E-4B610A7D8201",
      "expiration_date": "2026-06-17T14:12:25.000-03:00",
      "amount": {
        "value": 100
      },
      "text": "00020101021226850014br.gov.bcb.pix2563api-h.pagseguro.com/pix/v2/24C17A60-AF0A-4C6F-AD5E-4B610A7D82015204899953039865802BR5922HEALTH & BEAUTY SOLUTI6007Maringa62070503***6304D080",
      "arrangements": [
        "PIX"
      ],
      "links": [
        {
          "rel": "QRCODE.PNG",
          "href": "https://sandbox.api.pagseguro.com/qrcode/QRCO_24C17A60-AF0A-4C6F-AD5E-4B610A7D8201/png",
          "media": "image/png",
          "type": "GET"
        },
        {
          "rel": "QRCODE.BASE64",
          "href": "https://sandbox.api.pagseguro.com/qrcode/QRCO_24C17A60-AF0A-4C6F-AD5E-4B610A7D8201/base64",
          "media": "text/plain",
          "type": "GET"
        }
      ]
    }
  ],
  "notification_urls": [
    "https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-pagbank-webhook"
  ],
  "links": [
    {
      "rel": "SELF",
      "href": "https://sandbox.api.pagseguro.com/orders/ORDE_339980F2-EBE9-4A8E-82CE-266B1BEE6354",
      "media": "application/json",
      "type": "GET"
    },
    {
      "rel": "PAY",
      "href": "https://sandbox.api.pagseguro.com/orders/ORDE_339980F2-EBE9-4A8E-82CE-266B1BEE6354/pay",
      "media": "application/json",
      "type": "POST"
    }
  ]
}
```
