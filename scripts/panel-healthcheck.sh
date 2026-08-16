#!/usr/bin/env bash
set -Eeuo pipefail

# ============================================
# Duart Panel — verificação pós-atualização, com reversão automática
#
# Executado por um timer transitório alguns segundos depois de o painel se
# reiniciar sozinho. Se o painel não responder, restaura o snapshot anterior,
# recompila e reinicia.
#
# Existe porque a alternativa é pior: a IA altera o próprio código do painel,
# o build passa mas o runtime quebra, e o painel morre — levando junto a única
# interface que você usaria para consertá-lo.
#
# Uso: panel-healthcheck.sh <snapshot.tar.gz> <porta> <project_dir>
# ============================================

SNAPSHOT="${1:-}"
PORT="${2:-3000}"
PROJECT_DIR="${3:-/opt/duart-panel}"
SERVICE="duart-panel"
LOG="/var/lib/duart-panel/logs/self-update.log"

mkdir -p "$(dirname "$LOG")"
exec >> "$LOG" 2>&1

echo "[$(date -Iseconds)] Verificando o painel na porta $PORT"

healthy() {
    # Qualquer resposta HTTP serve: 200 na home, 401 numa rota protegida — o que
    # importa é o processo estar aceitando conexão.
    curl -fsS -o /dev/null -m 5 "http://127.0.0.1:$PORT/api/auth/check" 2>/dev/null && return 0
    [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "http://127.0.0.1:$PORT/api/auth/check" 2>/dev/null)" =~ ^[0-9]{3}$ ]]
}

# Algumas tentativas: o Next leva alguns segundos para aceitar conexões.
for attempt in 1 2 3 4 5 6; do
    if systemctl is-active --quiet "$SERVICE" && healthy; then
        echo "[$(date -Iseconds)] Painel saudável (tentativa $attempt). Nada a reverter."
        rm -f "$SNAPSHOT.pending"
        exit 0
    fi
    sleep 5
done

echo "[$(date -Iseconds)] PAINEL FORA DO AR — iniciando reversão"

if [[ -z "$SNAPSHOT" || ! -f "$SNAPSHOT" ]]; then
    echo "[$(date -Iseconds)] ERRO: snapshot $SNAPSHOT não encontrado. Reversão impossível."
    echo "[$(date -Iseconds)] Recupere manualmente: cd $PROJECT_DIR && git checkout . && npm ci && npm run build"
    exit 1
fi

cd "$PROJECT_DIR"

echo "[$(date -Iseconds)] Restaurando $SNAPSHOT"
tar xzf "$SNAPSHOT" -C "$PROJECT_DIR"

echo "[$(date -Iseconds)] Recompilando"
if npm run build; then
    systemctl restart "$SERVICE"
    sleep 8
    if healthy; then
        echo "[$(date -Iseconds)] Reversão concluída — painel de volta no ar."
    else
        echo "[$(date -Iseconds)] ERRO: painel continua fora mesmo após a reversão."
        echo "[$(date -Iseconds)] Rode: journalctl -u $SERVICE -n 80"
    fi
else
    echo "[$(date -Iseconds)] ERRO: o build falhou até com o código restaurado."
    echo "[$(date -Iseconds)] Rode: cd $PROJECT_DIR && npm ci && npm run build"
fi
