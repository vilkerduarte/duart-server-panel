#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Duart Panel - Setup SSL (Let's Encrypt)
# Usage: sudo bash scripts/setup-ssl.sh <domain> [email]
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

# --- Argumentos ---
DOMAIN="${1:-}"
EMAIL="${2:-admin@$DOMAIN}"

if [[ -z "$DOMAIN" ]]; then
    log_error "Uso: sudo bash scripts/setup-ssl.sh <dominio> [email]"
    exit 1
fi

log_info "Configurando SSL para: $DOMAIN"
log_info "Email: $EMAIL"

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
log_info "Porta da API: $PORT"

# --- Instalar certbot se necessário ---
log_info "Verificando certbot..."

CERTBOT_INSTALLED=false
if command -v certbot &>/dev/null; then
    log_ok "Certbot já instalado"
    CERTBOT_INSTALLED=true
else
    log_info "Instalando certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot python3-certbot-nginx 2>&1 | tail -3
    log_ok "Certbot instalado"
    CERTBOT_INSTALLED=true
fi

# --- Verificar se NGINX está rodando ---
if ! systemctl is-active --quiet nginx; then
    log_error "NGINX não está rodando. Inicie o NGINX primeiro."
    exit 1
fi

# --- Emitir certificado ---
log_info "Emitindo certificado SSL via Let's Encrypt..."

# Verificar se já existe
if [[ -d "$CERTBOT_CERT_DIR" ]]; then
    log_warn "Certificado já existe em $CERTBOT_CERT_DIR"
    read -p "Deseja renovar/reemitir? (s/N): " RENEW
    if [[ "$RENEW" =~ ^[Ss]$ ]]; then
        log_info "Renovando certificado..."
        certbot renew --cert-name "$DOMAIN" --force-renewal 2>&1 || {
            log_error "Falha na renovação. Tentando emitir novo..."
            certbot certonly --webroot -w /var/www/html \
                -d "$DOMAIN" \
                --non-interactive --agree-tos \
                --email "$EMAIL" 2>&1
        }
    fi
else
    # Criar diretório webroot se não existir
    mkdir -p /var/www/html

    certbot certonly --webroot -w /var/www/html \
        -d "$DOMAIN" \
        --non-interactive --agree-tos \
        --email "$EMAIL" 2>&1
fi

if [[ ! -f "$CERTBOT_CERT_DIR/fullchain.pem" ]]; then
    log_error "Falha ao emitir certificado. Verifique:"
    log_error "  1. O domínio $DOMAIN resolve para este servidor?"
    log_error "  2. A porta 80 está acessível publicamente?"
    exit 1
fi

log_ok "Certificado emitido com sucesso!"

# --- Criar symlinks no diretório gerenciado ---
log_info "Registrando certificado..."
mkdir -p "$SSL_CERTS_DIR/$DOMAIN"
ln -sf "$CERTBOT_CERT_DIR/fullchain.pem" "$SSL_CERTS_DIR/$DOMAIN/fullchain.pem" 2>/dev/null || true
ln -sf "$CERTBOT_CERT_DIR/privkey.pem"  "$SSL_CERTS_DIR/$DOMAIN/privkey.pem"  2>/dev/null || true

# --- Atualizar NGINX config com SSL ---
log_info "Atualizando configuração NGINX..."

if [[ ! -f "$NGINX_CONF" ]]; then
    log_error "Configuração NGINX não encontrada: $NGINX_CONF"
    exit 1
fi

# Fazer backup da config atual
cp "$NGINX_CONF" "${NGINX_CONF}.bak-$(date +%Y%m%d%H%M%S)"

SSL_CERT_PATH="$SSL_CERTS_DIR/$DOMAIN/fullchain.pem"
SSL_KEY_PATH="$SSL_CERTS_DIR/$DOMAIN/privkey.pem"

cat > "$NGINX_CONF" << NGINXEOF
# Duart Panel - $DOMAIN (com SSL)
# NGINX como proxy reverso para Next.js na porta $PORT
# Gerado em $(date)

# Redirecionamento HTTP → HTTPS
server {
    listen 80;
    server_name $DOMAIN;

    # Let's Encrypt ACME challenge (renovação)
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS (proxy reverso total para Next.js)
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate     $SSL_CERT_PATH;
    ssl_certificate_key $SSL_KEY_PATH;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    access_log /var/log/nginx/$DOMAIN-access.log;
    error_log  /var/log/nginx/$DOMAIN-error.log;

    # Let's Encrypt ACME challenge (servido localmente)
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
    }

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

# --- Validar e recarregar NGINX ---
log_info "Validando configuração NGINX..."
if nginx -t 2>/dev/null; then
    nginx -s reload
    log_ok "NGINX recarregado com SSL"
else
    log_error "Configuração NGINX inválida! Restaurando backup..."
    local LATEST_BAK=$(ls -t "${NGINX_CONF}.bak-"* 2>/dev/null | head -1)
    if [[ -n "$LATEST_BAK" ]]; then
        cp "$LATEST_BAK" "$NGINX_CONF"
        nginx -s reload
        log_warn "Configuração restaurada do backup"
    fi
    exit 1
fi

# --- Registrar certificado no painel ---
log_info "Registrando no painel..."

CERT_ID=$(node -e "try{const{ v4 }=require('uuid');console.log(v4())}catch(e){console.log(Date.now().toString())}")

mkdir -p "$DATA_DIR/ssl"

cat > "$SSL_CERTS_FILE" << CERTEOF
{
  "certificates": [
    {
      "id": "$CERT_ID",
      "domains": ["$DOMAIN"],
      "type": "letsencrypt",
      "method": "http",
      "issuer": "Let's Encrypt",
      "validFrom": "$(date -Iseconds)",
      "validUntil": "$(date -Iseconds -d '+90 days' 2>/dev/null || date -Iseconds)",
      "certPath": "$SSL_CERT_PATH",
      "keyPath": "$SSL_KEY_PATH",
      "chainPath": null,
      "autoRenew": true,
      "renewDaysBefore": 5,
      "associatedSites": [],
      "createdAt": "$(date -Iseconds)"
    }
  ]
}
CERTEOF

# --- Atualizar config.json ---
if [[ -f "$CONFIG_FILE" ]]; then
    node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf-8'));
        config.sslAutoRenew = true;
        config.sslRenewDaysBefore = 5;
        config.installedModules = config.installedModules || {};
        config.installedModules.certbot = true;
        fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
    " 2>/dev/null || true
fi

log_ok "Certificado registrado (ID: $CERT_ID)"

# --- Configurar cron job de renovação ---
log_info "Configurando renovação automática..."
CERTBOT_RENEW_CRON="/etc/cron.d/duart-panel-ssl"
cat > "$CERTBOT_RENEW_CRON" << CRONEOF
# Duart Panel - SSL Auto Renewal (diário às 03:00)
0 3 * * * root certbot renew --quiet --post-hook "nginx -s reload" >> /var/lib/duart-panel/logs/ssl-renewal.log 2>&1
CRONEOF
chmod 644 "$CERTBOT_RENEW_CRON"
log_ok "Cron job de renovação configurado"

echo ""
echo "========================================"
echo -e "   ${GREEN}SSL Configurado com Sucesso!${NC}"
echo "========================================"
echo ""
echo -e "  Domínio:    ${BLUE}$DOMAIN${NC}"
echo -e "  URL:        ${BLUE}https://$DOMAIN${NC}"
echo -e "  Certificado: ${BLUE}$CERTBOT_CERT_DIR${NC}"
echo -e "  Expira em:  90 dias"
echo -e "  Renovação:  automática (diária às 03:00)"
echo ""
