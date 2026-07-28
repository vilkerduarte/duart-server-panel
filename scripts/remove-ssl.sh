#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Duart Panel - Remove SSL
# Usage: sudo bash scripts/remove-ssl.sh <domain>
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then
   log_error "Este script deve ser executado como root (use sudo)"
   exit 1
fi

DOMAIN="${1:-}"

if [[ -z "$DOMAIN" ]]; then
    log_error "Uso: sudo bash scripts/remove-ssl.sh <dominio>"
    exit 1
fi

log_warn "Este script irá REMOVER o SSL de $DOMAIN"
log_warn "O site voltará a funcionar apenas em HTTP"
echo ""
read -p "Tem certeza? Digite o domínio para confirmar: " CONFIRM

if [[ "$CONFIRM" != "$DOMAIN" ]]; then
    log_info "Operação cancelada."
    exit 0
fi

# --- Detect paths ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${DATA_DIR:-/var/lib/duart-panel}"
CONFIG_FILE="$DATA_DIR/settings/config.json"
SSL_CERTS_FILE="$DATA_DIR/ssl/certificates.json"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
SSL_CERTS_DIR="/etc/ssl/duart-panel/certs"
CERTBOT_CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

# --- Ler porta do config ---
PORT="3000"
if [[ -f "$CONFIG_FILE" ]]; then
    PORT=$(node -e "try{const c=require('$CONFIG_FILE');console.log(c.port||3000)}catch(e){console.log(3000)}")
fi

# --- Verificar se NGINX config existe ---
if [[ ! -f "$NGINX_CONF" ]]; then
    log_error "Config NGINX não encontrada: $NGINX_CONF"
    exit 1
fi

# --- Fazer backup ---
cp "$NGINX_CONF" "${NGINX_CONF}.pre-ssl-removal-$(date +%Y%m%d%H%M%S)"

# --- Restaurar NGINX para HTTP-only ---
log_info "Restaurando NGINX para HTTP..."

cat > "$NGINX_CONF" << NGINXEOF
# Duart Panel - $DOMAIN
# NGINX como proxy reverso para Next.js na porta $PORT
# SSL removido em $(date)

server {
    listen 80;
    server_name $DOMAIN;

    access_log /var/log/nginx/$DOMAIN-access.log;
    error_log  /var/log/nginx/$DOMAIN-error.log;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}
NGINXEOF

# --- Recarregar NGINX ---
if nginx -t 2>/dev/null; then
    nginx -s reload
    log_ok "NGINX atualizado (HTTP apenas)"
else
    log_error "Config NGINX inválida"
    exit 1
fi

# --- Revogar certificado (opcional) ---
if [[ -d "$CERTBOT_CERT_DIR" ]]; then
    log_info "Revogando certificado Let's Encrypt..."
    if certbot revoke --cert-name "$DOMAIN" --non-interactive 2>/dev/null; then
        log_ok "Certificado revogado"
        certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
        log_ok "Certificado removido do certbot"
    else
        log_warn "Não foi possível revogar (pode já ter sido removido)"
    fi
fi

# --- Limpar symlinks ---
if [[ -d "$SSL_CERTS_DIR/$DOMAIN" ]]; then
    rm -rf "$SSL_CERTS_DIR/$DOMAIN"
    log_ok "Symlinks removidos: $SSL_CERTS_DIR/$DOMAIN"
fi

# --- Remover do registro do painel ---
if [[ -f "$SSL_CERTS_FILE" ]]; then
    node -e "
        const fs = require('fs');
        const data = JSON.parse(fs.readFileSync('$SSL_CERTS_FILE', 'utf-8'));
        data.certificates = (data.certificates || []).filter(c => !c.domains.includes('$DOMAIN'));
        fs.writeFileSync('$SSL_CERTS_FILE', JSON.stringify(data, null, 2));
    " 2>/dev/null
    log_ok "Registro removido de certificates.json"
fi

# --- Remover cron de renovação ---
if [[ -f "/etc/cron.d/duart-panel-ssl" ]]; then
    rm -f /etc/cron.d/duart-panel-ssl
    log_ok "Cron de renovação removido"
fi

echo ""
echo "========================================"
echo -e "   ${GREEN}SSL Removido com Sucesso!${NC}"
echo "========================================"
echo ""
echo -e "  Domínio:    ${BLUE}$DOMAIN${NC}"
echo -e "  URL:        ${BLUE}http://$DOMAIN${NC}"
echo -e "  Backup:     ${NGINX_CONF}.pre-ssl-removal-*"
echo ""
