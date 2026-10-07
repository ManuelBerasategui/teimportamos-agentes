#!/data/data/com.termux/files/usr/bin/bash
# Instalador del LECTOR 805 en un celular Android con Termux.
# Uso (dentro de Termux):
#   curl -sL https://raw.githubusercontent.com/ManuelBerasategui/teimportamos-agentes/main/lector/termux.sh | bash
# Hace todo: instala lo necesario, compila el puente SIN funciones de envío, lo deja corriendo
# siempre (con arranque automático) y te da el código para vincular el 805.
set -e
COMMIT=6ae9722ddb21af68b7e8a8471f44d4e6488d3b43
DIR="$HOME/lector"
URL_PANEL="https://cotizador.berasateguimanuel07.workers.dev/lector"

echo "== 1/5 Instalando herramientas (tarda unos minutos)"
# Actualiza TODO el sistema primero (si se actualiza a medias, git/curl dejan de funcionar)
pkg update -y -o Dpkg::Options::="--force-confnew" || true
pkg upgrade -y -o Dpkg::Options::="--force-confnew"
pkg install -y -o Dpkg::Options::="--force-confnew" git golang curl openssl termux-api
mkdir -p "$DIR/datos"

echo "== 2/5 Clave del lector"
if [ ! -f "$DIR/.env" ]; then
  printf "Pegá la clave LECTOR_TOKEN (la misma que cargaste en Cloudflare) y Enter: "
  read -r TOKEN < /dev/tty
  [ ${#TOKEN} -ge 20 ] || { echo "La clave es muy corta. Volvé a correr el instalador."; exit 1; }
  printf 'LECTOR_TOKEN=%s\n' "$TOKEN" > "$DIR/.env"; chmod 600 "$DIR/.env"
fi
. "$DIR/.env"

echo "== 3/5 Compilando el puente en modo SOLO LECTURA"
rm -rf "$DIR/src" && git clone -q https://github.com/matiasbattocchia/open-bsp-whatsmeow "$DIR/src"
cd "$DIR/src" && git checkout -q $COMMIT
# Se BORRAN las rutas que mandan mensajes o tocan grupos: el puente no puede enviar nada
sed -i -E '/"POST \/dispatch"|"POST \/groups\/|"PATCH \/groups\/|"DELETE \/groups\//d' server.go
if grep -qE '"POST /dispatch"|"POST /groups/|"PATCH /groups/|"DELETE /groups/' server.go; then echo "ERROR: no se pudieron quitar las rutas de envío"; exit 1; fi
GOTOOLCHAIN=auto CGO_ENABLED=0 go build -o "$DIR/puente" .
cd "$DIR"

echo "== 4/5 Dejándolo corriendo siempre"
cat > "$DIR/correr.sh" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
# Mantiene el puente vivo: si se cae, lo vuelve a levantar
termux-wake-lock 2>/dev/null || true
. "$DIR/.env"
export DATABASE_URL="file:$DIR/datos/whatsmeow.db" OPENBSP_URL="$URL_PANEL" BRIDGE_TOKEN="\$LECTOR_TOKEN" LISTEN_ADDR="127.0.0.1:8081" LINK_EVENTS=true
while true; do
  "$DIR/puente" >> "$DIR/puente.log" 2>&1
  echo "\$(date) el puente se cerró, reiniciando en 10 s" >> "$DIR/puente.log"
  sleep 10
done
EOF
chmod +x "$DIR/correr.sh"
mkdir -p "$HOME/.termux/boot" && printf '#!/data/data/com.termux/files/usr/bin/bash\nnohup %s >/dev/null 2>&1 &\n' "$DIR/correr.sh" > "$HOME/.termux/boot/lector.sh" && chmod +x "$HOME/.termux/boot/lector.sh"
pkill -f "$DIR/puente" 2>/dev/null || true; pkill -f "$DIR/correr.sh" 2>/dev/null || true
nohup "$DIR/correr.sh" >/dev/null 2>&1 &
OKP=""
for i in $(seq 1 20); do
  C=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8081/sessions/5493418051515 -H "Authorization: Bearer $LECTOR_TOKEN" || true)
  if [ -n "$C" ] && [ "$C" != "000" ]; then OKP=1; break; fi
  sleep 1
done
[ -n "$OKP" ] && echo "Puente funcionando ✅" || { echo "El puente no responde. Mirá $DIR/puente.log"; tail -20 "$DIR/puente.log"; exit 1; }

echo "== 5/5 Vincular el 805"
if [ -s "$DIR/datos/whatsmeow.db" ] && curl -s http://127.0.0.1:8081/sessions/5493418051515 -H "Authorization: Bearer $LECTOR_TOKEN" | grep -q '"logged_in":true'; then
  echo "El 805 ya estaba vinculado. Listo ✅"; exit 0
fi
termux-wake-lock 2>/dev/null || true
if [ "${QR:-}" = "1" ]; then BODY='{"organization_id":"teimportamos"}'; echo "Modo QR: abrí el panel en la COMPU > WhatsApp > Conexión y escaneá el QR con el celular del 805."; else BODY='{"organization_id":"teimportamos","phone_number":"5493418051515"}'; fi
R=$(curl -s -X POST http://127.0.0.1:8081/sessions -H "Authorization: Bearer $LECTOR_TOKEN" -H 'Content-Type: application/json' -d "$BODY")
ID=$(echo "$R" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p')
[ -n "$ID" ] || { echo "Error al pedir el código: $R"; exit 1; }
ULT=""
for i in $(seq 1 100); do
  S=$(curl -s "http://127.0.0.1:8081/sessions/pending/$ID" -H "Authorization: Bearer $LECTOR_TOKEN")
  ST=$(echo "$S" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  COD=$(echo "$S" | sed -n 's/.*"pairing_code":"\([^"]*\)".*/\1/p')
  QRC=$(echo "$S" | sed -n 's/.*"qr_code":"\([^"]*\)".*/\1/p')
  if [ -n "$QRC" ] && [ "$QRC" != "$ULT" ]; then
    curl -s -X POST "$URL_PANEL/qr" -H "Authorization: Bearer $LECTOR_TOKEN" -H 'Content-Type: application/json' -d "{\"qr\":\"$QRC\"}" >/dev/null && echo "QR nuevo enviado al panel ($(date +%H:%M:%S))"
    ULT=$QRC
  fi
  [ "$ST" = "paired" ] && curl -s -X POST "$URL_PANEL/qr" -H "Authorization: Bearer $LECTOR_TOKEN" -H 'Content-Type: application/json' -d '{"qr":"","estado":"paired"}' >/dev/null
  [ "$ST" = "paired" ] && { echo; echo "✅ VINCULADO. El lector ya está leyendo el 805. Podés cerrar Termux (queda corriendo)."; exit 0; }
  [ "$ST" = "error" ] && { echo "Error: $S"; exit 1; }
  if [ -n "$COD" ] && [ "$COD" != "$ULT" ]; then
    echo; echo "   CÓDIGO:  $COD"; echo
    echo "En WhatsApp Business: ⋮ > Dispositivos vinculados > Vincular un dispositivo > 'Vincular con el número de teléfono' > escribí el código."
    termux-clipboard-set "$COD" 2>/dev/null && echo "(ya quedó copiado, podés pegarlo)"
    ULT=$COD
  fi
  sleep 3
done
echo "Se venció el tiempo. Volvé a pegar el comando de instalación (no reinstala nada, solo pide un código nuevo)."
