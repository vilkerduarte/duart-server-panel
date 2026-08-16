#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================
# Duart Panel — instalação / reparo
# Alvo: Ubuntu 24.04+ / 25.10 · Debian 12+
#
# Idempotente: pode ser reexecutado com segurança.
# ============================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERRO]${NC} $1" >&2; }
log_skip()  { echo -e "${CYAN}[PULA]${NC} $1"; }

trap 'log_error "Falha na linha $LINENO. Instalação interrompida."' ERR

if [[ $EUID -ne 0 ]]; then
   log_error "Execute como root (sudo bash scripts/install.sh)"
   exit 1
fi

# ============================================
# Argumentos
# ============================================

DOMAIN_ARG=""
EMAIL_ARG=""
SKIP_SSL=false
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --domain) DOMAIN_ARG="$2"; shift 2 ;;
        --email)  EMAIL_ARG="$2"; shift 2 ;;
        --skip-ssl) SKIP_SSL=true; shift ;;
        --yes|-y) ASSUME_YES=true; shift ;;
        *) log_error "Argumento desconhecido: $1"; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DATA_HOME="/var/lib/duart-panel"
CONFIG_FILE="$DATA_HOME/settings/config.json"
ACME_WEBROOT="/var/www/acme"
SERVICE_NAME="duart-panel"

# ============================================
# 1. Instalação existente
# ============================================

EXISTING_INSTALL=false
EXISTING_PORT=""
EXISTING_DOMAIN=""

read_config_key() {
    node -e "try{const c=require('$CONFIG_FILE');process.stdout.write(String(c['$1']??''))}catch(e){}" 2>/dev/null || true
}

if [[ -f "$CONFIG_FILE" ]]; then
    EXISTING_INSTALL=true
    EXISTING_PORT="$(read_config_key port)"
    EXISTING_DOMAIN="$(read_config_key domain)"
fi

echo ""
echo "========================================"
echo "   Duart Panel"
$EXISTING_INSTALL && echo "   (reparo — instalação existente)"
echo "========================================"
echo ""

# ============================================
# 2. Domínio
# ============================================

if [[ -n "$DOMAIN_ARG" ]]; then
    DOMAIN="$DOMAIN_ARG"
elif $EXISTING_INSTALL && [[ -n "$EXISTING_DOMAIN" ]]; then
    DOMAIN="$EXISTING_DOMAIN"
    log_skip "Domínio: $DOMAIN (reutilizado)"
elif [[ -t 0 ]]; then
    read -rp "Domínio do painel (ex.: painel.exemplo.com): " DOMAIN
else
    log_error "Sem terminal interativo. Informe --domain <dominio>."
    exit 1
fi

[[ -z "$DOMAIN" ]] && { log_error "Domínio é obrigatório"; exit 1; }
EMAIL="${EMAIL_ARG:-admin@$DOMAIN}"
log_info "Domínio: $DOMAIN"

# ============================================
# 3. Node.js
# ============================================
# Instalado pelo apt (NodeSource), não por nvm.
#
# Com nvm, o binário fica em /root/.nvm/versions/... e o PATH do systemd não
# inclui esse caminho — o painel não voltava depois de um reboot, que é o pior
# momento possível para a ferramenta de administração sumir.

log_info "Verificando Node.js..."

NODE_OK=false
if command -v node &>/dev/null; then
    NODE_MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
    if [[ "$NODE_MAJOR" -ge 20 ]]; then
        NODE_OK=true
        log_skip "Node.js $(node -v) já instalado"
    else
        log_warn "Node.js $(node -v) é antigo — o Next.js 16 exige 20.9+"
    fi
fi

if ! $NODE_OK; then
    log_info "Instalando Node.js 22 via NodeSource..."
    apt-get update -qq
    apt-get install -y -qq curl ca-certificates gnupg
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
    log_ok "Node.js $(node -v) instalado"
fi

NODE_BIN="$(command -v node)"

# ============================================
# 4. Dependências do sistema
# ============================================

log_info "Verificando pacotes do sistema..."
MISSING_PKGS=()
for pkg in nginx ufw openssl; do
    command -v "$pkg" &>/dev/null || MISSING_PKGS+=("$pkg")
done

if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    apt-get update -qq
    apt-get install -y -qq "${MISSING_PKGS[@]}"
    log_ok "Instalados: ${MISSING_PKGS[*]}"
else
    log_skip "nginx, ufw e openssl já presentes"
fi

systemctl enable --now nginx >/dev/null 2>&1 || true

# ============================================
# 5. UFW
# ============================================

log_info "Configurando firewall..."
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
for rule in "22/tcp:SSH" "80/tcp:HTTP" "443/tcp:HTTPS" "587/tcp:SMTP"; do
    ufw allow "${rule%%:*}" comment "${rule##*:}" >/dev/null 2>&1 || true
done
ufw --force enable >/dev/null
log_ok "UFW ativo (22, 80, 443, 587)"

# ============================================
# 6. Porta interna
# ============================================

if $EXISTING_INSTALL && [[ -n "$EXISTING_PORT" && "$EXISTING_PORT" != "0" ]]; then
    PORT="$EXISTING_PORT"
    log_skip "Porta: $PORT (reutilizada)"
else
    while true; do
        PORT=$((10000 + RANDOM % 50000))
        ss -tuln | grep -q ":${PORT} " || break
    done
    log_ok "Porta interna: $PORT"
fi

# ============================================
# 7. Diretórios
# ============================================

log_info "Criando estrutura de diretórios..."
mkdir -p "$DATA_HOME"/{auth,cpu-history,network-history,nginx/maintenance,ssl,cron,backups,settings,firewall,logs,ai/journal,ai/sessions,python/env}
mkdir -p /etc/ssl/duart-panel/certs
mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
mkdir -p /var/log/php /var/lib/php/sessions /run/duart

chmod 750 "$DATA_HOME" "$DATA_HOME/auth"
chmod 755 "$ACME_WEBROOT"
log_ok "Diretórios prontos"

if [[ -L "$PROJECT_DIR/data" ]]; then
    log_skip "Link data/ já existe"
else
    [[ -d "$PROJECT_DIR/data" ]] && rm -rf "$PROJECT_DIR/data"
    ln -sfn "$DATA_HOME" "$PROJECT_DIR/data"
    log_ok "Link data/ → $DATA_HOME"
fi

# ============================================
# 8. Dependências e build
# ============================================
# `npm install --production` omitia as devDependencies — e tailwindcss,
# @tailwindcss/postcss e typescript estão todas lá. O PostCSS não resolvia o
# plugin do Tailwind e o build da linha seguinte falhava; como a saída passava
# por `| tail`, o código de saída era descartado e o script seguia adiante.

log_info "Instalando dependências (isso pode levar alguns minutos)..."
if [[ -f package-lock.json ]]; then
    npm ci --no-audit --no-fund
else
    npm install --no-audit --no-fund
fi
log_ok "Dependências instaladas"

log_info "Compilando a aplicação..."
npm run build
log_ok "Build concluído"

# ============================================
# 9. Serviço systemd
# ============================================
# systemd no lugar do PM2 para o próprio painel: sobrevive a reboot sem
# depender de `pm2 resurrect` nem do PATH do nvm, e o log vai para o journal.

log_info "Configurando serviço systemd..."

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNITEOF
# Duart Panel — gerado por scripts/install.sh
[Unit]
Description=Duart Panel
Documentation=https://github.com/duart/duart-panel
After=network.target nginx.service

[Service]
Type=simple
User=root
WorkingDirectory=${PROJECT_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=DATA_DIR=${DATA_HOME}
# Usado pela auto-atualização da IA para localizar a raiz do projeto: em
# produção o código roda a partir de um chunk em .next/server, onde __dirname
# não corresponde à raiz.
Environment=PANEL_ROOT=${PROJECT_DIR}
ExecStart=${NODE_BIN} ${PROJECT_DIR}/node_modules/.bin/next start -p ${PORT}
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=duart-panel

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null

# PM2 do painel deixa de ser necessário; remove para não subir duas instâncias
# disputando a mesma porta.
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "duart-panel"; then
    log_info "Removendo instância antiga do PM2..."
    pm2 delete duart-panel >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
fi

systemctl restart "${SERVICE_NAME}"
sleep 2

if systemctl is-active --quiet "${SERVICE_NAME}"; then
    log_ok "Serviço ativo na porta $PORT"
else
    log_error "O serviço não subiu. Diagnóstico:"
    journalctl -u "${SERVICE_NAME}" -n 30 --no-pager
    exit 1
fi

# ============================================
# 10. Configuração
# ============================================

log_info "Gravando configuração..."
mkdir -p "$DATA_HOME/settings"

node -e "
const fs = require('fs');
const file = '$CONFIG_FILE';
let config = {};
try { config = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch {}

config.port = $PORT;
config.domain = '$DOMAIN';
config.serverName ??= 'Duart Panel';
config.hostname ??= '$(hostname)';
config.language ??= 'pt-BR';
config.aiModel ??= 'deepseek-chat';
config.aiProvider ??= 'deepseek';
config.aiDefaultMode ??= 'assisted';
config.theme ??= 'dark';
config.sslContactEmail ||= '$EMAIL';
config.sslAutoRenew = config.sslAutoRenew !== false;
config.sslRenewDaysBefore ||= 30;
config.backupRetentionCount ||= 10;
config.fileManagerRoots ??= [];
config.installedModules ??= {};
config.installedAt ??= new Date().toISOString();
config.updatedAt = new Date().toISOString();

fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', { mode: 0o640 });
"
log_ok "Configuração salva (dados existentes preservados)"

# ============================================
# 11. Snippets do NGINX
# ============================================

log_info "Instalando snippets compartilhados do NGINX..."

cat > /etc/nginx/snippets/duart-acme.conf <<'ACMEEOF'
# Duart Panel — desafio ACME (Let's Encrypt)
location ^~ /.well-known/acme-challenge/ {
    root /var/www/acme;
    default_type "text/plain";
    allow all;
    auth_basic off;
    try_files $uri =404;
}
ACMEEOF

cat > /etc/nginx/snippets/duart-ssl.conf <<'SSLEOF'
# Duart Panel — parâmetros TLS compartilhados
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers off;
ssl_ecdh_curve X25519:prime256v1:secp384r1;
ssl_session_cache shared:DuartSSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;
resolver 127.0.0.53 1.1.1.1 valid=300s;
resolver_timeout 5s;
SSLEOF

cat > /etc/nginx/snippets/duart-gzip.conf <<'GZIPEOF'
# Duart Panel — compressão
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 256;
gzip_types
    text/plain text/css text/xml text/javascript
    application/json application/javascript application/xml
    application/rss+xml application/atom+xml
    image/svg+xml font/woff font/woff2;
GZIPEOF

cat > /etc/nginx/snippets/duart-proxy.conf <<'PROXYEOF'
# Duart Panel — cabeçalhos de proxy reverso
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;
proxy_redirect off;
PROXYEOF

[[ -f /etc/nginx/conf.d/duart-ratelimit.conf ]] || cat > /etc/nginx/conf.d/duart-ratelimit.conf <<'RLEOF'
# Duart Panel — zonas de rate limit
limit_req_zone $binary_remote_addr zone=duart_default:10m rate=30r/s;
RLEOF

log_ok "Snippets instalados"

# ============================================
# 12. vhost do painel
# ============================================
# Detecta SSL pelo próprio vhost, e não pela existência do diretório do certbot.
# Antes, reexecutar o instalador sobrescrevia o bloco SSL, via que o diretório
# do certificado existia, concluía "SSL já configurado" e imprimia https:// no
# resumo — deixando o painel em HTTP e dizendo o contrário.

NGINX_AVAILABLE_DIR="/etc/nginx/sites-available"
NGINX_CONF="$NGINX_AVAILABLE_DIR/$DOMAIN"
HAS_SSL_BLOCK=false
if [[ -f "$NGINX_CONF" ]] && grep -q "ssl_certificate" "$NGINX_CONF"; then
    HAS_SSL_BLOCK=true
fi

# Backups NUNCA ficam em sites-available: o painel varre esse diretório para
# listar vhosts, e um `dominio.bak-20260816…` aparece como se fosse outro site.
NGINX_BACKUP_DIR="$DATA_HOME/backups/nginx"
mkdir -p "$NGINX_BACKUP_DIR"

if [[ -f "$NGINX_CONF" ]]; then
    cp -a "$NGINX_CONF" "$NGINX_BACKUP_DIR/$(basename "$NGINX_CONF").$(date +%Y%m%d%H%M%S)"
fi

# Limpa backups que versões anteriores deixaram dentro de sites-available.
STRAY_COUNT=0
for stray in "$NGINX_AVAILABLE_DIR"/*.bak-* "$NGINX_AVAILABLE_DIR"/*.bak; do
    [[ -e "$stray" ]] || continue
    mv "$stray" "$NGINX_BACKUP_DIR/$(basename "$stray")"
    STRAY_COUNT=$((STRAY_COUNT + 1))
done
if [[ $STRAY_COUNT -gt 0 ]]; then
    log_ok "$STRAY_COUNT backup(s) movido(s) de sites-available para $NGINX_BACKUP_DIR"
fi

# IPv6 só entra se a máquina tiver a stack ativa; senão o nginx recusa a config.
LISTEN6_80=""
LISTEN6_443=""
if [[ -f /proc/net/if_inet6 ]]; then
    LISTEN6_80="    listen [::]:80;"
    LISTEN6_443="    listen [::]:443 ssl;"
fi

write_http_vhost() {
    cat > "$NGINX_CONF" <<VHOSTEOF
# Duart Panel — $DOMAIN
# Gerado por scripts/install.sh em $(date -Iseconds)

server {
    listen 80;
$LISTEN6_80
    server_name $DOMAIN;

    access_log /var/log/nginx/$DOMAIN.access.log;
    error_log  /var/log/nginx/$DOMAIN.error.log;

    include snippets/duart-acme.conf;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        include snippets/duart-proxy.conf;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
        proxy_buffering off;
    }
}
VHOSTEOF
}

if $HAS_SSL_BLOCK; then
    log_skip "vhost com TLS preservado (apenas a porta interna foi conferida)"
    # Mantém o bloco existente e só corrige a porta do upstream, se mudou.
    sed -i -E "s#proxy_pass http://127\.0\.0\.1:[0-9]+#proxy_pass http://127.0.0.1:$PORT#g" "$NGINX_CONF"
else
    write_http_vhost
    log_ok "vhost HTTP gravado"
fi

ln -sfn "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

if NGINX_TEST_OUTPUT="$(nginx -t 2>&1)"; then
    systemctl reload nginx
    log_ok "NGINX recarregado"
else
    log_error "Configuração NGINX inválida:"
    echo "$NGINX_TEST_OUTPUT" >&2
    LATEST_BAK="$(ls -t "$NGINX_BACKUP_DIR/$(basename "$NGINX_CONF")."* 2>/dev/null | head -1 || true)"
    if [[ -n "$LATEST_BAK" ]]; then
        cp -a "$LATEST_BAK" "$NGINX_CONF"
        nginx -t && systemctl reload nginx
        log_warn "Backup restaurado a partir de $LATEST_BAK"
    fi
    exit 1
fi

# ============================================
# 13. SSL
# ============================================

SSL_ENABLED=false
if $HAS_SSL_BLOCK; then
    SSL_ENABLED=true
    log_skip "TLS já configurado para $DOMAIN"
elif $SKIP_SSL; then
    log_skip "SSL ignorado (--skip-ssl)"
else
    log_info "Configurando TLS..."
    SSL_ARGS=("$DOMAIN" "--email" "$EMAIL" "--yes")
    if bash "$SCRIPT_DIR/setup-ssl.sh" "${SSL_ARGS[@]}"; then
        SSL_ENABLED=true
    else
        log_warn "TLS não pôde ser configurado agora. O painel segue em HTTP."
        log_warn "Depois de conferir o DNS, rode: sudo bash scripts/setup-ssl.sh $DOMAIN"
    fi
fi

# ============================================
# 14. Renovação automática
# ============================================
# Um único renovador: o certbot.timer que já vem com o pacote. O painel apenas
# observa, através de um deploy-hook que só executa quando um certificado é de
# fato substituído.

if command -v certbot &>/dev/null; then
    log_info "Configurando o gancho de renovação..."
    mkdir -p /etc/letsencrypt/renewal-hooks/deploy

    cat > /etc/letsencrypt/renewal-hooks/deploy/duart-panel.sh <<'HOOKEOF'
#!/usr/bin/env bash
# Duart Panel — executado pelo certbot quando um certificado é renovado.
set -euo pipefail

LOG="/var/lib/duart-panel/logs/ssl-renewal.log"
mkdir -p "$(dirname "$LOG")"

{
    echo "[$(date -Iseconds)] Renovado: ${RENEWED_LINEAGE:-desconhecido}"
    echo "[$(date -Iseconds)] Domínios: ${RENEWED_DOMAINS:-desconhecidos}"

    if nginx -t 2>/dev/null; then
        systemctl reload nginx && echo "[$(date -Iseconds)] NGINX recarregado"
    else
        echo "[$(date -Iseconds)] ATENÇÃO: nginx -t falhou; reload não executado"
    fi
} >> "$LOG" 2>&1
HOOKEOF

    chmod +x /etc/letsencrypt/renewal-hooks/deploy/duart-panel.sh

    # Remove os renovadores concorrentes que a versão anterior instalava: com
    # três processos chamando `certbot renew`, eles disputavam o lock e falhavam
    # de forma intermitente.
    rm -f /etc/cron.d/duart-panel-ssl

    systemctl enable --now certbot.timer >/dev/null 2>&1 || true
    log_ok "Renovação a cargo do certbot.timer, com gancho de reload do NGINX"
fi

# ============================================
# 15. Script de recuperação
# ============================================
# Antes, o README anunciava a instalação do recover e o script nunca era
# copiado — ele só existia via `npm run recover`, que exige o repositório
# íntegro e o npm funcionando, justamente o que pode faltar numa recuperação.

install -m 0755 "$SCRIPT_DIR/recover.sh" /usr/local/sbin/duart-recover
log_ok "Recuperação disponível em: duart-recover"

# ============================================
# 16. Resumo
# ============================================

echo ""
echo "========================================"
if $EXISTING_INSTALL; then
    echo -e "   ${GREEN}Reparo concluído${NC}"
else
    echo -e "   ${GREEN}Instalação concluída${NC}"
fi
echo "========================================"
echo ""
if $SSL_ENABLED; then
    echo -e "  URL:       ${BLUE}https://$DOMAIN${NC}"
else
    echo -e "  URL:       ${BLUE}http://$DOMAIN${NC}"
    echo -e "  ${YELLOW}TLS pendente: sudo bash scripts/setup-ssl.sh $DOMAIN${NC}"
fi
echo -e "  Serviço:   ${BLUE}systemctl status $SERVICE_NAME${NC}"
echo -e "  Logs:      ${BLUE}journalctl -u $SERVICE_NAME -f${NC}"
echo -e "  Recuperar: ${BLUE}duart-recover${NC}"
echo ""
echo -e "  ${YELLOW}Acesse a URL e crie o usuário administrador.${NC}"
echo ""
