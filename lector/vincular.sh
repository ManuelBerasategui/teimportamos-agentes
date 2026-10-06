#!/usr/bin/env bash
# Vincula el WhatsApp 805 al lector (una sola vez).
# Uso:  bash vincular.sh 5493418051515      -> te da un CÓDIGO de 8 letras
#       bash vincular.sh                    -> te muestra un QR
# En el celular: WhatsApp > Dispositivos vinculados > Vincular un dispositivo
#   (con código: "Vincular con el número de teléfono" y escribís el código)
set -euo pipefail
source .env
NUM="${1:-}"
BODY='{"organization_id":"teimportamos"'"${NUM:+,\"phone_number\":\"$NUM\"}"'}'
R=$(curl -s -X POST http://127.0.0.1:8081/sessions -H "Authorization: Bearer $LECTOR_TOKEN" -H 'Content-Type: application/json' -d "$BODY")
ID=$(echo "$R" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p')
[ -n "$ID" ] || { echo "Error: $R"; exit 1; }
ULT=""
for i in $(seq 1 60); do
  S=$(curl -s http://127.0.0.1:8081/sessions/pending/$ID -H "Authorization: Bearer $LECTOR_TOKEN")
  ST=$(echo "$S" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  COD=$(echo "$S" | sed -n 's/.*"pairing_code":"\([^"]*\)".*/\1/p')
  QR=$(echo "$S" | sed -n 's/.*"qr_code":"\([^"]*\)".*/\1/p')
  if [ "$ST" = "paired" ]; then echo; echo "✅ Vinculado. El lector ya está leyendo el 805."; exit 0; fi
  if [ "$ST" = "error" ]; then echo "Error: $S"; exit 1; fi
  if [ -n "$COD" ] && [ "$COD" != "$ULT" ]; then echo "CÓDIGO PARA EL CELULAR:  $COD"; ULT=$COD; fi
  if [ -n "$QR" ] && [ "$QR" != "$ULT" ]; then clear; qrencode -t ansiutf8 "$QR"; echo "Escaneá el QR (se renueva solo)"; ULT=$QR; fi
  sleep 3
done
echo "Se venció el tiempo. Volvé a correr el script."
