#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================
# Duart Panel — TLS via Let's Encrypt
# Uso: sudo bash scripts/setup-ssl.sh <dominio> [--email a@b.c] [--yes] [--staging]
# ============================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[AVISO]${NC} $1"; }
log_error() { echo -e "${RED}[ERRO]${NC} $1" >&2; }

if [[ $EUID -ne 0 ]]; then
    log_error "Execute como root (sudo)"
    exit 1
fi

DOMAIN=""
EMAIL=""
ASSUME_YES=false
STAGING=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --email) EMAIL="$2"; shift 2 ;;
        --yes|-y) ASSUME_YES=true; shift ;;
        --staging) STAGING=true; shift ;;
        -*) log_error "Argumento desconhecido: $1"; exit 1 ;;
        *) DOMAIN="$1"; shift ;;
    esac
done

if [[ -z "$DOMAIN" ]]; then
    log_error "Uso: sudo bash scripts/setup-ssl.sh <dominio> [--email a@b.c] [--yes]"
    exit 1
fi

EMAIL="${EMAIL:-admin@$DOMAIN}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-/var/lib/duart-panel}"
CONFIG_FILE="$DATA_DIR/settings/config.json"
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
ACME_WEBROOT="/var/www/acme"

log_info "Domínio: $DOMAIN"
log_info "Contato: $EMAIL"

# --- Porta interna do painel ---
PORT="3000"
if [[ -f "$CONFIG_FILE" ]]; then
    PORT="$(node -e "try{const c=require('$CONFIG_FILE');process.stdout.write(String(c.port||3000))}catch(e){process.stdout.write('3000')}" 2>/dev/null || echo 3000)"
fi

# --- certbot ---
if ! command -v certbot &>/dev/null; then
    log_info "Instalando certbot..."
    apt-get update -qq
    apt-get install -y -qq certbot
    log_ok "certbot instalado"
fi

if ! systemctl is-active --quiet nginx; then
    log_error "O NGINX não está rodando. Inicie-o antes de emitir o certificado."
    exit 1
fi

# --- Webroot ACME ---
# Um diretório único para todos os domínios, servido por um snippet incluído em
# todos os vhosts. Antes cada emissão apontava para /var/www/html ou para a raiz
# do site, e o desafio falhava sempre que os dois não coincidiam.
mkdir -p "$ACME_WEBROOT/.well-known/acme-challenge"
chmod -R 755 "$ACME_WEBROOT"
echo "duart-panel-acme-ok" > "$ACME_WEBROOT/.well-known/acme-challenge/.probe"

if [[ ! -f /etc/nginx/snippets/duart-acme.conf ]]; then
    log_info "Instalando o snippet de desafio ACME..."
    mkdir -p /etc/nginx/snippets
    cat > /etc/nginx/snippets/duart-acme.conf <<'ACMEEOF'
location ^~ /.well-known/acme-challenge/ {
    root /var/www/acme;
    default_type "text/plain";
    allow all;
    auth_basic off;
    try_files $uri =404;
}
ACMEEOF
fi

if [[ -f "$NGINX_CONF" ]] && ! grep -q "duart-acme.conf" "$NGINX_CONF"; then
    log_warn "O vhost não inclui o snippet ACME; a validação pode falhar."
    log_warn "Adicione 'include snippets/duart-acme.conf;' ao bloco da porta 80."
fi

nginx -t >/dev/null 2>&1 && systemctl reload nginx

# --- Pré-checagem de alcance ---
# O erro mais comum é o domínio não apontar para esta máquina. Descobrir isso
# aqui é bem mais barato do que gastar uma tentativa do rate limit do Let's Encrypt.
log_info "Verificando se o desafio é alcançável..."
if command -v curl &>/dev/null; then
    PROBE="$(curl -fsS --max-time 10 "http://$DOMAIN/.well-known/acme-challenge/.probe" 2>/dev/null || true)"
    if [[ "$PROBE" != "duart-panel-acme-ok" ]]; then
        log_warn "Não foi possível ler o desafio em http://$DOMAIN/.well-known/acme-challenge/"
        log_warn "Verifique: (1) o DNS aponta para este servidor? (2) a porta 80 está aberta?"
        log_warn "  (3) existe registro AAAA sem o servidor escutar em IPv6?"
        if ! $ASSUME_YES; then
            if [[ -t 0 ]]; then
                read -rp "Continuar mesmo assim? (s/N): " CONTINUE
                [[ "$CONTINUE" =~ ^[SsYy]$ ]] || exit 1
            else
                log_error "Abortando. Use --yes para tentar assim mesmo."
                exit 1
            fi
        fi
    else
        log_ok "Desafio alcançável"
    fi
fi
rm -f "$ACME_WEBROOT/.well-known/acme-challenge/.probe"

# --- Emissão ---
# --cert-name fixo torna o caminho da lineage previsível. Sem ele, uma reemissão
# cria "<dominio>-0001" e o vhost passa a apontar para um diretório inexistente.
CERTBOT_ARGS=(
    certonly --webroot -w "$ACME_WEBROOT"
    --cert-name "$DOMAIN"
    -d "$DOMAIN"
    --non-interactive --agree-tos
    --email "$EMAIL"
    --key-type ecdsa
)
$STAGING && CERTBOT_ARGS+=(--staging)

if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    log_info "Lineage existente encontrada; renovando se necessário..."
    CERTBOT_ARGS+=(--keep-until-expiring)
fi

log_info "Emitindo certificado..."
if ! certbot "${CERTBOT_ARGS[@]}"; then
    log_error "O certbot falhou. Últimas linhas do log:"
    tail -n 20 /var/log/letsencrypt/letsencrypt.log 2>/dev/null || true
    exit 1
fi

# --- Caminhos reais ---
CERT_PATH="$(certbot certificates --cert-name "$DOMAIN" 2>/dev/null | awk '/Certificate Path:/{print $3}' | head -1)"
KEY_PATH="$(certbot certificates --cert-name "$DOMAIN" 2>/dev/null | awk '/Private Key Path:/{print $4}' | head -1)"

if [[ -z "$CERT_PATH" || ! -f "$CERT_PATH" ]]; then
    log_error "Certificado emitido, mas o caminho não pôde ser determinado."
    exit 1
fi

VALID_UNTIL="$(openssl x509 -in "$CERT_PATH" -noout -enddate | cut -d= -f2)"
log_ok "Certificado válido até: $VALID_UNTIL"

# --- vhost com TLS ---
# Fora de sites-available: o painel lista esse diretório e um backup ali vira
# um vhost fantasma na tela.
NGINX_BACKUP_DIR="$DATA_DIR/backups/nginx"
mkdir -p "$NGINX_BACKUP_DIR"
[[ -f "$NGINX_CONF" ]] && cp -a "$NGINX_CONF" "$NGINX_BACKUP_DIR/$(basename "$NGINX_CONF").$(date +%Y%m%d%H%M%S)"

LISTEN6_80=""
LISTEN6_443=""
if [[ -f /proc/net/if_inet6 ]]; then
    LISTEN6_80="    listen [::]:80;"
    LISTEN6_443="    listen [::]:443 ssl;"
fi

cat > "$NGINX_CONF" <<VHOSTEOF
# Duart Panel — $DOMAIN (TLS)
# Gerado por scripts/setup-ssl.sh em $(date -Iseconds)

server {
    listen 80;
$LISTEN6_80
    server_name $DOMAIN;

    include snippets/duart-acme.conf;

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
$LISTEN6_443
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     $CERT_PATH;
    ssl_certificate_key $KEY_PATH;
    include snippets/duart-ssl.conf;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

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

ln -sfn "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"

# --- Validação com rollback ---
# A versão anterior tinha `local LATEST_BAK=...` fora de função aqui: o bash
# aborta com "local: can only be used in a function", e com `set -e` o script
# morria exatamente no caminho de recuperação, deixando o vhost quebrado.
log_info "Validando a configuração do NGINX..."
if NGINX_OUTPUT="$(nginx -t 2>&1)"; then
    systemctl reload nginx
    log_ok "NGINX recarregado com TLS"
else
    log_error "Configuração inválida:"
    echo "$NGINX_OUTPUT" >&2

    LATEST_BAK="$(ls -t "$NGINX_BACKUP_DIR/$(basename "$NGINX_CONF")."* 2>/dev/null | head -1 || true)"
    if [[ -n "$LATEST_BAK" ]]; then
        cp -a "$LATEST_BAK" "$NGINX_CONF"
        if nginx -t >/dev/null 2>&1; then
            systemctl reload nginx
            log_warn "Configuração anterior restaurada de $LATEST_BAK"
        else
            log_error "A configuração continua inválida após o rollback. Rode: duart-recover"
        fi
    fi
    exit 1
fi

# --- Registro no painel ---
# O registro é feito por merge, nunca sobrescrevendo o arquivo inteiro: a versão
# anterior gravava um array com um único certificado, apagando todos os demais.
log_info "Registrando o certificado no painel..."
node "$SCRIPT_DIR/register-cert.js" \
    --domain "$DOMAIN" \
    --cert "$CERT_PATH" \
    --key "$KEY_PATH" \
    --cert-name "$DOMAIN" || log_warn "Certificado emitido, mas o registro no painel falhou."

node -e "
const fs = require('fs');
const file = '$CONFIG_FILE';
try {
  const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
  config.installedModules = config.installedModules || {};
  config.installedModules.certbot = true;
  config.sslAutoRenew = true;
  config.sslContactEmail = config.sslContactEmail || '$EMAIL';
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
} catch {}
" 2>/dev/null || true

# --- Renovação ---
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
if [[ ! -f /etc/letsencrypt/renewal-hooks/deploy/duart-panel.sh ]]; then
    cat > /etc/letsencrypt/renewal-hooks/deploy/duart-panel.sh <<'HOOKEOF'
#!/usr/bin/env bash
set -euo pipefail
LOG="/var/lib/duart-panel/logs/ssl-renewal.log"
mkdir -p "$(dirname "$LOG")"
{
    echo "[$(date -Iseconds)] Renovado: ${RENEWED_LINEAGE:-desconhecido}"
    nginx -t 2>/dev/null && systemctl reload nginx && echo "[$(date -Iseconds)] NGINX recarregado"
} >> "$LOG" 2>&1
HOOKEOF
    chmod +x /etc/letsencrypt/renewal-hooks/deploy/duart-panel.sh
fi

# Um só renovador: o timer do pacote. O cron antigo do painel disputava o lock
# do certbot com ele e falhava de forma intermitente.
rm -f /etc/cron.d/duart-panel-ssl
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

echo ""
echo "========================================"
echo -e "   ${GREEN}TLS configurado${NC}"
echo "========================================"
echo ""
echo -e "  URL:        ${BLUE}https://$DOMAIN${NC}"
echo -e "  Certificado: ${BLUE}$CERT_PATH${NC}"
echo -e "  Válido até:  ${BLUE}$VALID_UNTIL${NC}"
echo -e "  Renovação:   ${BLUE}certbot.timer${NC} (com reload automático do NGINX)"
echo ""
