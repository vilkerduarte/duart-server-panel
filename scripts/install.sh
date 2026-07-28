#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Duart Panel - Installation Script
# Alvo: Ubuntu 25.10 / Debian-based
# Arquitetura: Next.js full server (NGINX proxy reverso total)
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

echo ""
echo "========================================"
echo "   Duart Panel - Instalacao"
echo "========================================"
echo ""

read -p "Digite o dominio para o painel (ex: painel.meudominio.com): " DOMAIN

if [[ -z "$DOMAIN" ]]; then
    log_error "Domínio é obrigatório"
    exit 1
fi

log_info "Domínio: $DOMAIN"

# --- Node.js 22 via NVM ---
log_info "Verificando Node.js..."
export NVM_DIR="$HOME/.nvm"
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    log_info "Instalando NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    source "$NVM_DIR/nvm.sh"
else
    source "$NVM_DIR/nvm.sh"
fi

if ! nvm ls 22 &>/dev/null; then
    log_info "Instalando Node.js 22 via NVM..."
    nvm install 22
    nvm use 22
    nvm alias default 22
fi
log_ok "Node.js $(node -v)"

# --- NGINX ---
log_info "Verificando NGINX..."
if ! command -v nginx &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq nginx
    systemctl enable nginx
    systemctl start nginx
fi
log_ok "NGINX instalado"

# --- UFW ---
log_info "Configurando UFW..."
if ! command -v ufw &>/dev/null; then
    apt-get install -y -qq ufw
fi
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 587/tcp comment 'SMTP'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
log_ok "UFW configurado"

# --- Porta aleatória ---
log_info "Elegendo porta para o Next.js..."
while true; do
    PORT=$((10000 + RANDOM % 50000))
    if ! ss -tuln | grep -q ":${PORT} "; then
        break
    fi
done
log_ok "Porta: $PORT"

# --- Diretórios ---
log_info "Criando estrutura de diretórios..."
DATA_HOME="/var/lib/duart-panel"
mkdir -p "$DATA_HOME"/{auth,cpu-history,network-history,nginx,ssl,cron,backups,settings,firewall,logs}
mkdir -p /etc/ssl/duart-panel/certs
ln -sf "$DATA_HOME" "$(pwd)/data" 2>/dev/null || true
log_ok "Diretórios criados em $DATA_HOME"

# --- Build ---
log_info "Instalando dependências npm..."
npm install --production
log_info "Build da aplicação (Next.js)..."
npm run build 2>&1 | tail -5
log_ok "Build concluído"

# --- NGINX vhost (proxy reverso total para Next.js) ---
log_info "Configurando NGINX (proxy reverso para Next.js)..."
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

cat > "$NGINX_CONF" << NGINXEOF
# Duart Panel - $DOMAIN
# NGINX como proxy reverso para o servidor Next.js na porta $PORT

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

ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

if nginx -t 2>/dev/null; then
    nginx -s reload
    log_ok "NGINX configurado (proxy total para porta $PORT)"
else
    log_error "Configuração NGINX inválida"
    nginx -t
    exit 1
fi

# --- PM2 (servidor Next.js completo: páginas + API) ---
log_info "Iniciando servidor Next.js (páginas + API)..."
if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
fi

cat > ecosystem.config.js << PM2EOF
module.exports = {
  apps: [{
    name: 'duart-panel',
    script: 'node_modules/.bin/next',
    args: 'start -p $PORT',
    cwd: '$(pwd)',
    env: { NODE_ENV: 'production', PORT: '$PORT' },
    max_memory_restart: '512M',
  }]
};
PM2EOF

pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true
log_ok "Next.js iniciado via PM2 na porta $PORT (páginas + API)"

# --- Config ---
mkdir -p data/settings
cat > data/settings/config.json << CONFEOF
{
  "serverName": "Duart Panel",
  "hostname": "$(hostname)",
  "language": "pt-BR",
  "aiApiKey": "",
  "aiModel": "deepseek-chat",
  "theme": "dark",
  "port": $PORT,
  "domain": "$DOMAIN",
  "nginxStubStatus": true,
  "sslAutoRenew": true,
  "sslRenewDaysBefore": 5,
  "backupRetentionCount": 10,
  "installedAt": "$(date -Iseconds)",
  "installedModules": { "mysql": false, "postgresql": false, "mongodb": false, "docker": false, "fail2ban": false, "certbot": false }
}
CONFEOF

# --- SSL Setup (Let's Encrypt) ---
log_info "Configurando SSL automaticamente..."
if bash scripts/setup-ssl.sh "$DOMAIN" "admin@$DOMAIN" 2>&1; then
    log_ok "SSL configurado com sucesso!"
    SSL_ENABLED=true
else
    log_warn "Falha ao configurar SSL. O painel funcionará em HTTP."
    log_warn "Execute 'sudo bash scripts/setup-ssl.sh $DOMAIN' manualmente depois."
    SSL_ENABLED=false
fi

echo ""
echo "========================================"
echo -e "   ${GREEN}Instalacao Concluida!${NC}"
echo "========================================"
echo ""
if [[ "${SSL_ENABLED:-false}" == "true" ]]; then
    echo -e "  URL:        ${BLUE}https://$DOMAIN${NC}"
else
    echo -e "  URL:        ${BLUE}http://$DOMAIN${NC}"
fi
echo -e "  Next.js:    porta ${BLUE}$PORT${NC} (NGINX → proxy reverso total)"
echo ""
if [[ "${SSL_ENABLED:-false}" == "true" ]]; then
    echo -e "  ${GREEN}SSL ativo! Renovacao automatica configurada.${NC}"
else
    echo -e "  ${YELLOW}SSL nao configurado. Execute: sudo bash scripts/setup-ssl.sh $DOMAIN${NC}"
fi
echo ""
echo -e "  ${YELLOW}Acesse e crie seu usuario admin${NC}"
echo ""
