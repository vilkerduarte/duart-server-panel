#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Duart Panel - Installation Script (Idempotente)
# Alvo: Ubuntu 25.10 / Debian-based
# Segura para re-execução em caso de falha parcial
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_skip()  { echo -e "${CYAN}[SKIP]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then
   log_error "Este script deve ser executado como root (use sudo)"
   exit 1
fi

# ============================================
# 1. DETECTAR INSTALAÇÃO EXISTENTE
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DATA_HOME="/var/lib/duart-panel"
CONFIG_FILE="$DATA_HOME/settings/config.json"
EXISTING_INSTALL=false
EXISTING_PORT=""
EXISTING_DOMAIN=""

if [[ -f "$CONFIG_FILE" ]]; then
    EXISTING_PORT=$(node -e "try{const c=require('$CONFIG_FILE');console.log(c.port||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
    EXISTING_DOMAIN=$(node -e "try{const c=require('$CONFIG_FILE');console.log(c.domain||'')}catch(e){console.log('')}" 2>/dev/null || echo "")
    EXISTING_INSTALL=true
fi

echo ""
echo "========================================"
echo "   Duart Panel - Instalacao"
if $EXISTING_INSTALL; then
    echo "   (REPARO - instalacao existente detectada)"
fi
echo "========================================"
echo ""

if $EXISTING_INSTALL; then
    log_info "Instalação existente detectada:"
    echo "       Domínio: ${EXISTING_DOMAIN:-N/A}"
    echo "       Porta:   ${EXISTING_PORT:-N/A}"
    echo "       Dados:   $DATA_HOME"
    echo ""
    log_info "Modo REPARO: apenas etapas faltantes serão executadas."
    log_info "Porta e domínio existentes serão REUTILIZADOS."
    echo ""
fi

# ============================================
# 2. DOMÍNIO
# ============================================

if $EXISTING_INSTALL && [[ -n "$EXISTING_DOMAIN" ]]; then
    DOMAIN="$EXISTING_DOMAIN"
    log_skip "Domínio: $DOMAIN (reutilizado da instalação existente)"
else
    read -p "Digite o dominio para o painel (ex: painel.meudominio.com): " DOMAIN
    if [[ -z "$DOMAIN" ]]; then
        log_error "Domínio é obrigatório"
        exit 1
    fi
    log_info "Domínio: $DOMAIN"
fi

# ============================================
# 3. NODE.JS 22 VIA NVM
# ============================================

log_info "Verificando Node.js..."
export NVM_DIR="$HOME/.nvm"

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    source "$NVM_DIR/nvm.sh"
fi

NEED_NVM=false
if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    NEED_NVM=true
fi

if $NEED_NVM; then
    log_info "Instalando NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    source "$NVM_DIR/nvm.sh"
fi

if ! nvm ls 22 &>/dev/null; then
    log_info "Instalando Node.js 22 via NVM..."
    nvm install 22
    nvm use 22
    nvm alias default 22
    log_ok "Node.js $(node -v) instalado"
else
    nvm use 22 2>/dev/null || true
    log_skip "Node.js $(node -v) já instalado"
fi

# ============================================
# 4. NGINX
# ============================================

log_info "Verificando NGINX..."
if command -v nginx &>/dev/null; then
    log_skip "NGINX já instalado ($(nginx -v 2>&1 | cut -d'/' -f2))"
else
    log_info "Instalando NGINX..."
    apt-get update -qq
    apt-get install -y -qq nginx
    systemctl enable nginx
    systemctl start nginx
    log_ok "NGINX instalado"
fi

# ============================================
# 5. UFW
# ============================================

log_info "Verificando UFW..."
if ! command -v ufw &>/dev/null; then
    apt-get install -y -qq ufw
fi

# UFW rules são idempotentes (ufw allow não duplica)
ufw --force default deny incoming
ufw --force default allow outgoing
ufw allow 22/tcp comment 'SSH' 2>/dev/null || true
ufw allow 587/tcp comment 'SMTP' 2>/dev/null || true
ufw allow 80/tcp comment 'HTTP' 2>/dev/null || true
ufw allow 443/tcp comment 'HTTPS' 2>/dev/null || true
ufw --force enable
log_ok "UFW configurado"

# ============================================
# 6. PORTA (REUSAR SE EXISTENTE)
# ============================================

if $EXISTING_INSTALL && [[ -n "$EXISTING_PORT" ]]; then
    PORT="$EXISTING_PORT"
    log_skip "Porta: $PORT (reutilizada da instalação existente)"
else
    log_info "Elegendo porta aleatória..."
    while true; do
        PORT=$((10000 + RANDOM % 50000))
        if ! ss -tuln | grep -q ":${PORT} "; then
            break
        fi
    done
    log_ok "Porta: $PORT"
fi

# ============================================
# 7. DIRETÓRIOS
# ============================================

log_info "Verificando estrutura de diretórios..."
mkdir -p "$DATA_HOME"/{auth,cpu-history,network-history,nginx,ssl,cron,backups,settings,firewall,logs}
mkdir -p /etc/ssl/duart-panel/certs

# Link simbólico data/ -> /var/lib/duart-panel/
if [[ -L "$PROJECT_DIR/data" ]]; then
    log_skip "Link simbólico data/ já existe"
else
    if [[ -d "$PROJECT_DIR/data" ]] && [[ ! -L "$PROJECT_DIR/data" ]]; then
        log_warn "data/ é um diretório real, será substituído por link simbólico"
        rm -rf "$PROJECT_DIR/data"
    fi
    ln -sf "$DATA_HOME" "$PROJECT_DIR/data"
    log_ok "Link simbólico data/ → $DATA_HOME"
fi

# ============================================
# 8. DEPENDÊNCIAS NPM
# ============================================

log_info "Instalando dependências npm..."
npm install --production 2>&1 | tail -3
log_ok "Dependências instaladas"

# ============================================
# 9. BUILD
# ============================================

log_info "Build da aplicação (Next.js)..."
npm run build 2>&1 | tail -5
log_ok "Build concluído"

# ============================================
# 10. PM2 (parar anterior, iniciar novo)
# ============================================

log_info "Verificando PM2..."
if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
    log_ok "PM2 instalado"
else
    log_skip "PM2 já instalado"
fi

# Parar processo anterior se existir
if pm2 list 2>/dev/null | grep -q "duart-panel"; then
    log_info "Parando processo duart-panel existente..."
    pm2 stop duart-panel 2>/dev/null || true
    pm2 delete duart-panel 2>/dev/null || true
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

# ============================================
# 11. CONFIGURAÇÃO (merge, não sobrescrever)
# ============================================

log_info "Salvando configuração..."

mkdir -p "$DATA_HOME/settings"

if $EXISTING_INSTALL && [[ -f "$CONFIG_FILE" ]]; then
    # Atualizar apenas campos que podem ter mudado, preservar o resto
    node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf-8'));
        config.port = $PORT;
        config.domain = '$DOMAIN';
        config.serverName = config.serverName || 'Duart Panel';
        config.hostname = config.hostname || '$(hostname)';
        config.language = config.language || 'pt-BR';
        config.aiModel = config.aiModel || 'deepseek-chat';
        config.theme = config.theme || 'dark';
        config.nginxStubStatus = config.nginxStubStatus !== false;
        config.sslAutoRenew = config.sslAutoRenew !== false;
        config.sslRenewDaysBefore = config.sslRenewDaysBefore || 5;
        config.backupRetentionCount = config.backupRetentionCount || 10;
        config.installedModules = config.installedModules || { mysql: false, postgresql: false, mongodb: false, docker: false, fail2ban: false, certbot: false };
        config.updatedAt = '$(date -Iseconds)';
        fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
    " 2>/dev/null
    log_skip "Configuração atualizada (preservando dados existentes)"
else
    cat > "$CONFIG_FILE" << CONFEOF
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
    log_ok "Configuração inicial criada"
fi

# ============================================
# 12. NGINX VHOST
# ============================================

log_info "Configurando NGINX vhost..."
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

cat > "$NGINX_CONF" << NGINXEOF
# Duart Panel - $DOMAIN
# NGINX como proxy reverso para Next.js na porta $PORT
# $(date)

server {
    listen 80;
    server_name $DOMAIN;

    access_log /var/log/nginx/$DOMAIN-access.log;
    error_log  /var/log/nginx/$DOMAIN-error.log;

    # Let's Encrypt ACME challenge (servido localmente, sem proxy)
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

ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

if nginx -t 2>/dev/null; then
    nginx -s reload
    log_ok "NGINX configurado (proxy total para porta $PORT)"
else
    log_error "Configuração NGINX inválida!"
    nginx -t
    exit 1
fi

# ============================================
# 13. SSL (Let's Encrypt) — apenas se não existir
# ============================================

CERTBOT_CERT_DIR="/etc/letsencrypt/live/$DOMAIN"

if [[ -d "$CERTBOT_CERT_DIR" ]] && [[ -f "$CERTBOT_CERT_DIR/fullchain.pem" ]]; then
    log_skip "SSL já configurado para $DOMAIN"
    SSL_ENABLED=true
else
    log_info "Configurando SSL automaticamente..."
    if bash "$SCRIPT_DIR/setup-ssl.sh" "$DOMAIN" "admin@$DOMAIN" 2>&1; then
        log_ok "SSL configurado com sucesso!"
        SSL_ENABLED=true
    else
        log_warn "Falha ao configurar SSL. O painel funcionará em HTTP."
        log_warn "Execute 'sudo bash scripts/setup-ssl.sh $DOMAIN' manualmente depois."
        SSL_ENABLED=false
    fi
fi

# ============================================
# 14. RESUMO
# ============================================

echo ""
echo "========================================"
if $EXISTING_INSTALL; then
    echo -e "   ${GREEN}Reparo Concluido!${NC}"
else
    echo -e "   ${GREEN}Instalacao Concluida!${NC}"
fi
echo "========================================"
echo ""
if [[ "${SSL_ENABLED:-false}" == "true" ]]; then
    echo -e "  URL:        ${BLUE}https://$DOMAIN${NC}"
else
    echo -e "  URL:        ${BLUE}http://$DOMAIN${NC}"
fi
echo -e "  Next.js:    porta ${BLUE}$PORT${NC} (NGINX → proxy reverso total)"
echo -e "  PM2:        ${BLUE}pm2 status${NC}"
echo ""
if [[ "${SSL_ENABLED:-false}" != "true" ]]; then
    echo -e "  ${YELLOW}SSL nao configurado. Execute: sudo bash scripts/setup-ssl.sh $DOMAIN${NC}"
    echo ""
fi
echo -e "  ${YELLOW}Acesse e crie seu usuario admin${NC}"
echo ""
