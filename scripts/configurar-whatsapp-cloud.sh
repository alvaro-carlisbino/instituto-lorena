#!/usr/bin/env bash
# Liga a linha do WhatsApp no Cloud API oficial da Meta.
#
# Confere cada valor ANTES de gravar: token que expira, ID de número que não
# responde ou chave secreta errada só apareceriam depois, com o atendimento no ar.
#
# Uso:
#   ./scripts/configurar-whatsapp-cloud.sh
#
# Ele pergunta o que falta, valida contra a Graph API, grava os segredos no
# Supabase e testa o webhook. Nada é gravado se a validação falhar.

set -uo pipefail

GRAPH="https://graph.facebook.com/v21.0"
WEBHOOK="https://fgyfpmnvlkmyxtucbxbu.supabase.co/functions/v1/crm-whatsapp-webhook"

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$1"; }
titulo()   { printf '\n\033[1m%s\033[0m\n' "$1"; }

cd "$(dirname "$0")/.." || exit 1

titulo "1/5 · Token de acesso"
echo "Business Manager → Configurações do negócio → Usuários → Usuários do sistema"
echo "→ Gerar novo token → app 'CRM - Instituto Lorena' → marcar"
echo "   whatsapp_business_messaging  e  whatsapp_business_management"
echo
read -rsp "Cole o token (não aparece na tela): " TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
[ -z "$TOKEN" ] && { vermelho "Token vazio. Abortado."; exit 1; }

INFO="$(curl -s "$GRAPH/debug_token?input_token=$TOKEN&access_token=$TOKEN")"
TIPO="$(printf '%s' "$INFO" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("data") or {}).get("type",""))' 2>/dev/null)"
VALIDO="$(printf '%s' "$INFO" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("data") or {}).get("is_valid",False))' 2>/dev/null)"
EXPIRA="$(printf '%s' "$INFO" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("data") or {}).get("expires_at",0))' 2>/dev/null)"

if [ "$VALIDO" != "True" ]; then
  vermelho "Token inválido. A Meta respondeu:"
  printf '%s\n' "$INFO" | head -c 400; echo
  exit 1
fi

if [ "$EXPIRA" != "0" ]; then
  QUANDO="$(python3 -c "import datetime;print(datetime.datetime.fromtimestamp($EXPIRA).strftime('%d/%m/%Y às %H:%M'))")"
  amarelo "ATENÇÃO: este token EXPIRA em $QUANDO."
  echo "Token temporário derruba o atendimento sozinho, sem aviso. O certo é o do"
  echo "usuário do sistema, que não expira."
  # `${VAR,,}` é bash 4+; o macOS vem com o 3.2. Minúsculas via tr.
  read -rp "Gravar mesmo assim (só para testar hoje)? [s/N] " OK
  OK="$(printf '%s' "$OK" | tr '[:upper:]' '[:lower:]')"
  [ "$OK" != "s" ] && { echo "Abortado — pegue o token do usuário do sistema."; exit 1; }
else
  verde "OK — token permanente ($TIPO), não expira."
fi

titulo "2/5 · ID do número de telefone"
echo "Painel do app → WhatsApp → Configuração da API → 'ID do número de telefone'"
echo "(é um número longo, não o telefone em si)"
read -rp "Cole o ID: " PHONE_ID
PHONE_ID="$(printf '%s' "$PHONE_ID" | tr -d '[:space:]')"
[ -z "$PHONE_ID" ] && { vermelho "ID vazio. Abortado."; exit 1; }

NUM="$(curl -s "$GRAPH/$PHONE_ID?fields=display_phone_number,verified_name,quality_rating&access_token=$TOKEN")"
FONE="$(printf '%s' "$NUM" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("display_phone_number",""))' 2>/dev/null)"
if [ -z "$FONE" ]; then
  vermelho "A Meta não reconheceu esse ID com esse token:"
  printf '%s\n' "$NUM" | head -c 400; echo
  exit 1
fi
NOME="$(printf '%s' "$NUM" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("verified_name",""))' 2>/dev/null)"
verde "OK — número $FONE ($NOME)"

titulo "3/5 · Chave secreta do app"
echo "Painel do app → Configurações → Básico → 'Chave Secreta do App' → Mostrar"
echo "Sem ela o webhook aceita requisição de qualquer um, e a URL é pública."
read -rsp "Cole a chave (não aparece na tela): " APP_SECRET; echo
APP_SECRET="$(printf '%s' "$APP_SECRET" | tr -d '[:space:]')"
[ -z "$APP_SECRET" ] && { vermelho "Chave vazia. Abortado — não vale rodar sem assinatura."; exit 1; }
verde "OK"

titulo "4/5 · Gravando no Supabase"
npx supabase secrets set \
  WHATSAPP_CLOUD_ACCESS_TOKEN="$TOKEN" \
  WHATSAPP_CLOUD_APP_SECRET="$APP_SECRET" \
  WHATSAPP_CLOUD_PHONE_NUMBER_ID="$PHONE_ID" \
  WHATSAPP_CLOUD_VERIFY_TOKEN="InstitutoLorena@2026" || { vermelho "Falhou ao gravar."; exit 1; }
verde "Segredos gravados."

titulo "5/5 · Testando o webhook"
RESP="$(curl -s -w '\n%{http_code}' "$WEBHOOK?hub.mode=subscribe&hub.verify_token=InstitutoLorena%402026&hub.challenge=ping")"
CODE="$(printf '%s' "$RESP" | tail -1)"
BODY="$(printf '%s' "$RESP" | head -1)"
if [ "$CODE" = "200" ] && [ "$BODY" = "ping" ]; then
  verde "Webhook responde certo (200 + eco)."
else
  vermelho "Webhook respondeu $CODE / '$BODY' — esperado 200 / 'ping'."
fi

titulo "Pronto"
echo "Cole no painel da Meta, em WhatsApp → Configuração → Webhook:"
echo "  URL   : $WEBHOOK"
echo "  Token : InstitutoLorena@2026"
echo "  Campo : messages"
echo
amarelo "A linha AINDA NÃO foi virada para o Cloud API."
echo "O envio continua no W-API/Evolution de propósito — virar o provider é o"
echo "passo da migração do número, fora do horário de atendimento."
