# Duart Panel — Visão Geral do Projeto

## 1. Objetivo

O **Duart Panel** é um painel web de gerenciamento de servidores Linux, desenvolvido com **Next.js 16** (Pages Router) + **React 19** + **Tailwind CSS 4**, operando completamente sem banco de dados — toda a persistência é feita via arquivos no sistema de arquivos do servidor.

### Funcionalidades Principais

| # | Módulo | Descrição |
|---|--------|-----------|
| 1 | **Dashboard** | Visão geral com métricas de CPU, RAM, disco, rede, uptime, carga |
| 2 | **Monitor de Recursos** | Gráficos históricos de CPU (arquivo txt), memória, armazenamento e rede |
| 3 | **Gerenciador de Arquivos** | File manager completo com navegação, upload, download, edição, permissões |
| 4 | **Gerenciador de Tarefas** | Visão tipo `top`/`htop` com kill de processos (tecla Del) |
| 5 | **NGINX Manager** | Adicionar/remover sites, PHP-FPM, estáticos, proxy reverso + WebSocket + SSL |
| 6 | **Firewall (UFW)** | Gestão completa de regras do UFW |
| 7 | **Docker Manager** | Gestão de containers, imagens, volumes e redes Docker |
| 8 | **Banco de Dados** | Instalação e gestão de MySQL, PostgreSQL e MongoDB (sob demanda) |
| 9 | **Segurança** | Gestão do fail2ban, configurações de SSH |
| 10 | **SSL/TLS** | Let's Encrypt (HTTP/DNS), certificados manuais, Cloudflare Origin, renovação automática |
| 11 | **Tarefas Cron** | Gestão visual de cron jobs com whitelist de segurança |
| 12 | **Backup & Restore** | Backup completo do painel e restore via upload |
| 13 | **Visualizador de Logs** | Centralizador de logs: painel, NGINX, sistema (journalctl), UFW, fail2ban |
| 14 | **Métricas de Rede** | Throughput, conexões ativas, tráfego por interface, métricas NGINX |
| 15 | **Modo de Recuperação** | Recovery mode se NGINX quebrar + túnel SSH de emergência |
| 16 | **Configurações** | Hostname, nome do servidor, idioma, tema (dark/light), chave de API da IA |
| 17 | **IA Assistant** | Modal com DeepSeek via OpenAI SDK (Ctrl+5 / Cmd+5), modo streaming |
| 18 | **i18n** | Português (padrão), Inglês, Espanhol — um arquivo por página |

## 2. Stack Tecnológica

### Frontend (Estático — SSG via `next export`)
- **Next.js 16.2.12** (Pages Router — `/pages`)
- **React 19.2.4**
- **Tailwind CSS 4** (com `@tailwindcss/postcss`)
- **react-icons** v5
- **Recharts** 2.x (gráficos: CPU, rede, histórico)
- **xterm.js** (terminal web - futuro)
- **openai** SDK (DeepSeek via OpenAI-compatible endpoint)
- **Modelo de renderização**: Static Site Generation (SSG). Todas as páginas são exportadas como HTML/CSS/JS estático. Os dados dinâmicos são obtidos exclusivamente via Client-Side Rendering (CSR) através de chamadas `fetch` às API Routes
- **Tema**: Dark (padrão) e Light, com toggle no header

### Backend (Dinâmico — API Routes)
- **Next.js API Routes** (`/pages/api/`) — única porção server-side da aplicação
- **Node.js 22** (instalado via NVM)
- Módulos nativos: `child_process`, `fs`, `path`, `os`
- `node-pty` (terminal interativo, opcional)
- **Modo de execução**: `next start` (servidor Node.js) para servir as API Routes; os assets estáticos são servidos diretamente pelo NGINX no caminho `/out/`

### Sistema (binários gerenciados)
- `nginx` — servidor web / proxy reverso
- `ufw` — firewall
- `fail2ban` — proteção contra brute-force
- `docker` / `docker compose` — containers
- `mysql-server`, `postgresql`, `mongod` — bancos (instaláveis sob demanda)
- `php-fpm` — PHP via socket UNIX
- `certbot` — Let's Encrypt (instalado sob demanda ao usar SSL)
- `cron` — agendador de tarefas do sistema

## 3. Princípios de Design

1. **Sem banco de dados**: Tudo persiste em arquivos JSON, `.conf`, `.txt` no filesystem
2. **Autenticação por arquivo**: Usuário/senha armazenados em `data/auth/users.json` com bcrypt
3. **Frontend Estático (SSG)**: Todas as páginas são pré-renderizadas como HTML/CSS/JS estático via `next build && next export`. Apenas as API Routes (`/pages/api/`) são dinâmicas (server-side). Todo dado dinâmico é obtido via fetch no client-side (CSR) chamando os endpoints da API
4. **Dados persistentes segregados**: Dados do painel armazenados em `/var/lib/duart-panel/data/` (link simbólico a partir do projeto), garantindo que um `rm -rf` no projeto não destrua configurações
5. **Baixo acoplamento**: Cada módulo é independente; APIs são stateless
6. **Segurança**: Todas as chamadas de API validam sessão; comandos shell usam whitelist
7. **Idempotência**: Operações como instalação de binários verificam estado antes de agir
8. **Resiliência**: Modo de recuperação garante acesso ao painel mesmo se o NGINX quebrar

## 4. Estrutura de Diretórios (visão macro)

```
duart-panel/
├── pages/                    # Next.js Pages Router
│   ├── index.tsx             # Dashboard (SSG)
│   ├── _app.tsx              # App wrapper (auth, i18n, theme)
│   ├── _document.tsx         # Document
│   ├── monitor/              # Monitor de recursos (SSG)
│   ├── files/                # Gerenciador de arquivos (SSG)
│   ├── tasks/                # Gerenciador de tarefas (SSG)
│   ├── nginx/                # NGINX Manager (SSG)
│   ├── firewall/             # UFW Firewall (SSG)
│   ├── docker/               # Docker Manager (SSG)
│   ├── databases/            # MySQL, PgSQL, MongoDB (SSG)
│   ├── security/             # fail2ban (SSG)
│   ├── settings/             # Configurações (SSG)
│   └── api/                  # API Routes (DINÂMICO - único server-side)
├── out/                      # Output do next export (HTML/CSS/JS estático)
├── components/               # Componentes reutilizáveis
├── lib/                      # Bibliotecas internas
│   ├── auth.ts               # Autenticação
│   ├── system.ts             # Comandos de sistema
│   ├── nginx.ts              # Parsers NGINX
│   ├── docker.ts             # Docker helper
│   └── ...
├── languages/                # i18n por página
│   ├── pt-br/
│   ├── en-us/
│   └── es-es/
├── data/                     # Dados persistentes
│   ├── auth/
│   ├── cpu-history/
│   ├── nginx/
│   └── ...
├── idea/                     # Documentação técnica
├── install.sh                # Script de instalação
├── package.json
└── next.config.ts
```

## 5. Público-Alvo e Compatibilidade

- **SO primário**: Ubuntu 25.10 (GNU/Linux 6.17.0-41-generic x86_64)
- **Compatibilidade planejada**: Ubuntu 22.04+, Debian 12+, outras distros baseadas em Debian via ajustes no script de instalação
- **Acesso**: Navegador moderno (Chrome, Firefox, Safari, Edge)
