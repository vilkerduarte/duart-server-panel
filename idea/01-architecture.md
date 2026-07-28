# Duart Panel — Arquitetura Técnica

## 1. Visão Geral da Arquitetura

O Duart Panel segue uma arquitetura **híbrida estático/dinâmica**:

- **Frontend 100% Estático (SSG)**: Todas as páginas React são pré-renderizadas no build (`next build && next export`) e servidas como HTML/CSS/JS estático pelo NGINX. Nenhuma renderização server-side ocorre em tempo de execução.
- **Backend Dinâmico (API Routes)**: Apenas os endpoints em `/pages/api/` rodam no servidor Node.js (`next start`), expondo uma API REST que o frontend consome via fetch no client-side (CSR).
- **NGINX** faz o roteamento: arquivos estáticos (`/out/`) são servidos diretamente; requisições `/api/*` são proxy-pass para o Node.js.

```
┌──────────────────────────────────────────────────────┐
│                    CLIENTE (Browser)                  │
│  React 19 + Tailwind CSS 4 + react-icons + Charts    │
│  (CSR: todos os dados vêm de fetch → /api/*)         │
└──────────┬──────────────────────────────┬────────────┘
           │                              │
           │ GET /* (HTML/JS/CSS)         │ GET/POST /api/*
           ▼                              ▼
┌──────────────────────────────────────────────────────┐
│                 NGINX (Proxy Reverso)                 │
│                                                      │
│  location / {               location /api/ {          │
│    root /out/;       →        proxy_pass :PORT;      │
│    try_files $uri            }                       │
│      /index.html;         + WebSocket Upgrade        │
│  }                           (IA streaming)          │
└──────────┬──────────────────────────────┬────────────┘
           │                              │
           ▼                              ▼
┌────────────────────┐  ┌──────────────────────────────┐
│  Arquivos Estáticos │  │  Next.js API Server (Node 22) │
│  /out/ (HTML/JS/CSS)│  │  (apenas /pages/api/)        │
│  Servido via NGINX │  │                              │
│  (sem Node.js)     │  │  • auth/login, logout         │
│                    │  │  • system/cpu, mem, disk     │
│                    │  │  • nginx/sites               │
│                    │  │  • firewall/rules            │
│                    │  │  • docker/*                  │
│                    │  │  • databases/*               │
│                    │  │  • security/fail2ban         │
│                    │  │  • settings/*                │
│                    │  │  • ai/chat (SSE streaming)   │
│                    │  │  • files/*                   │
│                    │  │  • tasks/*                   │
│                    │  └──────────┬───────────────────┘
└────────────────────┘            │ child_process / fs
                                  ▼
┌──────────────────────────────────────────────────────┐
│                  SISTEMA OPERACIONAL                  │
│  ┌──────┐ ┌──────┐ ┌───────┐ ┌──────┐ ┌──────────┐  │
│  │NGINX │ │ UFW  │ │Docker │ │MySQL │ │fail2ban  │  │
│  └──────┘ └──────┘ └───────┘ └──────┘ └──────────┘  │
│  ┌──────┐ ┌───────┐ ┌────┐ ┌───────┐ ┌──────────┐   │
│  │ CPU  │ │  RAM  │ │Disk│ │Procs  │ │PHP-FPM   │   │
│  └──────┘ └───────┘ └────┘ └───────┘ └──────────┘   │
└──────────────────────────────────────────────────────┘
```

### 1.1 Modelo de Renderização: SSG + CSR

A aplicação adota o padrão **Static Site Generation (SSG)** com **Client-Side Rendering (CSR)** para dados dinâmicos:

| Camada | Onde Roda | Build | Runtime |
|--------|-----------|-------|---------|
| Páginas (`/pages/*` exceto `/api`) | Build time → HTML/CSS/JS estático | `next build && next export` | Servido pelo NGINX como arquivos estáticos da pasta `/out/` |
| API Routes (`/pages/api/*`) | Servidor Node.js | Compilado (TS→JS) | `next start` na porta aleatória |
| Dados dinâmicos | Browser do cliente | N/A | `fetch('/api/...')` nas páginas após o carregamento inicial |

**Fluxo de carregamento de uma página:**

```
1. Browser requisita GET /nginx → NGINX serve /out/nginx.html (estático)
2. React hidrata a página (shell da UI aparece instantaneamente)
3. useEffect dispara fetch('/api/nginx/sites') → API retorna JSON
4. Estado atualiza → UI reflete dados reais do servidor
5. Indicador de loading/spinner durante o fetch
```

**Benefícios desta abordagem:**

- **Performance**: HTML/CSS/JS estático servido diretamente pelo NGINX, sem Node.js no caminho crítico
- **Segurança**: Superfície de ataque reduzida — o Node.js só expõe `/api/*`, não processa SSR/JSX
- **Cache**: Arquivos estáticos podem ser cacheados agressivamente (immutable assets com hash)
- **Desacoplamento**: Frontend e backend são completamente independentes; o frontend poderia ser servido de um CDN
- **Resiliência**: Se o servidor Node.js cair, o shell da UI ainda carrega (mostra erro nos dados, mas a navegação funciona)

**Configuração no Next.js:**

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',        // Habilita next export (SSG)
  distDir: 'out',          // Output em /out/
  // API routes NÃO são exportadas — rodam apenas no servidor
};
```

```json
// package.json scripts
{
  "build": "next build && next export",
  "start": "node server.js"  // ou PM2: next start -p $PORT (apenas API routes)
}
```

## 2. Mecanismo de Comunicação com o SO

Toda a comunicação com o sistema operacional é feita através de APIs REST que executam comandos shell via `child_process.exec` ou `child_process.spawn`.

### 2.1 Abordagem de Execução de Comandos

```typescript
// lib/system.ts - Estrutura conceitual

type CommandWhitelist = {
  [key: string]: {
    bin: string;        // binário permitido (ex: 'systemctl', 'nginx')
    args: string[];     // argumentos permitidos
    sudo: boolean;      // requer sudo?
    timeout: number;    // timeout em ms
  };
};

async function executeCommand(
  commandKey: string,
  extraArgs?: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  // 1. Valida contra whitelist
  // 2. Constrói comando seguro
  // 3. Executa com child_process.exec
  // 4. Retorna resultado
}
```

### 2.2 Whitelist de Comandos (Principais)

| Chave | Binário | Propósito |
|-------|---------|-----------|
| `cpu_info` | `cat /proc/stat` | Info CPU |
| `mem_info` | `cat /proc/meminfo` | Info memória |
| `disk_info` | `df -h --output=...` | Info disco |
| `process_list` | `ps aux --sort=-%cpu` | Lista processos |
| `kill_process` | `kill -9 <pid>` | Matar processo |
| `nginx_reload` | `nginx -t && nginx -s reload` | Recarregar NGINX |
| `ufw_status` | `ufw status verbose` | Status firewall |
| `ufw_allow` | `ufw allow <port>` | Liberar porta |
| `docker_ps` | `docker ps -a --format json` | Listar containers |
| `systemctl` | `systemctl <action> <svc>` | Gerenciar serviços |
| `hostnamectl` | `hostnamectl set-hostname` | Alterar hostname |

## 3. Fluxo de Autenticação

```
┌──────────┐      POST /api/auth/login       ┌──────────┐
│  Client   │ ────────────────────────────────▶│  API     │
│           │  { user, password }              │          │
│           │                                  │          │
│           │◀────────────────────────────────│          │
│           │  { token: JWT }                  │          │
│           │  Set-Cookie: token=JWT; HttpOnly │          │
└──────────┘                                  └──────────┘
```

### 3.1 Autenticação Baseada em Arquivo

- Usuários armazenados em `data/auth/users.json`
- Senhas com bcrypt (12 rounds)
- Sessão via JWT (jsonwebtoken) com cookie HttpOnly
- Chave secreta JWT armazenada em `data/auth/.secret`
- Middleware de validação em todas as API routes (exceto `/api/auth/login`)

### 3.2 Estrutura do Arquivo de Usuários

```json
{
  "users": [
    {
      "id": "uuid-v4",
      "username": "admin",
      "passwordHash": "$2b$12$...",
      "role": "admin",
      "createdAt": "2026-07-28T00:00:00Z"
    }
  ]
}
```

## 4. Modelo de Dados (File-Based)

### 4.1 Hierarquia de Arquivos de Dados

```
data/
├── auth/
│   ├── users.json          # Usuários do painel
│   └── .secret             # Chave JWT (permissão 600)
├── cpu-history/
│   ├── 2026-07-28.txt      # CPU por dia (1 arquivo/dia)
│   ├── 2026-07-29.txt
│   └── ...
├── nginx/
│   └── sites.json          # Config. de sites gerenciados
├── settings/
│   └── config.json         # Configurações do painel
├── firewall/
│   └── custom-rules.json   # Regras customizadas UFW
└── logs/
    └── panel.log           # Log do painel
```

### 4.2 Configurações (`data/settings/config.json`)

```json
{
  "serverName": "Meu Servidor",
  "hostname": "srv-01",
  "language": "pt-BR",
  "aiApiKey": "",
  "aiModel": "deepseek-chat",
  "theme": "dark",
  "port": 0,
  "domain": "",
  "installedModules": {
    "mysql": false,
    "postgresql": false,
    "mongodb": false,
    "docker": false
  }
}
```

## 5. Next.js API Routes — Estrutura

```
pages/api/
├── auth/
│   ├── login.ts            # POST - Login
│   ├── logout.ts           # POST - Logout
│   └── check.ts            # GET  - Validar sessão
├── system/
│   ├── stats.ts            # GET  - CPU, RAM, Disco, Uptime
│   ├── cpu-history.ts      # GET  - Histórico CPU
│   ├── processes.ts        # GET  - Lista processos
│   └── process.ts          # POST - Kill processo
├── nginx/
│   ├── sites.ts            # GET/POST - Listar/Criar sites
│   └── site.ts             # PUT/DELETE - Editar/Remover site
├── firewall/
│   ├── rules.ts            # GET/POST - Listar/Adicionar
│   └── rule.ts             # DELETE - Remover regra
├── docker/
│   ├── containers.ts       # GET - Listar containers
│   ├── container.ts        # POST/DELETE - Ação em container
│   ├── images.ts           # GET - Listar imagens
│   ├── volumes.ts          # GET/POST/DELETE - Volumes
│   └── networks.ts         # GET/POST/DELETE - Redes
├── databases/
│   ├── mysql.ts            # POST - Install/Status/Manage
│   ├── postgresql.ts       # POST - Install/Status/Manage
│   └── mongodb.ts          # POST - Install/Status/Manage
├── security/
│   ├── fail2ban.ts         # GET/POST - Status/Config
│   └── ssh-config.ts       # GET/POST - Config SSH
├── files/
│   ├── list.ts             # GET  - Listar diretório
│   ├── read.ts             # GET  - Ler arquivo
│   ├── write.ts            # POST - Escrever/Editar
│   ├── upload.ts           # POST - Upload
│   ├── delete.ts           # DELETE - Remover
│   ├── mkdir.ts            # POST - Criar diretório
│   ├── rename.ts           # PUT  - Renomear
│   └── permissions.ts      # PUT  - Alterar permissões
├── settings/
│   ├── config.ts           # GET/PUT - Configurações
│   └── hostname.ts         # PUT - Alterar hostname
└── ai/
    └── chat.ts             # POST - Chat IA (streaming)
```

## 6. Fluxo de Gravação do Histórico de CPU

1. Endpoint `api/system/stats` é chamado pelo frontend a cada 5 segundos
2. O backend, além de retornar stats atuais, grava no arquivo `data/cpu-history/YYYY-MM-DD.txt`
3. Formato: `<timestamp ISO>,<cpu_percent>,<load_1m>,<load_5m>,<load_15m>`
4. Rotação: um arquivo por dia, cleanup automático após 30 dias
5. O endpoint `api/system/cpu-history` lê o arquivo do dia e retorna para o gráfico

```
2026-07-28T01:00:05Z,23.5,0.45,0.32,0.28
2026-07-28T01:00:10Z,25.1,0.47,0.33,0.29
2026-07-28T01:00:15Z,22.8,0.44,0.32,0.28
...
```

## 7. Tratamento de Erros e Logging

- Todas as API routes retornam `{ success: boolean, data?: any, error?: string }`
- Logs do painel em `data/logs/panel.log` com timestamp e nível
- Erros de comandos shell capturam stderr e retornam ao frontend
- Timeouts configurados por comando (30s padrão, ajustável)
