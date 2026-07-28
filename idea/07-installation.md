# Duart Panel — Script de Instalação (`install.sh`)

## 1. Visão Geral

O arquivo [`install.sh`](install.sh) na raiz do projeto é o ponto de entrada para instalar o Duart Panel em um servidor Linux limpo. Ele automatiza todo o processo: verificação de dependências, instalação do Node.js 22 via NVM, configuração do NGINX, firewall, e inicialização do painel.

## 2. Pré-requisitos do Servidor

- Ubuntu 22.04+ / Debian 12+ (alvo principal: Ubuntu 25.10)
- Acesso root ou sudo
- Domínio já apontado para o IP do servidor (DNS configurado)
- Portas 22, 80, 443 liberadas no provedor de nuvem (security group)

## 3. Fluxo de Execução

```
┌─────────────────────────────────┐
│ 1. Verificar se é root/sudo     │
├─────────────────────────────────┤
│ 2. Solicitar domínio            │
├─────────────────────────────────┤
│ 3. Verificar Node.js 22 (NVM)   │
│    └─ Se ausente: instalar NVM  │
│       + Node 22                 │
├─────────────────────────────────┤
│ 4. Verificar NGINX              │
│    └─ Se ausente: apt install   │
├─────────────────────────────────┤
│ 5. Configurar UFW               │
│    └─ Portas: 22, 587, 80, 443  │
├─────────────────────────────────┤
│ 6. Eleger porta aleatória       │
│    └─ Range: 10000-60000        │
│    └─ Verificar se está livre   │
├─────────────────────────────────┤
│ 7. Criar estrutura de diretórios│
├─────────────────────────────────┤
│ 8. Instalar dependências npm    │
│    └─ npm install               │
├─────────────────────────────────┤
│ 9. Build do Next.js             │
│    └─ npm run build             │
├─────────────────────────────────┤
│ 10. Configurar NGINX vhost      │
│     └─ Proxy reverse para porta │
├─────────────────────────────────┤
│ 11. Instalar PM2                │
│     └─ Configurar startup       │
├─────────────────────────────────┤
│ 12. Iniciar aplicação           │
│     └─ pm2 start                │
├─────────────────────────────────┤
│ 13. Exibir resumo               │
│     └─ URL, porta, status       │
└─────────────────────────────────┘
```

## 4. Script Detalhado (Pseudocódigo)

```bash
#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Duart Panel - Installation Script
# Alvo: Ubuntu 25.10 / Debian-based
# ============================================

# --- Cores para output ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# --- Verificar root ---
if [[ $EUID -ne 0 ]]; then
   log_error "Este script deve ser executado como root (use sudo)"
   exit 1
fi

# --- Solicitar domínio ---
echo ""
echo "========================================"
echo "   Duart Panel - Instalação"
echo "========================================"
echo ""
read -p "Digite o domínio para o painel (ex: painel.meudominio.com): " DOMAIN

if [[ -z "$DOMAIN" ]]; then
    log_error "Domínio é obrigatório"
    exit 1
fi

log_info "Domínio: $DOMAIN"

# --- Verificar/Instalar Node.js 22 via NVM ---
install_nodejs() {
    log_info "Verificando Node.js..."
    
    # Verificar se NVM está instalado
    export NVM_DIR="$HOME/.nvm"
    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
        log_info "Instalando NVM..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        source "$NVM_DIR/nvm.sh"
    else
        source "$NVM_DIR/nvm.sh"
    fi
    
    # Verificar Node 22
    if ! nvm ls 22 &>/dev/null; then
        log_info "Instalando Node.js 22 via NVM..."
        nvm install 22
        nvm use 22
        nvm alias default 22
    fi
    
    log_ok "Node.js $(node -v) instalado"
}

# --- Verificar/Instalar NGINX ---
install_nginx() {
    log_info "Verificando NGINX..."
    
    if ! command -v nginx &>/dev/null; then
        log_info "Instalando NGINX..."
        apt-get update -qq
        apt-get install -y -qq nginx
        systemctl enable nginx
        systemctl start nginx
    fi
    
    log_ok "NGINX $(nginx -v 2>&1 | cut -d'/' -f2) instalado"
}

# --- Configurar UFW ---
setup_ufw() {
    log_info "Configurando UFW..."
    
    # Verificar se UFW está instalado
    if ! command -v ufw &>/dev/null; then
        apt-get install -y -qq ufw
    fi
    
    # Configurar regras padrão
    ufw --force default deny incoming
    ufw --force default allow outgoing
    
    # Liberar portas essenciais
    ufw allow 22/tcp comment 'SSH'
    ufw allow 587/tcp comment 'SMTP Submission'
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
    
    # Ativar UFW
    ufw --force enable
    
    log_ok "UFW configurado (portas 22, 587, 80, 443)"
}

# --- Eleger porta aleatória ---
choose_port() {
    log_info "Elegendo porta aleatória..."
    
    while true; do
        PORT=$((10000 + RANDOM % 50000)) # Range: 10000-60000
        
        # Verificar se porta está livre
        if ! ss -tuln | grep -q ":${PORT} "; then
            break
        fi
    done
    
    log_ok "Porta escolhida: $PORT"
}

# --- Criar estrutura de diretórios ---
create_dirs() {
    log_info "Criando estrutura de diretórios..."
    
    # Diretório de dados persistentes (segregado do projeto)
    local DATA_HOME="/var/lib/duart-panel"
    mkdir -p "$DATA_HOME"
    
    mkdir -p "$DATA_HOME/auth"
    mkdir -p "$DATA_HOME/cpu-history"
    mkdir -p "$DATA_HOME/network-history"
    mkdir -p "$DATA_HOME/nginx"
    mkdir -p "$DATA_HOME/ssl"
    mkdir -p "$DATA_HOME/cron"
    mkdir -p "$DATA_HOME/backups"
    mkdir -p "$DATA_HOME/settings"
    mkdir -p "$DATA_HOME/firewall"
    mkdir -p "$DATA_HOME/logs"
    mkdir -p /etc/ssl/duart-panel/certs
    
    # Link simbólico: data/ → /var/lib/duart-panel/
    ln -sf "$DATA_HOME" "$(pwd)/data"
    
    # Permissões restritas
    chmod 750 "$DATA_HOME/auth"
    chmod 750 "$DATA_HOME/settings"
    chmod 640 "$DATA_HOME/logs"/*.log 2>/dev/null || true
    
    log_ok "Diretórios criados em $DATA_HOME (link: data/)"
}

# --- Instalar dependências e build ---
build_app() {
    log_info "Instalando dependências npm..."
    npm install --production
    
    log_info "Build da aplicação (SSG + export)..."
    npm run build    # next build && next export → gera /out/
    
    log_ok "Build concluído (arquivos estáticos em /out/)"
}

# --- Configurar NGINX vhost ---
setup_nginx_vhost() {
    log_info "Configurando NGINX para $DOMAIN..."
    
    local NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
    local OUT_DIR="$(pwd)/out"
    
    cat > "$NGINX_CONF" << EOF
# Duart Panel - $DOMAIN
# Gerado automaticamente em $(date)
#
# Estratégia:
#   /     → arquivos estáticos (HTML/JS/CSS) da pasta /out/
#   /api/ → proxy reverso para o servidor Node.js na porta $PORT

server {
    listen 80;
    server_name $DOMAIN;

    root $OUT_DIR;
    index index.html;

    # Logs
    access_log /var/log/nginx/$DOMAIN-access.log;
    error_log  /var/log/nginx/$DOMAIN-error.log;

    # Arquivos estáticos (frontend SSG)
    location / {
        try_files \$uri \$uri/ /index.html;
        
        # Cache headers para assets com hash
        location ~* \.(?:css|js|svg|ico|png|jpg|webp|woff2?)\$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # API Routes → Node.js (única porção dinâmica)
    location /api/ {
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
EOF

    # Ativar site
    ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
    
    # Remover default se existir
    rm -f /etc/nginx/sites-enabled/default
    
    # Validar configuração
    if nginx -t 2>/dev/null; then
        nginx -s reload
        log_ok "NGINX configurado: estáticos /out/ + API proxy :$PORT"
    else
        log_error "Configuração NGINX inválida!"
        nginx -t
        exit 1
    fi
}

# --- Instalar PM2 e iniciar (apenas API server) ---
start_app() {
    log_info "Instalando PM2..."
    
    if ! command -v pm2 &>/dev/null; then
        npm install -g pm2
    fi
    
    log_info "Iniciando servidor API na porta $PORT..."
    log_info "  (Frontend estático é servido diretamente pelo NGINX via /out/)"
    
    # Criar arquivo de configuração PM2
    # NOTA: next start inicia apenas o servidor API;
    # os arquivos estáticos já estão em /out/ e são servidos pelo NGINX
    cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'duart-panel-api',
    script: 'node_modules/.bin/next',
    args: 'start -p $PORT',
    cwd: '$(pwd)',
    env: {
      NODE_ENV: 'production',
      PORT: '$PORT',
    },
    max_memory_restart: '512M',
    log_file: 'data/logs/pm2.log',
    error_file: 'data/logs/pm2-error.log',
  }]
};
EOF

    pm2 start ecosystem.config.js
    pm2 save
    
    # Configurar startup automática
    pm2 startup systemd -u root --hp /root 2>/dev/null || true
    
    log_ok "API iniciada via PM2 na porta $PORT"
}

# --- Configurar NGINX stub_status (métricas) ---
setup_nginx_stub_status() {
    log_info "Configurando NGINX stub_status para métricas..."
    
    cat > /etc/nginx/sites-available/nginx-status.conf << 'EOF'
# NGINX Status (interno, apenas localhost)
server {
    listen 127.0.0.1:8081;
    server_name localhost;
    location /nginx_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}
EOF
    
    ln -sf /etc/nginx/sites-available/nginx-status.conf /etc/nginx/sites-enabled/nginx-status.conf
    
    if nginx -t 2>/dev/null; then
        nginx -s reload
        log_ok "stub_status configurado em 127.0.0.1:8081/nginx_status"
    fi
}

# --- Criar script de recuperação ---
create_recovery_script() {
    log_info "Criando script de recuperação..."
    
    cat > scripts/recover.sh << 'RECOVERY_EOF'
#!/usr/bin/env bash
# Duart Panel - Recovery Mode
set -e

PORT=${PORT:-0}

echo "Duart Panel - Recovery Mode"
echo "============================"

if ! systemctl is-active --quiet nginx 2>/dev/null; then
    echo "[!] NGINX está parado. Iniciando com config mínima..."
    cp -r /etc/nginx/sites-enabled /tmp/nginx-backup-enabled 2>/dev/null || true
    rm -f /etc/nginx/sites-enabled/*
    
    cat > /etc/nginx/sites-enabled/00-recovery.conf << NGINX_EOF
server {
    listen 80;
    server_name _;
    root OUT_DIR_PLACEHOLDER;
    index index.html;
    location / { try_files \$uri /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:API_PORT_PLACEHOLDER; }
}
NGINX_EOF

    nginx -t && nginx -s reload
    echo "[OK] NGINX iniciado em modo recovery."
else
    echo "[OK] NGINX está rodando."
fi
RECOVERY_EOF

    sed -i "s|OUT_DIR_PLACEHOLDER|$(pwd)/out|g" scripts/recover.sh
    sed -i "s|API_PORT_PLACEHOLDER|$PORT|g" scripts/recover.sh
    chmod +x scripts/recover.sh
    
    log_ok "Script de recuperação: scripts/recover.sh"
    log_info "  Execute 'npm run recover' ou 'bash scripts/recover.sh' em caso de emergência"
}

# --- Configurar cron jobs ---
setup_cron_jobs() {
    log_info "Configurando cron jobs do painel..."
    
    # Registrar cron jobs no sistema (via crontab do root)
    local CRON_FILE="/tmp/duart-panel-cron"
    
    cat > "$CRON_FILE" << CRON_EOF
# Duart Panel - Cron Jobs Gerenciados
# SSL Renewal (diário às 03:00)
0 3 * * * /usr/bin/node $(pwd)/scripts/renew-ssl.js >> /var/lib/duart-panel/logs/ssl-renewal.log 2>&1
# CPU History Cleanup (30 dias)
0 0 * * * find /var/lib/duart-panel/cpu-history/ -mtime +30 -delete 2>/dev/null
# Log Rotation (semanal, domingo)
0 0 * * 0 /usr/bin/node $(pwd)/scripts/rotate-logs.js >> /var/lib/duart-panel/logs/rotation.log 2>&1
CRON_EOF

    crontab "$CRON_FILE" 2>/dev/null || true
    rm -f "$CRON_FILE"
    
    log_ok "Cron jobs configurados"
}

# --- Salvar configuração ---
save_config() {
    cat > data/settings/config.json << EOF
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
  "installedModules": {
    "mysql": false,
    "postgresql": false,
    "mongodb": false,
    "docker": false,
    "fail2ban": false,
    "certbot": false
  }
}
EOF
    log_ok "Configuração salva"
}

# --- Resumo final ---
show_summary() {
    echo ""
    echo "========================================"
    echo -e "   ${GREEN}Instalação Concluída!${NC}"
    echo "========================================"
    echo ""
    echo -e "  URL:        ${BLUE}http://$DOMAIN${NC}"
    echo -e "  Porta:      ${BLUE}$PORT${NC} (interna)"
    echo -e "  Status:     Execute ${YELLOW}pm2 status${NC}"
    echo -e "  Logs:       Execute ${YELLOW}pm2 logs duart-panel${NC}"
    echo -e "  Config:     ${YELLOW}data/settings/config.json${NC}"
    echo ""
    echo -e "  ${YELLOW}Acesse http://$DOMAIN e crie seu usuário admin${NC}"
    echo ""
}

# ============================================
# Execução Principal
# ============================================

main() {
    install_nodejs
    install_nginx
    setup_ufw
    choose_port
    create_dirs
    build_app
    setup_nginx_vhost
    setup_nginx_stub_status
    start_app
    save_config
    setup_cron_jobs
    create_recovery_script
    show_summary
}

main "$@"
```

## 5. Pós-Instalação

Após executar `sudo bash install.sh`, o administrador deve:

1. Acessar `http://DOMINIO` no navegador
2. Criar o usuário admin (primeiro acesso)
3. Configurar chave da API da IA em Configurações
4. Opcionalmente habilitar SSL (Let's Encrypt) para o próprio painel
5. Opcionalmente instalar Docker, bancos de dados, fail2ban via interface

## 6. Verificações de Compatibilidade

### 6.1 Distros Suportadas

| Distro | Versão | Status |
|--------|--------|--------|
| Ubuntu | 25.10 | ✅ Alvo principal |
| Ubuntu | 24.04 LTS | ✅ Compatível |
| Ubuntu | 22.04 LTS | ✅ Compatível |
| Debian | 12 (Bookworm) | ✅ Compatível |
| Debian | 11 (Bullseye) | ⚠️ Testar |

### 6.2 Possíveis Ajustes por Distro

- **Repositórios MongoDB**: Podem diferir entre Ubuntu/Debian
- **PHP-FPM**: Versão padrão varia; script deve detectar `php*-fpm`
- **systemd vs init.d**: Assumimos systemd (presente em todas as versões alvo)

## 7. Troubleshooting

| Problema | Solução |
|----------|---------|
| Porta já em uso | Script elege automaticamente outra |
| NGINX não sobe | Verificar se porta 80 está livre (`ss -tuln \| grep :80`) |
| Node.js não encontrado | Verificar NVM no PATH do usuário que executa PM2 |
| PM2 não inicia no boot | Executar `pm2 startup` manualmente |
| Acesso negado (403) | Verificar permissões da pasta `data/` |
