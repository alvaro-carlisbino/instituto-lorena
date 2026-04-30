#!/bin/bash
# ============================================================
# setup-evolution-webhook.sh
# Configura o webhook da Evolution API para a instância "sdr"
# apontar para o crm-whatsapp-webhook do Supabase.
# ============================================================

EVOLUTION_BASE="${EVOLUTION_API_BASE:-}"
EVOLUTION_KEY="${EVOLUTION_API_KEY:-}"
INSTANCE="${EVOLUTION_INSTANCE:-sdr}"
WEBHOOK_URL="https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-whatsapp-webhook"

if [ -z "$EVOLUTION_BASE" ] || [ -z "$EVOLUTION_KEY" ]; then
  echo "❌  Defina as variáveis de ambiente antes de correr este script:"
  echo "    export EVOLUTION_API_BASE=https://sua-evolution.com"
  echo "    export EVOLUTION_API_KEY=sua-api-key"
  exit 1
fi

EVOLUTION_BASE="${EVOLUTION_BASE%/}"  # remove trailing slash

echo "🔧  Configurando webhook na instância: $INSTANCE"
echo "    → $WEBHOOK_URL"
echo ""

RESPONSE=$(curl -s -X POST \
  "${EVOLUTION_BASE}/webhook/set/${INSTANCE}" \
  -H "apikey: ${EVOLUTION_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "'"${WEBHOOK_URL}"'",
      "webhook_by_events": false,
      "webhook_base64": false,
      "events": [
        "MESSAGES_UPSERT",
        "MESSAGES_UPDATE",
        "CONNECTION_UPDATE",
        "SEND_MESSAGE"
      ]
    }
  }')

echo "Resposta da Evolution API:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

# Verificar se foi bem sucedido
if echo "$RESPONSE" | grep -q '"enabled":true\|"webhook":{'; then
  echo ""
  echo "✅  Webhook configurado com sucesso!"
  echo "    Instância:   $INSTANCE"
  echo "    URL destino: $WEBHOOK_URL"
else
  echo ""
  echo "⚠️   Verifique a resposta acima. Se houver erro, confirme:"
  echo "    1. EVOLUTION_API_BASE está correto"
  echo "    2. EVOLUTION_API_KEY está correto"
  echo "    3. A instância '$INSTANCE' existe na Evolution"
fi
