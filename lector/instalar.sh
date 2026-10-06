#!/usr/bin/env bash
# Instala el lector en un servidor Ubuntu (Oracle Cloud Always Free).
# Uso:  LECTOR_TOKEN=xxxx bash instalar.sh
set -euo pipefail
[ -n "${LECTOR_TOKEN:-}" ] || { echo "Falta LECTOR_TOKEN (el mismo que cargaste en Cloudflare)"; exit 1; }
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi
sudo apt-get install -y qrencode curl >/dev/null 2>&1 || true
mkdir -p datos
echo "LECTOR_TOKEN=$LECTOR_TOKEN" > .env && chmod 600 .env
sudo docker compose up -d --build
echo "Listo. Ahora corré:  bash vincular.sh 5493418051515"
