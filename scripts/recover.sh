#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================
# Duart Panel — modo de recuperação
#
# Para quando o NGINX não sobe, o painel não responde, ou uma configuração
# ruim tirou tudo do ar. Desabilita os vhosts problemáticos, sobe uma
# configuração mínima que serve só o painel, e devolve o acesso.
#
# Instalado como: duart-recover
# Uso: sudo duart-recover [--diagnose | --restore | --list-backups]
# ============================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[AVISO]${NC} $1"; }
log_error() { echo -e "${RED}[ERRO]${NC} $1" >&2; }

if [[ $EUID -ne 0 ]]; then
    log_error "Execute como root (sudo duart-recover)"
    exit 1
fi

DATA_DIR="${DATA_DIR:-/var/lib/duart-panel}"
CONFIG_FILE="$DATA_DIR/settings/config.json"
# O backup vai para um diretório persistente: /tmp some no reboot, que é
# exatamente quando você mais precisa dele.
BACKUP_ROOT="$DATA_DIR/backups/nginx"
SERVICE_NAME="duart-panel"

MODE="recover"
[[ "${1:-}" == "--diagnose" ]] && MODE="diagnose"
[[ "${1:-}" == "--restore" ]] && MODE="restore"
[[ "${1:-}" == "--list-backups" ]] && MODE="list"

read_port() {
    local port
    port="$(node -e "try{const c=require('$CONFIG_FILE');process.stdout.write(String(c.port||0))}catch(e){process.stdout.write('0')}" 2>/dev/null || echo 0)"
    [[ "$port" == "0" || -z "$port" ]] && port="3000"
    echo "$port"
}

echo ""
echo "========================================"
echo "   Duart Panel — recuperação"
echo "========================================"
echo ""

PORT="$(read_port)"

# ============================================
# Diagnóstico
# ============================================

diagnose() {
    log_info "Serviço do painel:"
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        log_ok "  $SERVICE_NAME ativo"
    else
        log_error "  $SERVICE_NAME parado"
        journalctl -u "$SERVICE_NAME" -n 15 --no-pager 2>/dev/null | sed 's/^/      /' || true
    fi

    log_info "Porta interna $PORT:"
    if ss -tlnp 2>/dev/null | grep -q ":$PORT "; then
        log_ok "  em escuta"
    else
        log_error "  ninguém escutando em $PORT"
    fi

    log_info "NGINX:"
    if systemctl is-active --quiet nginx 2>/dev/null; then
        log_ok "  serviço ativo"
    else
        log_error "  serviço parado"
    fi

    if NGINX_OUTPUT="$(nginx -t 2>&1)"; then
        log_ok "  configuração válida"
    else
        log_error "  configuração inválida:"
        echo "$NGINX_OUTPUT" | sed 's/^/      /' >&2
    fi

    log_info "Certificados:"
    if command -v certbot &>/dev/null; then
        certbot certificates 2>/dev/null | grep -E "Certificate Name:|Expiry Date:" | sed 's/^/      /' || echo "      nenhum"
    else
        echo "      certbot não instalado"
    fi
}

if [[ "$MODE" == "diagnose" ]]; then
    diagnose
    exit 0
fi

if [[ "$MODE" == "list" ]]; then
    if [[ -d "$BACKUP_ROOT" ]]; then
        log_info "Backups disponíveis em $BACKUP_ROOT:"
        ls -1t "$BACKUP_ROOT" | sed 's/^/   /'
    else
        log_warn "Nenhum backup encontrado."
    fi
    exit 0
fi

# ============================================
# Restauração
# ============================================

if [[ "$MODE" == "restore" ]]; then
    LATEST="$(ls -1t "$BACKUP_ROOT" 2>/dev/null | head -1 || true)"
    if [[ -z "$LATEST" ]]; then
        log_error "Nenhum backup para restaurar."
        exit 1
    fi

    log_info "Restaurando de $BACKUP_ROOT/$LATEST..."
    rm -f /etc/nginx/sites-enabled/*
    cp -a "$BACKUP_ROOT/$LATEST/sites-enabled/." /etc/nginx/sites-enabled/ 2>/dev/null || true

    if nginx -t; then
        systemctl reload nginx || systemctl restart nginx
        log_ok "Configuração restaurada e NGINX recarregado."
    else
        log_error "A configuração restaurada também é inválida. Rode sem argumentos para o modo mínimo."
        exit 1
    fi
    exit 0
fi

# ============================================
# Recuperação
# ============================================

diagnose
echo ""

NGINX_HEALTHY=true
nginx -t >/dev/null 2>&1 || NGINX_HEALTHY=false
systemctl is-active --quiet nginx 2>/dev/null || NGINX_HEALTHY=false

if $NGINX_HEALTHY; then
    log_ok "O NGINX está saudável — nada a recuperar aqui."
else
    log_warn "Entrando em modo mínimo..."

    STAMP="$(date +%Y%m%d-%H%M%S)"
    BACKUP_DIR="$BACKUP_ROOT/$STAMP"
    mkdir -p "$BACKUP_DIR"
    cp -a /etc/nginx/sites-enabled "$BACKUP_DIR/" 2>/dev/null || true
    log_ok "Vhosts salvos em $BACKUP_DIR"

    rm -f /etc/nginx/sites-enabled/*

    mkdir -p /var/www/acme/.well-known/acme-challenge

    cat > /etc/nginx/sites-enabled/00-duart-recovery.conf <<RECOVEOF
# Duart Panel — configuração mínima de recuperação
# Gerada em $(date -Iseconds). Remova este arquivo ao restaurar os sites.
server {
    listen 80 default_server;
    server_name _;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
        default_type "text/plain";
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}
RECOVEOF

    if nginx -t; then
        systemctl restart nginx
        log_ok "NGINX no ar em modo mínimo"
    else
        log_error "Nem a configuração mínima passa. O problema está em /etc/nginx/nginx.conf ou em conf.d."
        nginx -t
        exit 1
    fi
fi

# Painel de pé
if ! systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    log_warn "Iniciando o serviço do painel..."
    systemctl restart "$SERVICE_NAME" 2>/dev/null || true
    sleep 2
    systemctl is-active --quiet "$SERVICE_NAME" \
        && log_ok "Painel ativo" \
        || log_error "O painel não subiu — veja: journalctl -u $SERVICE_NAME -n 50"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

echo ""
echo "========================================"
echo -e "   ${GREEN}Recuperação concluída${NC}"
echo "========================================"
echo ""
echo -e "  Acesse:          ${BLUE}http://${IP:-SEU_IP}${NC}"
echo -e "  Vhosts salvos:   ${BLUE}$BACKUP_ROOT${NC}"
echo -e "  Restaurar tudo:  ${BLUE}duart-recover --restore${NC}"
echo -e "  Só diagnosticar: ${BLUE}duart-recover --diagnose${NC}"
echo ""
echo -e "  ${YELLOW}Reative os sites um a um pelo painel, conferindo o nginx -t a cada um.${NC}"
echo ""
