#!/usr/bin/env bash
# One-time local TLS for phone mic access (PTT needs a secure context).
# Installs the mkcert local CA and mints a cert covering localhost, the
# current LAN IP, and hermys.local. The same setup carries to the Spark.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v mkcert >/dev/null || { echo "installing mkcert…"; brew install mkcert; }
mkcert -install

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
mkdir -p certs
mkcert -key-file certs/key.pem -cert-file certs/cert.pem \
  localhost 127.0.0.1 ::1 hermys.local ${LAN_IP:+$LAN_IP}

echo
echo "certs/ ready. On each phone: install the mkcert root CA once"
echo "  (mkcert -CAROOT shows its location — AirDrop rootCA.pem to the phone,"
echo "   then trust it in Settings ▸ General ▸ About ▸ Certificate Trust)."
echo "Then browse to https://${LAN_IP:-<this-mac>}:8443"
