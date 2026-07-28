#!/usr/bin/env bash
set -e

# Duart Panel - Recovery Mode
# Usage: bash scripts/recover.sh

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Duart Panel - Recovery Mode"
echo "============================"

# Detect paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Try to get port from config
PORT=$(node -e "try{const c=require('$PROJECT_DIR/data/settings/config.json');console.log(c.port||0)}catch(e){console.log(0)}" 2>/dev/null || echo "0")

if [[ "$PORT" == "0" ]]; then
    PORT="3000"
fi

if ! systemctl is-active --quiet nginx 2>/dev/null; then
    echo -e "${RED}[!] NGINX está parado. Tentando iniciar com config mínima...${NC}"

    cp -r /etc/nginx/sites-enabled /tmp/nginx-backup-enabled 2>/dev/null || true
    rm -f /etc/nginx/sites-enabled/*

    cat > /etc/nginx/sites-enabled/00-recovery.conf << NGINXEOF
server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINXEOF

    nginx -t && nginx -s reload
    IP=$(hostname -I | awk '{print $1}')
    echo -e "${GREEN}[OK] NGINX iniciado em modo recovery.${NC}"
    echo "    Acesse: http://$IP"
    echo "    Corrija a configuração e restaure os sites."
else
    echo -e "${GREEN}[OK] NGINX está rodando normalmente.${NC}"
fi
