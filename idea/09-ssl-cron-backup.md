# Duart Panel — Novos Módulos: SSL, Cron, Backup, Logs, Rede, Recuperação

## Módulo 11: Gestão de SSL/TLS

### Propósito
Gerenciar certificados SSL para os sites NGINX, com suporte a Let's Encrypt (Certbot), certificados manuais e certificados Cloudflare Origin.

### 11.1 Tipos de Certificado Suportados

| Tipo | Descrição | Uso |
|------|-----------|-----|
| **Let's Encrypt (via arquivo)** | Verificação HTTP-01 (arquivo `.well-known/acme-challenge`) | Padrão para novos certificados |
| **Let's Encrypt (via DNS)** | Verificação DNS-01 (registro TXT) | Para wildcards ou servidores sem porta 80 pública |
| **Manual** | Upload de certificado + chave privada + (opcional) chain | Certificados comprados ou emitidos externamente |
| **Cloudflare Origin** | Certificado wildcard da Cloudflare já existente no servidor | Selecionar de `/etc/ssl/` ou path customizado |

### 11.2 Interface de Gestão de SSL

#### Tela Principal (`/ssl`)
- Lista de certificados cadastrados:
  - Domínio(s), Tipo, Emissor, Validade (data expiração), Status
  - Badge colorido: verde (>30d), amarelo (7-30d), vermelho (<7d), cinza (expirado)
  - Ações: Renovar, Visualizar detalhes, Revogar, Excluir
- Botão: **"Novo Certificado"**

#### Formulário de Novo Certificado

**Opção A: Let's Encrypt**
```
Domínio(s): meusite.com, www.meusite.com
Método de verificação: ○ Arquivo (HTTP-01)  ● DNS (DNS-01)
Email para notificações: admin@meusite.com

[Emitir Certificado]
```

**Opção B: Manual**
```
Domínio(s): meusite.com, *.meusite.com
Certificado (crt/pem): [COLAR ou UPLOAD]
Chave Privada (key):    [COLAR ou UPLOAD]
Chain/CA Bundle (opc):  [COLAR ou UPLOAD]

[Registrar Certificado]
```

**Opção C: Cloudflare Origin / Existente**
```
Domínio(s): *.meusite.com
Caminho do certificado: /etc/ssl/cloudflare/meusite.pem
Caminho da chave:       /etc/ssl/cloudflare/meusite.key
Chain (opcional):       /etc/ssl/cloudflare/origin_ca_ecc.pem

[Registrar Certificado]
```

### 11.3 Integração com NGINX

Ao criar/editar um site em [`/nginx`](pages/nginx/), um campo adicional fica disponível:

```
SSL:  ☑ Habilitar HTTPS
Certificado: [dropdown: certificados disponíveis para este domínio]
Redirecionar HTTP → HTTPS: ☑
```

O template NGINX com SSL:

```nginx
server {
    listen 80;
    server_name {domain};
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name {domain};

    ssl_certificate     {cert_path};
    ssl_certificate_key {key_path};
    ssl_trusted_certificate {chain_path};  # opcional

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # ... resto da config
}
```

### 11.4 Armazenamento de Certificados

```
/etc/ssl/duart-panel/          # Gerenciado pelo painel
├── certs/
│   ├── meusite.com/
│   │   ├── fullchain.pem
│   │   └── privkey.pem
│   └── *.meusite.com/
│       ├── cert.pem
│       ├── privkey.key
│       └── chain.pem
└── letsencrypt/               # Symlink ou path do Certbot
    └── ... (gerenciado pelo certbot)

data/ssl/
└── certificates.json          # Registro de todos os certificados
```

### 11.5 Estrutura de `certificates.json`

```json
{
  "certificates": [
    {
      "id": "uuid-v4",
      "domains": ["meusite.com", "www.meusite.com"],
      "type": "letsencrypt",
      "method": "http",
      "issuer": "Let's Encrypt / R3",
      "validFrom": "2026-07-01T00:00:00Z",
      "validUntil": "2026-09-29T00:00:00Z",
      "certPath": "/etc/ssl/duart-panel/certs/meusite.com/fullchain.pem",
      "keyPath": "/etc/ssl/duart-panel/certs/meusite.com/privkey.pem",
      "chainPath": null,
      "autoRenew": true,
      "renewDaysBefore": 5,
      "associatedSites": ["uuid-nginx-site-1"],
      "createdAt": "2026-07-01T00:00:00Z"
    },
    {
      "id": "uuid-v4",
      "domains": ["*.meusite.com"],
      "type": "manual",
      "issuer": "Cloudflare Origin CA",
      "validFrom": "2026-01-01T00:00:00Z",
      "validUntil": "2036-01-01T00:00:00Z",
      "certPath": "/etc/ssl/cloudflare/origin.pem",
      "keyPath": "/etc/ssl/cloudflare/origin.key",
      "chainPath": "/etc/ssl/cloudflare/origin_ca_ecc.pem",
      "autoRenew": false,
      "renewDaysBefore": 5,
      "associatedSites": ["uuid-nginx-site-2", "uuid-nginx-site-3"],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
```

### 11.6 Renovação Automática de SSL

- Um **cron job** é configurado automaticamente ao registrar um certificado Let's Encrypt
- Executa diariamente às 03:00 AM
- Verifica certificados com `autoRenew: true`
- Se `validUntil - now < renewDaysBefore` (padrão: 5 dias) → dispara renovação
- Após renovação bem-sucedida: recarrega NGINX (`nginx -s reload`)
- Logs de renovação em `data/logs/ssl-renewal.log`
- Falhas geram alerta visual no dashboard (badge de notificação)

**Cron job gerado:**
```
0 3 * * * /usr/bin/node /opt/duart-panel/scripts/renew-ssl.js >> /opt/duart-panel/data/logs/ssl-renewal.log 2>&1
```

### 11.7 Verificação DNS (DNS-01)

Quando o método DNS é selecionado no Let's Encrypt:

1. Painel gera o registro TXT necessário (`_acme-challenge.meusite.com`)
2. Exibe o registro para o usuário: "Adicione este registro TXT ao seu DNS"
3. Usuário adiciona no provedor DNS (Cloudflare, Route53, etc.)
4. Usuário clica em **"Verificar"**
5. Painel executa `certbot --manual --preferred-challenges dns` com o registro
6. Se sucesso → certificado emitido
7. Se falha → mensagem de erro com detalhes

---

## Módulo 12: Gestão de Tarefas Cron

### Propósito
Gerenciar tarefas agendadas (cron jobs) do sistema via interface visual.

### 12.1 Interface

#### Tela Principal (`/cron`)
- Lista de cron jobs: Minuto, Hora, Dia, Mês, Dia da Semana, Comando, Status, Última Execução
- Jobs do sistema são exibidos em modo somente leitura com badge "Sistema"
- Jobs do painel são exibidos com badge "Duart Panel"
- Jobs customizados são editáveis
- Ações: Editar, Pausar/Ativar, Excluir, Executar Agora

#### Criar/Editar Cron Job
```
Expressão Cron:
  ┌────────── minuto (0-59)
  │ ┌────────── hora (0-23)
  │ │ ┌────────── dia do mês (1-31)
  │ │ │ ┌────────── mês (1-12)
  │ │ │ │ ┌────────── dia da semana (0-6, 0=Domingo)
  │ │ │ │ │
  * * * * *  comando

Ou use o modo visual:
  Frequência: [dropdown: A cada minuto / Hora / Diário / Semanal / Personalizado]
  
  Se "Personalizado", mostra os 5 campos individuais com spinners

Comando: /usr/bin/certbot renew --quiet
Descrição: Renovação automática de SSL
```

### 12.2 Armazenamento

```
data/cron/
├── custom.json       # Cron jobs criados pelo usuário
└── managed.json      # Cron jobs gerenciados pelo painel (read-only)
```

### 12.3 Cron Jobs Gerenciados pelo Painel (automáticos)

| Job | Expressão | Comando | Descrição |
|-----|-----------|---------|-----------|
| SSL Renewal | `0 3 * * *` | `node scripts/renew-ssl.js` | Renova certificados próximos do vencimento |
| CPU History Cleanup | `0 0 * * *` | `find data/cpu-history/ -mtime +30 -delete` | Remove históricos > 30 dias |
| Log Rotation | `0 0 * * 0` | `node scripts/rotate-logs.js` | Rotaciona logs do painel (semanal) |

### 12.4 Segurança

- Comandos passam pela mesma whitelist do sistema (`lib/system.ts`)
- Jobs que executam comandos bloqueados são rejeitados com explicação
- Sintaxe cron validada antes de salvar
- Backup do crontab original antes de qualquer modificação

---

## Módulo 13: Backup e Restore

### Propósito
Realizar backup completo das configurações e dados do painel e permitir restore.

### 13.1 Interface

#### Tela Principal (`/backup`)
- Lista de backups realizados: Data, Tamanho, Tipo, Status
- Botão: **"Criar Backup Agora"**
- Upload de backup para restore
- Agendamento de backup automático

#### Criar Backup
```
Itens incluídos no backup:
  ☑ Configurações do painel (data/settings/)
  ☑ Usuários e autenticação (data/auth/)
  ☑ Configurações NGINX (/etc/nginx/sites-available/ + sites-enabled/)
  ☑ Lista de certificados SSL (data/ssl/certificates.json)
  ☑ Arquivos SSL (/etc/ssl/duart-panel/certs/)
  ☑ Regras de firewall (ufw)
  ☑ Cron jobs customizados (data/cron/custom.json)
  ☑ Histórico de CPU (data/cpu-history/)

Formato: .tar.gz

[Gerar Backup]
```

#### Restore
```
Upload do arquivo de backup (.tar.gz):
[ESCOLHER ARQUIVO] ou [ARRÁSTAR AQUI]

Após upload, exibe preview:
  - 5 arquivos de configuração
  - 3 certificados SSL
  - 42 dias de histórico CPU
  - 2 usuários

☑ Sobrescrever configurações existentes
☐ Manter usuário admin atual

[RESTAURAR BACKUP]
```

### 13.2 Backup Automático

- Configurável via cron (interface visual)
- Opções: Diário, Semanal, Mensal
- Manter últimos N backups (configurável, padrão: 10)
- Pasta de backups: `data/backups/`

### 13.3 API Download

- `GET /api/backup/download?id=X` → download direto do arquivo `.tar.gz`
- `POST /api/backup/restore` → upload e restore (multipart)

---

## Módulo 14: Visualizador de Logs do Sistema

### Propósito
Centralizar e filtrar logs do sistema, NGINX, fail2ban e do próprio painel.

### 14.1 Interface

#### Tela Principal (`/logs`)
- Seletor de fonte de logs (tabs):
  - **Painel** — `data/logs/panel.log`
  - **NGINX Access** — `/var/log/nginx/*.access.log`
  - **NGINX Error** — `/var/log/nginx/*.error.log`
  - **Sistema** — `journalctl` output
  - **UFW** — `/var/log/ufw.log`
  - **fail2ban** — `/var/log/fail2ban.log`
  - **SSL Renewal** — `data/logs/ssl-renewal.log`
- Campo de busca/filtro (com regex opcional)
- Seletor de nível: INFO, WARN, ERROR, DEBUG
- Seletor de período: Últimos 15 min, 1h, 6h, 24h, 7d, Personalizado
- Auto-scroll com toggle
- Botão "Exportar" (baixar como .txt)
- Atualização em tempo real (polling 3s com opção tail)

### 14.2 API

```
GET /api/logs/view?source=nginx-access&lines=200&filter=404&level=error&since=2026-07-28T00:00:00Z
```

---

## Módulo 15: Métricas de Rede

### Propósito
Monitorar throughput, conexões ativas e tráfego de rede.

### 15.1 Interface

#### Seção no Dashboard + página dedicada (`/network`)
- **Throughput em tempo real**: Upload/Download (Mbps) — gráfico de área
- **Conexões ativas**: Total, TCP, UDP, ESTABLISHED, TIME_WAIT, LISTEN
- **Tráfego por interface**: eth0, lo, docker0, etc.
- **Top portas em escuta**: com processo associado
- **NGINX métricas** (se stub_status configurado):
  - Active connections
  - Requests por segundo
  - Status codes (2xx, 3xx, 4xx, 5xx)

### 15.2 Fontes de Dados

| Métrica | Fonte |
|---------|-------|
| Throughput | `/proc/net/dev` (delta entre leituras) |
| Conexões | `ss -s` e `/proc/net/sockstat` |
| Portas | `ss -tlnp` |
| NGINX | `nginx stub_status` (endpoint `/nginx_status`) |

### 15.3 Configuração Automática do NGINX stub_status

O painel adiciona automaticamente ao instalar (ou ao ativar o módulo):

```nginx
server {
    listen 127.0.0.1:8081;
    server_name localhost;
    
    location /nginx_status {
        stub_status;
        allow 127.0.0.1;
        deny all;
    }
}
```

---

## Módulo 16: Modo de Recuperação (Recovery Mode)

### Propósito
Permitir acesso ao painel mesmo se o NGINX estiver com configuração quebrada.

### 16.1 Mecanismo

- O servidor API do Next.js sempre escuta em `127.0.0.1:${PORT}` (bind local)
- Um comando CLI está disponível: `npm run recover`
- Este comando:
  1. Verifica se o NGINX está rodando
  2. Se não estiver, tenta iniciar com config mínima (só o proxy do painel)
  3. Se não conseguir, inicia um túnel SSH reverso automático ou sobe a API em `0.0.0.0:${PORT}` temporariamente

### 16.2 Comando `npm run recover`

```bash
#!/usr/bin/env bash
# scripts/recover.sh

echo "Duart Panel - Recovery Mode"
echo "============================"

# 1. Verificar NGINX
if ! systemctl is-active --quiet nginx; then
    echo "[!] NGINX está parado. Tentando iniciar com config mínima..."
    
    # Backup da config atual
    cp -r /etc/nginx/sites-enabled /tmp/nginx-backup-enabled
    rm -f /etc/nginx/sites-enabled/*
    
    # Criar config mínima
    cat > /etc/nginx/sites-enabled/00-recovery.conf << NGINX_EOF
server {
    listen 80;
    root $(pwd)/out;
    index index.html;
    location / { try_files \$uri /index.html; }
    location /api/ { proxy_pass http://127.0.0.1:$PORT; }
}
NGINX_EOF

    nginx -t && nginx -s reload
    echo "[OK] NGINX iniciado em modo recovery."
    echo "    Acesse: http://$(hostname -I | awk '{print $1}')"
    echo "    Corrija a configuração e restaure os sites."
else
    echo "[OK] NGINX está rodando normalmente."
fi
```

### 16.3 Acesso de Emergência via SSH

Documentado no painel e no README:

```bash
# Se tudo falhar, acesse via SSH e execute:
ssh usuario@servidor
cd /opt/duart-panel
npm run recover
```

---

## Tema Dark/Light

### Implementação

- **Padrão: Dark** (cores conforme já definido no [`03-frontend.md`](idea/03-frontend.md))
- Toggle no header e em Configurações
- Preferência salva em `data/settings/config.json` (`"theme": "dark" | "light"`)
- Implementação via Tailwind CSS 4 com `class` strategy:

```typescript
// _app.tsx — ThemeProvider
// Adiciona classe "dark" ou "light" no <html>
// Tailwind config: darkMode: 'class'
```

### Paleta Light

| Token | Dark | Light |
|-------|------|-------|
| `bg-primary` | `#0f172a` (slate-900) | `#f8fafc` (slate-50) |
| `bg-secondary` | `#1e293b` (slate-800) | `#f1f5f9` (slate-100) |
| `bg-card` | `#1e293b` (slate-800) | `#ffffff` (white) |
| `text-primary` | `#f8fafc` (slate-50) | `#0f172a` (slate-900) |
| `text-muted` | `#94a3b8` (slate-400) | `#64748b` (slate-500) |
| `border` | `#334155` (slate-700) | `#e2e8f0` (slate-200) |
| `accent` | `#3b82f6` (blue-500) | `#2563eb` (blue-600) |
| `danger` | `#ef4444` (red-500) | `#dc2626` (red-600) |
| `success` | `#22c55e` (green-500) | `#16a34a` (green-600) |
| `warning` | `#f59e0b` (amber-500) | `#d97706` (amber-600) |

---

## Resumo da Estrutura Atualizada

```
data/
├── auth/
├── cpu-history/
├── nginx/
├── ssl/
│   └── certificates.json
├── cron/
│   ├── custom.json
│   └── managed.json
├── backups/
│   └── duart-panel-2026-07-28.tar.gz
├── settings/
└── logs/
    ├── panel.log
    ├── ssl-renewal.log
    └── recovery.log

/etc/ssl/duart-panel/
└── certs/
    └── ...
```
