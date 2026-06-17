# PagBank — Log de requisição (PRODUCAO)

Conta/Loja: **Tricopill** · E-mail do cadastro: **fabriciobeltrani@gmail.com**
Ambiente: **PRODUCAO** · Endpoint: `POST https://api.pagseguro.com/orders` · Data/hora: **2026-06-17 13:12:26 UTC**
Resultado: **HTTP 403**

**IDs de rastreio:** x-amzn-requestid `b2c74591-eb1a-4919-8022-3b3fc2b8fce2` · cf-ray `a0d24e4ffa7dd7b2-GRU`

## Requisição
```http
POST https://api.pagseguro.com/orders
Authorization: Bearer 65e04e14...fdcc5a (100 chars)
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
      "expiration_date": "2026-06-17T14:12:26-03:00"
    }
  ],
  "notification_urls": [
    "https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-pagbank-webhook"
  ]
}
```

## Resposta (HTTP 403)
Headers:
```
HTTP/2 403 
date: Wed, 17 Jun 2026 13:12:26 GMT
content-type: application/json
content-length: 106
cf-ray: a0d24e4ffa7dd7b2-GRU
cf-cache-status: DYNAMIC
server: cloudflare
strict-transport-security: max-age=15552000; includeSubDomains
x-content-type-options: nosniff
x-amz-apigw-id: fG2BQHfLmjQEcPg=
x-amzn-remapped-connection: keep-alive
x-amzn-remapped-content-length: 106
x-amzn-remapped-date: Wed, 17 Jun 2026 13:12:26 GMT
x-amzn-requestid: b2c74591-eb1a-4919-8022-3b3fc2b8fce2
vary: accept-encoding

```
Body:
```json
{
  "error_messages": [
    {
      "code": "ACCESS_DENIED",
      "description": "whitelist access required. Contact PagSeguro"
    }
  ]
}
```
