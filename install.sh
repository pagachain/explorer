#!/bin/bash
# Instala Pagachain Explorer en nginx (Ubuntu). Ejecutar con sudo o el script lo pedirá.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
WEBROOT="/var/www/html"
SITE_AVAIL="/etc/nginx/sites-available/pagachain-explorer"
SITE_EN="/etc/nginx/sites-enabled/pagachain-explorer"

if [ "$(id -u)" -ne 0 ]; then
  exec sudo bash "$0" "$@"
fi

if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y nginx
fi

mkdir -p "$WEBROOT"
# Conserva la página de bienvenida de nginx, por si hace falta.
if [ -f "$WEBROOT/index.nginx-debian.html" ]; then
  mv -f "$WEBROOT/index.nginx-debian.html" "$WEBROOT/index.nginx-debian.html.bak" || true
fi

# Copia el sitio estático (no borra copias de seguridad .bak)
find "$WEBROOT" -mindepth 1 -maxdepth 1 ! -name '*.bak' -exec rm -rf {} +
cp -a "$ROOT/public/." "$WEBROOT/"
chown -R www-data:www-data "$WEBROOT"
find "$WEBROOT" -type d -exec chmod 755 {} +
find "$WEBROOT" -type f -exec chmod 644 {} +

cp "$ROOT/nginx/pagachain-explorer.conf" "$SITE_AVAIL"
ln -sfn "$SITE_AVAIL" "$SITE_EN"
# Evita que el sitio por defecto de Ubuntu pise este.
if [ -L /etc/nginx/sites-enabled/default ] || [ -f /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

echo
echo "LISTO. Pagachain Explorer está en:"
echo "  http://132.145.51.202"
echo "Rutas: /block/<n>  /tx/<hash>  /address/<addr>  /token/<addr>"
