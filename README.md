# Duart Panel

Painel web de gerenciamento de servidores Linux desenvolvido com **Next.js 16** + **React 19** + **Tailwind CSS 4**, operando completamente sem banco de dados — toda persistência via arquivos no sistema.

---

## Funcionalidades

| # | Módulo | Descrição |
|---|--------|-----------|
| 1 | **Dashboard** | Métricas de CPU, RAM, disco, rede, uptime em tempo real |
| 2 | **Monitor de Recursos** | Gráficos históricos de CPU, memória, armazenamento |
| 3 | **Gerenciador de Arquivos** | Navegação, upload, download, edição, permissões |
| 4 | **Gerenciador de Tarefas** | Visão `htop` com kill de processos |
| 5 | **NGINX Manager** | Criar/remover sites (estático, PHP, proxy reverso + WebSocket) |
| 6 | **Firewall (UFW)** | Gestão completa de regras, toggle on/off |
| 7 | **Docker Manager** | Containers, imagens, volumes, redes, docker compose |
| 8 | **Bancos de Dados** | Instalação e gestão de MySQL, PostgreSQL, MongoDB |
| 9 | **Segurança** | fail2ban (instalação, jails, bans), configuração SSH |
| 10 | **SSL/TLS** | Let's Encrypt (HTTP/DNS), certificados manuais, Cloudflare Origin |
| 11 | **Tarefas Cron** | Gestão visual de cron jobs com validação |
| 12 | **Backup & Restore** | Backup completo e restore via upload |
| 13 | **Visualizador de Logs** | Painel, NGINX, sistema, UFW, fail2ban, SSL |
| 14 | **Métricas de Rede** | Throughput, conexões ativas, portas, métricas NGINX |
| 15 | **Modo de Recuperação** | Recovery mode se NGINX quebrar |
| 16 | **IA Assistant** | Chat com DeepSeek via OpenAI SDK (`Ctrl+5`), modo streaming |
| 17 | **Configurações** | Hostname, idioma (PT/EN/ES), tema dark/light, API key |
| 18 | **i18n** | Português (padrão), Inglês, Espanhol |

---

## Requisitos do Servidor

- **Ubuntu 22.04+ / Debian 12+** (alvo principal: Ubuntu 25.10)
- Acesso **root** ou **sudo**
- Domínio apontado para o IP do servidor (DNS configurado)
- Portas **22**, **80**, **443** liberadas no provedor

---

## Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/seu-usuario/duart-panel.git /opt/duart-panel
cd /opt/duart-panel
```

### 2. Execute o script de instalação

```bash
sudo bash scripts/install.sh
```

O script solicitará o domínio e executará automaticamente:

- ✅ Verificação/instalação do **Node.js 22** via NVM
- ✅ Instalação/configuração do **NGINX**
- ✅ Configuração do **UFW** (portas 22, 587, 80, 443)
- ✅ Eleição de porta aleatória (10000-60000)
- ✅ Criação da estrutura de diretórios em `/var/lib/duart-panel/`
- ✅ `npm install` + build (`next build && next export`)
- ✅ Configuração do vhost NGINX (proxy reverso)
- ✅ Instalação do **PM2** + startup automática
- ✅ Configuração de cron jobs (SSL renewal, log rotation)
- ✅ Criação do script de recuperação

### 3. Primeiro acesso

Acesse `http://SEU_DOMINIO` no navegador:

1. Crie o usuário **admin** (primeiro acesso)
2. Configure a chave da API DeepSeek em **Configurações** (opcional)
3. Opcionalmente instale Docker, bancos de dados, fail2ban via interface

---

## Arquitetura

O Duart Panel utiliza o **Next.js como servidor completo** (páginas + API), com o **NGINX como proxy reverso** na frente.

```
┌──────────────────────────────────────────────────────┐
│                    CLIENTE (Browser)                  │
│  React 19 + Tailwind CSS 4 + react-icons + Charts    │
└──────────────────────┬───────────────────────────────┘
                       │ HTTPS (ou HTTP)
                       ▼
┌──────────────────────────────────────────────────────┐
│                 NGINX (Proxy Reverso)                 │
│                                                      │
│  location / {                                         │
│    proxy_pass http://127.0.0.1:PORT;  → TUDO para    │
│  }                                      Next.js       │
│                                                      │
│  + SSL (Let's Encrypt, configurado automaticamente)   │
└──────────────────────┬───────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────┐
│          Next.js Server (PM2 - porta aleatória)       │
│                                                      │
│  • Páginas React (Server-Side Rendering)              │
│  • API Routes (REST)                                  │
│  • Streaming IA (SSE)                                 │
│                                                      │
└──────────────────────┬───────────────────────────────┘
                       │ child_process / fs
                       ▼
┌──────────────────────────────────────────────────────┐
│                  SISTEMA OPERACIONAL                  │
│  NGINX │ UFW │ Docker │ MySQL │ fail2ban │ certbot   │
└──────────────────────────────────────────────────────┘
```

## Estrutura de Diretórios

```
/opt/duart-panel/               # Código do projeto
├── pages/                      # Pages Router (páginas + API Routes)
├── components/                 # Componentes React
├── lib/                        # Bibliotecas internas
│   ├── ai/                     # Cliente IA (DeepSeek) + parser
│   ├── contexts/               # Auth, I18n, Theme, Toast
│   ├── hooks/                  # useApi, useKeyboard
│   ├── middleware/              # Auth middleware
│   ├── auth.ts                 # Autenticação
│   ├── system.ts               # Comandos de sistema (whitelist)
│   ├── nginx.ts                # Geradores de config NGINX
│   └── docker.ts               # Parsers Docker
├── languages/                  # i18n (pt-BR, en-US, es-ES)
├── scripts/                    # Scripts do sistema
│   ├── install.sh              # Instalação completa
│   ├── setup-ssl.sh            # Configurar SSL (Let's Encrypt)
│   ├── remove-ssl.sh           # Remover SSL
│   ├── recover.sh              # Modo de recuperação
│   ├── renew-ssl.js            # Renovação automática SSL
│   └── rotate-logs.js          # Rotação de logs

/var/lib/duart-panel/           # Dados persistentes
├── auth/                       # Usuários e chave JWT
├── cpu-history/                # Histórico CPU (1 arquivo/dia)
├── nginx/                      # Registro de sites
├── ssl/                        # Registro de certificados
├── cron/                       # Jobs customizados
├── backups/                    # Arquivos .tar.gz
├── settings/                   # config.json
└── logs/                       # Logs do painel
```

---

## Comandos Úteis

| Comando | Descrição |
|---------|-----------|
| `pm2 status` | Status do servidor API |
| `pm2 logs duart-panel-api` | Logs em tempo real |
| `pm2 restart duart-panel-api` | Reiniciar API |
| `sudo bash scripts/recover.sh` | Modo de recuperação (NGINX quebrado) |
| `sudo nginx -t` | Testar configuração NGINX |
| `sudo nginx -s reload` | Recarregar NGINX |

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| **Frontend** | React 19, Next.js 16 (Pages Router), Tailwind CSS 4, Recharts, react-icons |
| **Renderização** | Next.js Server (SSR + API Routes via PM2) |
| **Backend** | Next.js API Routes, Node.js 22 |
| **IA** | DeepSeek via OpenAI SDK (streaming SSE) |
| **Process Manager** | PM2 |
| **Proxy Reverso** | NGINX (proxy total → `http://127.0.0.1:PORT`) |
| **Persistência** | File-based (JSON, .conf, .txt) — sem banco de dados |

---

## Segurança

- Autenticação JWT com cookies HttpOnly
- Senhas com bcrypt (12 rounds)
- Whitelist de comandos shell
- Proteção contra path traversal
- Bloqueio de comandos perigosos (fork bombs, wipe disk)
- API key da IA mascarada no frontend
- Permissões restritas em arquivos sensíveis (600/640)

---

## Compatibilidade

| Distro | Versão | Status |
|--------|--------|--------|
| Ubuntu | 25.10 | ✅ Alvo principal |
| Ubuntu | 24.04 LTS | ✅ Compatível |
| Ubuntu | 22.04 LTS | ✅ Compatível |
| Debian | 12 (Bookworm) | ✅ Compatível |

---

## Licença

MIT
