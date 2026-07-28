# Duart Panel — Documentação

Painel web de gerenciamento de servidores Linux, desenvolvido com **Next.js 16 + React 19 + Tailwind CSS 4**.

## Sumário

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Instalação](#instalação)
4. [Módulos](#módulos)
5. [API Routes](#api-routes)
6. [Frontend](#frontend)
7. [Internacionalização](#internacionalização)
8. [Segurança](#segurança)
9. [Scripts](#scripts)
10. [Desenvolvimento](#desenvolvimento)

---

## Visão Geral

O Duart Panel é um painel de administração para servidores Linux que opera **sem banco de dados** — toda persistência é feita via arquivos no sistema de arquivos. Ele oferece 18 módulos funcionais para gerenciar completamente um servidor.

### Stack Principal

| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| Next.js | 16.2.12 | Pages Router |
| React | 19.2.4 | UI Framework |
| Tailwind CSS | 4 | Estilização |
| Node.js | 22 | Backend API |

### Modelo de Renderização

- **Frontend**: Static Site Generation (SSG) via `next export`
- **Dados**: Client-Side Rendering (CSR) via `fetch` às API Routes
- **Backend**: Next.js API Routes (`/pages/api/`) rodando em `next start`

---

## Arquitetura

```
Cliente (Browser)
    │
    ├── GET /*.html → NGINX → /out/ (estáticos)
    │
    └── GET/POST /api/* → NGINX → proxy → Node.js :PORT
                                            │
                                            └── child_process → SO
```

### Estrutura de Diretórios

```
duart-panel/
├── pages/           # Next.js Pages Router
│   ├── _app.tsx     # Providers (Auth, I18n, Theme, Toast)
│   ├── index.tsx    # Dashboard
│   ├── monitor/     # Monitor de Recursos
│   ├── files/       # Gerenciador de Arquivos
│   ├── tasks/       # Gerenciador de Tarefas
│   ├── nginx/       # NGINX Manager
│   ├── firewall/    # UFW Firewall
│   ├── docker/      # Docker Manager
│   ├── databases/   # Bancos de Dados
│   ├── security/    # Segurança
│   ├── ssl/         # SSL/TLS
│   ├── cron/        # Tarefas Cron
│   ├── backup/      # Backup & Restore
│   ├── logs/        # Visualizador de Logs
│   ├── network/     # Métricas de Rede
│   ├── settings/    # Configurações
│   └── api/         # API Routes (dinâmico)
├── components/      # Componentes React
│   ├── Layout/      # AppLayout, Sidebar, Header
│   └── ui/          # Button, Card, Modal, Input, etc.
├── lib/             # Bibliotecas internas
│   ├── auth.ts      # Autenticação
│   ├── system.ts    # Execução de comandos shell
│   ├── middleware/  # Middleware de auth
│   ├── contexts/    # Contextos React
│   ├── hooks/       # Custom hooks
│   └── data/        # Leitura/escrita de configurações
├── languages/       # Traduções i18n
│   ├── pt-BR/
│   ├── en-US/
│   └── es-ES/
├── scripts/         # Scripts utilitários
├── styles/          # CSS global
├── idea/            # Documentação técnica detalhada
└── docs/            # Documentação do projeto
```

---

## Instalação

### Pré-requisitos

- Ubuntu 22.04+ / Debian 12+ (alvo: Ubuntu 25.10)
- Acesso root ou sudo
- Domínio apontado para o servidor
- Portas 22, 80, 443 liberadas

### Instalação Rápida

```bash
git clone https://github.com/seu-usuario/duart-panel.git
cd duart-panel
sudo bash scripts/install.sh
```

### Pós-Instalação

1. Acesse `http://SEU_DOMINIO`
2. Crie o usuário administrador
3. Configure a chave API do DeepSeek em Configurações
4. Opcional: habilite SSL via Let's Encrypt

---

## Módulos

### 1. Dashboard
Visão geral com métricas de CPU, RAM, Disco, Uptime, Load Average e informações do sistema.

### 2. Monitor de Recursos
Gráficos históricos de CPU, memória e armazenamento com dados persistidos em arquivos diários.

### 3. Gerenciador de Arquivos
Navegação completa no sistema de arquivos com breadcrumb, ícones por tipo, e permissões visíveis.

### 4. Gerenciador de Tarefas
Lista de processos estilo `htop` com filtro, ordenação e kill de processos (SIGTERM/SIGKILL).

### 5. NGINX Manager
Criação/remoção de sites (estático, PHP, proxy reverso + WebSocket), validação e reload automático.

### 6. Firewall (UFW)
Gestão de regras UFW com status, políticas padrão e ações (allow/deny/reject/limit).

### 7. Docker Manager
Gestão de containers (start/stop/restart), visão geral com contagem de containers.

### 8. Bancos de Dados
Instalação e gestão de MySQL, PostgreSQL e MongoDB (status, versão, porta).

### 9. Segurança
Monitoramento do fail2ban (jails, IPs banidos) e visualização da configuração SSH.

### 10-18. Demais Módulos
SSL/TLS, Cron Jobs, Backup/Restore, Logs, Métricas de Rede, IA Assistant, Configurações.

---

## API Routes

### Autenticação

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/check` | Verificar sessão |
| POST | `/api/auth/setup` | Criar admin (primeiro acesso) |

### Sistema

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/system/stats` | CPU, RAM, Disco, Uptime |
| GET | `/api/system/cpu-history` | Histórico de CPU |
| GET | `/api/system/processes` | Lista de processos |
| POST | `/api/system/process` | Kill processo |
| GET | `/api/system/network` | Métricas de rede |

### Formato de Resposta Padrão

```json
{
  "success": true,
  "data": { ... },
  "error": "mensagem de erro (se success=false)"
}
```

---

## Frontend

### Padrão de Página (SSG + CSR)

```typescript
export default function MyPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/...')
      .then(res => res.json())
      .then(json => setData(json.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  return <AppLayout>...</AppLayout>;
}
```

### Componentes UI

- `Button` — 5 variantes (primary, danger, ghost, success, warning)
- `Card` — Container com borda e padding
- `Modal` — Overlay com backdrop blur
- `Input`, `Select` — Form controls com tema
- `Badge` — Indicador de status colorido
- `Spinner` — Loading spinner
- `ConfirmDialog` — Modal de confirmação

### Contextos React

- `AuthContext` — Autenticação e sessão
- `I18nContext` — Internacionalização
- `ThemeContext` — Dark/Light mode
- `ToastContext` — Notificações toast

---

## Internacionalização

Suporte a 3 idiomas:

| Código | Idioma |
|--------|--------|
| `pt-BR` | Português (padrão) |
| `en-US` | English |
| `es-ES` | Español |

As traduções são organizadas por namespace em arquivos `.js` na pasta `languages/`.

---

## Segurança

### Autenticação

- Senhas com bcrypt (12 rounds)
- Sessão via JWT com cookie HttpOnly
- Proteção contra brute force (5 tentativas, lockout 15 min)
- Primeiro acesso: criação obrigatória de admin

### Execução de Comandos

- Whitelist estrita de comandos permitidos
- Validação de argumentos com regex
- Timeout por operação
- Comandos perigosos bloqueados

### Dados Sensíveis

- API keys mascaradas no frontend
- Arquivos com permissões restritas (600/640)
- Logs não registram senhas

---

## Scripts

### `scripts/install.sh`
Script de instalação completa: Node.js, NGINX, UFW, build, PM2.

### `scripts/recover.sh`
Modo de recuperação: inicia NGINX com config mínima se estiver quebrado.

### `scripts/renew-ssl.js`
Renovação automática de certificados SSL (Let's Encrypt).

### `scripts/rotate-logs.js`
Rotação semanal de arquivos de log do painel.

---

## Desenvolvimento

### Comandos

```bash
npm run dev      # Desenvolvimento (next dev)
npm run build    # Build + Export (next build && next export)
npm start        # Produção (next start)
npm run lint     # ESLint
```

### Dados Persistentes

```
/var/lib/duart-panel/
├── auth/          # users.json, .secret
├── cpu-history/   # YYYY-MM-DD.txt
├── nginx/         # sites.json
├── ssl/           # certificates.json
├── cron/          # custom.json, managed.json
├── backups/       # .tar.gz
├── settings/      # config.json
└── logs/          # panel.log, ssl-renewal.log
```

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DATA_DIR` | `./data` | Diretório de dados persistentes |
| `PORT` | `0` (aleatória) | Porta do servidor API |
| `NODE_ENV` | `development` | Ambiente Node.js |
