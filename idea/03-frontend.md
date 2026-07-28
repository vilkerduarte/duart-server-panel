# Duart Panel — Estrutura do Frontend

## 1. Stack do Frontend

| Tecnologia | Versão | Uso |
|-----------|--------|-----|
| React | 19.2.4 | UI Framework |
| Next.js | 16.2.12 | Pages Router |
| Tailwind CSS | 4 | Estilização |
| react-icons | 5.7 | Ícones (Heroicons, Bootstrap Icons, etc.) |
| Recharts | 2.x | Gráficos (CPU History, métricas) |
| openai | 4.x | SDK para IA (DeepSeek) |

## 2. Modelo de Renderização: SSG + CSR

### 2.1 Princípio Fundamental

**Todas as páginas do frontend são estáticas e exportáveis.** Nenhuma página usa `getServerSideProps`. O build gera HTML/CSS/JS puro via `next build && next export`. Apenas os endpoints em [`pages/api/`](pages/api/) são dinâmicos e rodam no servidor Node.js.

### 2.2 Padrão de Data Fetching

Toda obtenção de dados segue o modelo **Client-Side Rendering (CSR)**:

```typescript
// Padrão para TODAS as páginas
import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/system/stats')
      .then(res => res.json())
      .then(json => {
        if (json.success) setData(json.data);
        else setError(json.error);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} />;
  return <Dashboard data={data} />;
}
```

### 2.3 Regras para Páginas Estáticas

1. **Proibido `getServerSideProps`**: Nenhuma página pode usar SSR — quebraria o `next export`
2. **Proibido `getStaticProps` com dados dinâmicos do servidor local**: Os dados do sistema (CPU, processos, etc.) só existem em runtime, não no build. Use CSR
3. **Permitido `getStaticProps` para dados de build-time**: Ex: lista de idiomas disponíveis, versão do painel, metadados constantes
4. **`getStaticPaths` com `fallback: false`**: Para páginas com rotas dinâmicas como `/nginx/site/[id].tsx`, usar `getStaticPaths` retornando array vazio + `fallback: false`, pois a navegação real usa query params ou state
5. **Rotas dinâmicas puras**: Páginas como `/files/[[...path]].tsx` (catch-all) devem ser CSR-only — o path é lido do `router.query` no cliente e passado para `fetch('/api/files/list?path=...')`

### 2.4 Estratégia de Rotas Dinâmicas

Como o `next export` não suporta `getStaticPaths` com paths desconhecidos no build, as rotas dinâmicas devem evitar depender de paths estáticos:

| Página | Estratégia |
|--------|-----------|
| `/files/[[...path]].tsx` | Catch-all optional. No build, gera apenas `/files`. O path real é extraído de `router.query.path` no cliente |
| `/nginx/site/[id].tsx` | Gera fallback vazio. Na prática, navegação usa `/nginx/site/new` para criar e query params para editar |
| `/docker/container/[id].tsx` | Mesma estratégia: `getStaticPaths` retorna `{ paths: [], fallback: false }`. O ID é passado via query string |

**Alternativa recomendada**: Evitar rotas dinâmicas para páginas. Usar query params:

```
/nginx/site?id=abc123        (em vez de /nginx/site/abc123)
/docker/container?id=def456  (em vez de /docker/container/def456)
```

## 3. Estrutura de Páginas

```
pages/
├── _app.tsx                    # App Wrapper: AuthProvider, I18nProvider, ThemeProvider
├── _document.tsx               # Documento base HTML
├── index.tsx                   # Dashboard (SSG + CSR)
│
├── monitor/
│   └── index.tsx               # Monitor detalhado: CPU, RAM, Disco (SSG + CSR)
│
├── files/
│   └── index.tsx               # Gerenciador de Arquivos (SSG + CSR, path via query)
│
├── tasks/
│   └── index.tsx               # Gerenciador de Tarefas (SSG + CSR)
│
├── nginx/
│   ├── index.tsx               # Lista de sites NGINX (SSG + CSR)
│   └── site.tsx                # Criar/Editar site (SSG + CSR, id via query)
│
├── firewall/
│   └── index.tsx               # Gerenciamento UFW (SSG + CSR)
│
├── docker/
│   ├── index.tsx               # Visão geral Docker (SSG + CSR)
│   └── container.tsx            # Detalhes do container (SSG + CSR, id via query)
│
├── databases/
│   ├── index.tsx               # Visão geral Bancos (SSG + CSR)
│   ├── mysql.tsx               # MySQL (SSG + CSR)
│   ├── postgresql.tsx          # PostgreSQL (SSG + CSR)
│   └── mongodb.tsx             # MongoDB (SSG + CSR)
│
├── security/
│   ├── index.tsx               # Visão geral Segurança (SSG + CSR)
│   ├── fail2ban.tsx            # fail2ban (SSG + CSR)
│   └── ssh.tsx                 # Config SSH (SSG + CSR)
│
├── settings/
│   └── index.tsx               # Configurações do painel (SSG + CSR)
│
└── api/                        # (API Routes - backend DINÂMICO)
    └── ...
```

## 3. Componentes Compartilhados (`components/`)

### 3.1 Layout

```
components/
├── Layout/
│   ├── AppLayout.tsx           # Layout principal: Sidebar + Header + Content
│   ├── Sidebar.tsx             # Menu lateral com ícones
│   ├── Header.tsx              # Topo: breadcrumb, avatar, busca
│   └── Content.tsx             # Área de conteúdo
│
├── ui/
│   ├── Button.tsx              # Botão com variantes (primary, danger, ghost)
│   ├── Card.tsx                # Card container
│   ├── Modal.tsx               # Modal genérico
│   ├── ConfirmDialog.tsx       # Diálogo de confirmação (Sim/Não)
│   ├── Input.tsx               # Input com label e validação
│   ├── Select.tsx              # Select dropdown
│   ├── Badge.tsx               # Badge de status
│   ├── Spinner.tsx             # Loading spinner
│   ├── Toast.tsx               # Notificações toast
│   ├── Switch.tsx              # Toggle switch
│   ├── Table.tsx               # Tabela de dados com sorting
│   ├── Tabs.tsx                # Abas
│   └── CodeBlock.tsx           # Bloco de código (para scripts)
│
├── charts/
│   ├── CpuChart.tsx            # Gráfico de CPU (área/linha) com Recharts
│   ├── MemoryChart.tsx         # Gráfico de memória (barra/área)
│   ├── DiskChart.tsx           # Gráfico de disco (pizza/barras)
│   └── NetworkChart.tsx        # Gráfico de rede (linha)
│
├── system/
│   ├── CpuGauge.tsx            # Medidor circular CPU
│   ├── MemoryBar.tsx           # Barra de progresso RAM
│   ├── DiskUsage.tsx           # Uso de disco por partição
│   ├── UptimeDisplay.tsx       # Display de uptime formatado
│   └── SystemInfo.tsx          # Info do SO, kernel, arch
│
├── files/
│   ├── FileBrowser.tsx         # Navegador de arquivos (tabela + breadcrumb)
│   ├── FileRow.tsx             # Linha de arquivo (ícone, nome, tamanho, ações)
│   ├── FileEditor.tsx          # Editor de texto inline (Monaco-lite)
│   ├── FileUploader.tsx        # Componente de upload (drag & drop)
│   └── PermissionEditor.tsx    # Editor de permissões (chmod visual)
│
├── tasks/
│   ├── ProcessTable.tsx        # Tabela de processos
│   ├── ProcessRow.tsx          # Linha de processo
│   └── ProcessDetail.tsx       # Modal de detalhes do processo
│
├── nginx/
│   ├── SiteForm.tsx            # Formulário de site (static/php/proxy)
│   ├── SiteCard.tsx            # Card de site (status, ações)
│   └── NginxStatus.tsx         # Status do serviço nginx
│
├── firewall/
│   ├── RuleTable.tsx           # Tabela de regras UFW
│   ├── RuleForm.tsx            # Formulário nova regra
│   └── FirewallStatus.tsx      # Status on/off UFW
│
├── docker/
│   ├── ContainerCard.tsx       # Card de container
│   ├── ContainerLogs.tsx       # Visualizador de logs
│   ├── ImageList.tsx           # Lista de imagens
│   ├── VolumeList.tsx          # Lista de volumes
│   ├── NetworkList.tsx         # Lista de redes
│   └── ComposeManager.tsx      # Gestão docker compose
│
├── databases/
│   ├── DbStatusCard.tsx        # Card de status do banco
│   ├── InstallButton.tsx       # Botão de instalar (se ausente)
│   ├── DatabaseList.tsx        # Lista de bancos
│   └── UserList.tsx            # Lista de usuários do banco
│
├── security/
│   ├── Fail2banStatus.tsx      # Status fail2ban
│   ├── JailTable.tsx           # Tabela de jails
│   └── SshConfigForm.tsx       # Form SSH config
│
├── ai/
│   ├── AiModal.tsx             # Modal da IA (Ctrl+5)
│   ├── AiChat.tsx              # Chat interface
│   ├── AiMessage.tsx           # Bolha de mensagem
│   ├── CommandApproval.tsx     # Aprovação de comando sugerido
│   └── ScriptViewer.tsx        # Visualizador de shell script da IA
│
└── settings/
    ├── SettingsForm.tsx         # Form de configurações
    ├── LanguageSelector.tsx     # Seletor de idioma
    └── ApiKeyInput.tsx          # Input de chave API (com máscara)
```

## 4. Gerenciamento de Estado

### 4.1 Contextos React

```typescript
// lib/contexts/
├── AuthContext.tsx       # { user, token, login(), logout(), isAuthenticated }
├── I18nContext.tsx       # { t, locale, setLocale, locales }
├── ThemeContext.tsx      # { theme, toggleTheme }
└── ToastContext.tsx      # { showToast(message, type) }
```

### 4.2 Custom Hooks

```typescript
// lib/hooks/
├── useApi.ts             # Hook genérico: useApi<T>(url, options) → { data, loading, error, refetch }
├── useSystemStats.ts     # Polling 5s: useSystemStats() → { stats }
├── useCpuHistory.ts      # useCpuHistory(date?) → { history }
├── useProcesses.ts       # useProcesses(filters) → { processes }
├── useKeyboard.ts        # useKeyboard(shortcut, callback) → void
├── useFileBrowser.ts     # useFileBrowser(initialPath) → { items, navigate, ... }
├── useDocker.ts          # useDocker() → { containers, images, volumes, networks }
├── useAiChat.ts          # useAiChat() → { messages, send, streaming }
└── useConfirm.ts         # useConfirm() → { confirm(message) → Promise<boolean> }
```

## 5. Design System (Tailwind)

### 5.1 Paleta de Cores

```
┌─────────────────────────────────────┐
│  Tema Escuro (padrão)               │
│                                     │
│  bg-primary:    #0f172a (slate-900) │
│  bg-secondary:  #1e293b (slate-800) │
│  bg-card:       #1e293b             │
│  text-primary:  #f8fafc (slate-50)  │
│  text-muted:    #94a3b8 (slate-400) │
│  accent:        #3b82f6 (blue-500)  │
│  danger:        #ef4444 (red-500)   │
│  success:       #22c55e (green-500) │
│  warning:       #f59e0b (amber-500) │
│  border:        #334155 (slate-700) │
└─────────────────────────────────────┘
```

### 5.2 Tipografia

- Fonte: `Inter` (sans-serif)
- Headings: `font-semibold`, tracking tight
- Mono: `JetBrains Mono` para código, paths, comandos

### 5.3 Componentes de Layout

- **Sidebar**: 240px fixa, colapsável para 64px (ícones)
- **Header**: 56px altura, breadcrumb + ações
- **Cards**: border-radius 8px, shadow sutil, padding 16px

## 6. Roteamento e Navegação

### 6.1 Estrutura do Sidebar

```
📊 Dashboard        → /
📈 Monitor          → /monitor
📁 Arquivos         → /files
⚙️ Tarefas          → /tasks
🌐 NGINX            → /nginx
🛡️ Firewall         → /firewall
🐳 Docker           → /docker
🗄️ Bancos de Dados   → /databases
   ├── MySQL        → /databases/mysql
   ├── PostgreSQL   → /databases/postgresql
   └── MongoDB      → /databases/mongodb
🔒 Segurança        → /security
   ├── fail2ban     → /security/fail2ban
   └── SSH          → /security/ssh
⚙️ Configurações    → /settings
```

### 6.2 Proteção de Rotas

O `AuthContext` em `_app.tsx` verifica autenticação. Se não autenticado, redireciona para tela de login (overlay, não rota separada).

## 7. Performance e Otimizações

- **Polling inteligente**: 5s para stats, 2s para processos (apenas se aba ativa)
- **Virtualização**: `react-window` para listas longas (processos, arquivos)
- **Lazy loading**: `next/dynamic` para módulos pesados (editor de arquivos, gráficos)
- **Memória de arquivos**: Cache de último diretório visitado no file manager
- **Debounce** em filtros e buscas (300ms)

## 8. Acessibilidade

- Suporte a navegação por teclado (Tab, Enter, Escape)
- Shortcuts documentados:
  - `Ctrl+5` / `Cmd+5` → Abrir IA Modal
  - `Del` → Confirmar kill do processo selecionado
  - `Ctrl+S` → Salvar no editor de arquivos
  - `Escape` → Fechar modais
- Labels aria em todos os inputs e botões
- Contraste WCAG AA no tema escuro
