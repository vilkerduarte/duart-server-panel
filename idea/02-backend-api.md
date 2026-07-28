# Duart Panel — Especificação das API Routes

## 1. Convenções de API

### 1.1 Formato de Resposta Padrão

```typescript
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
}
```

### 1.2 Headers Comuns

```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

### 1.3 Middleware de Auth

Toda rota (exceto `auth/login`) passa pelo middleware `lib/middleware/auth.ts` que:
1. Lê o cookie `token` (HttpOnly, Secure em produção)
2. Verifica/decodifica o JWT
3. Se inválido/expirado → `401 Unauthorized`
4. Se válido → injeta `req.user` com `{ id, username, role }`

---

## 2. Endpoints Detalhados

### 2.1 Autenticação

#### `POST /api/auth/login`
```typescript
// Request
{ username: string; password: string }

// Response 200
{ success: true, data: { token: string, user: { id, username, role } } }
// Set-Cookie: token=JWT; HttpOnly; SameSite=Strict; Path=/

// Response 401
{ success: false, error: "Credenciais inválidas" }
```

#### `POST /api/auth/logout`
```typescript
// Response 200
{ success: true }
// Set-Cookie: token=; Max-Age=0
```

#### `GET /api/auth/check`
```typescript
// Response 200
{ success: true, data: { user: { id, username, role } } }

// Response 401
{ success: false, error: "Não autenticado" }
```

---

### 2.2 Sistema / Monitoramento

#### `GET /api/system/stats`
Retorna estatísticas atuais do sistema. **Side effect**: grava CPU no arquivo de histórico.

```typescript
// Response 200
{
  success: true,
  data: {
    cpu: { percent: number, cores: number, model: string },
    memory: { total: number, used: number, free: number, percent: number }, // bytes
    disk: [{ mount: string, total: number, used: number, free: number, percent: number }],
    uptime: number, // segundos
    load: { "1m": number, "5m": number, "15m": number },
    os: { hostname: string, distro: string, kernel: string, arch: string }
  }
}
```

#### `GET /api/system/cpu-history?date=YYYY-MM-DD`
```typescript
// Query params
{ date?: string } // default: hoje

// Response 200
{
  success: true,
  data: [
    { timestamp: string, cpu: number, load1: number, load5: number, load15: number }
  ]
}
```

#### `GET /api/system/processes?sort=cpu&limit=50`
```typescript
// Query params
{ sort?: "cpu" | "mem" | "pid", limit?: number, search?: string }

// Response 200
{
  success: true,
  data: [
    { pid: number, user: string, cpu: number, mem: number, command: string, state: string }
  ]
}
```

#### `POST /api/system/process`
Mata um processo por PID.

```typescript
// Request
{ pid: number, signal?: "SIGTERM" | "SIGKILL" } // default: SIGTERM

// Response 200
{ success: true, data: { killed: true, pid: number } }

// Response 400
{ success: false, error: "PID inválido ou protegido" }
```

---

### 2.3 Gerenciador de Arquivos

#### `GET /api/files/list?path=/home`
```typescript
// Query: path (default: /), showHidden (default: false)

// Response 200
{
  success: true,
  data: {
    currentPath: string,
    parentPath: string | null,
    items: [
      {
        name: string, type: "file" | "directory" | "symlink",
        size: number, // bytes
        permissions: string, // "drwxr-xr-x"
        owner: string, group: string,
        modifiedAt: string // ISO
      }
    ]
  }
}
```

#### `GET /api/files/read?path=X`
Retorna conteúdo de arquivo (somente texto, max 5MB).

```typescript
// Response 200
{
  success: true,
  data: { path: string, content: string, size: number, encoding: "utf-8" }
}
```

#### `POST /api/files/write`
```typescript
// Request
{ path: string, content: string }

// Response 200
{ success: true, data: { written: true, path: string } }
```

#### `POST /api/files/upload`
Multipart form-data. Campo: `file` + `path` (destino).

```typescript
// Response 200
{ success: true, data: { uploaded: true, path: string, size: number } }
```

#### `DELETE /api/files/delete`
```typescript
// Request
{ path: string, recursive?: boolean }

// Response 200
{ success: true, data: { deleted: true } }
```

#### `POST /api/files/mkdir`
```typescript
// Request
{ path: string }

// Response 200
{ success: true, data: { created: true, path: string } }
```

#### `PUT /api/files/rename`
```typescript
// Request
{ oldPath: string, newPath: string }

// Response 200
{ success: true, data: { renamed: true } }
```

#### `PUT /api/files/permissions`
```typescript
// Request
{ path: string, mode: string } // octal string: "755"

// Response 200
{ success: true, data: { changed: true } }
```

---

### 2.4 NGINX Manager

#### `GET /api/nginx/sites`
Lista todos os sites gerenciados.

```typescript
// Response 200
{
  success: true,
  data: [
    {
      id: string,
      domain: string,
      type: "static" | "php" | "proxy",
      root?: string,
      proxyPort?: number,
      proxyUrl?: string,
      websocket: boolean,
      ssl: false,
      enabled: boolean,
      configPath: string
    }
  ]
}
```

#### `POST /api/nginx/sites`
Cria um novo site.

```typescript
// Request
{
  domain: string,                        // ex: "meusite.com"
  type: "static" | "php" | "proxy",
  root?: string,                         // path para static/php
  proxyPort?: number,                    // porta para proxy reverse
  proxyUrl?: string,                     // URL completa alternativa
  websocket?: boolean,                   // só para type=proxy
  phpVersion?: string                    // "8.3" default
}

// Response 200
{ success: true, data: { site: { id, domain, ... }, nginxReloaded: true } }

// Response 400
{ success: false, error: "Domínio já existe" }
```

#### `PUT /api/nginx/sites?id=X`
Editar site existente.

```typescript
// Request (parcial, merge com existente)
{ domain?: string, root?: string, proxyPort?: number, ... }

// Response 200
{ success: true, data: { updated: true, nginxReloaded: true } }
```

#### `DELETE /api/nginx/sites?id=X`
Remove site.

```typescript
// Response 200
{ success: true, data: { deleted: true, nginxReloaded: true } }
```

#### `POST /api/nginx/reload`
Recarrega configuração do NGINX.

```typescript
// Response 200
{ success: true, data: { reloaded: true } }

// Response 400
{ success: false, error: "nginx -t falhou: <stderr>" }
```

---

### 2.5 Firewall (UFW)

#### `GET /api/firewall/rules`
```typescript
// Response 200
{
  success: true,
  data: {
    status: "active" | "inactive",
    defaultIncoming: "deny" | "allow" | "reject",
    defaultOutgoing: "deny" | "allow" | "reject",
    rules: [
      { to: string, action: string, from: string, port: string, proto: string }
    ]
  }
}
```

#### `POST /api/firewall/rules`
```typescript
// Request
{
  action: "allow" | "deny" | "reject" | "limit",
  port: string,       // "80" ou "80/tcp" ou "8080:8085/tcp"
  from?: string,      // IP, default: "any"
  proto?: "tcp" | "udp" | "any"
}

// Response 200
{ success: true, data: { added: true } }
```

#### `DELETE /api/firewall/rules`
```typescript
// Request
{ ruleNumber: number }

// Response 200
{ success: true, data: { deleted: true } }
```

#### `POST /api/firewall/toggle`
```typescript
// Request
{ enable: boolean }

// Response 200
{ success: true, data: { status: "active" | "inactive" } }
```

---

### 2.6 Docker Manager

#### `GET /api/docker/containers?all=true`
```typescript
// Response 200
{
  success: true,
  data: [
    {
      id: string, name: string, image: string,
      status: string, state: "running" | "exited" | "paused",
      ports: string, created: string,
      cpu: number, memory: number, networkIO: string
    }
  ]
}
```

#### `POST /api/docker/container`
Ações em container: start, stop, restart, pause, unpause, remove.

```typescript
// Request
{ id: string, action: "start" | "stop" | "restart" | "pause" | "unpause" | "remove" }

// Response 200
{ success: true, data: { action: string, containerId: string, result: string } }
```

#### `GET /api/docker/images`
```typescript
// Response 200
{
  success: true,
  data: [
    { id: string, repository: string, tag: string, size: number, created: string }
  ]
}
```

#### `POST /api/docker/images`
Pull de imagem.

```typescript
// Request
{ image: string } // "nginx:latest"

// Response 200
{ success: true, data: { pulled: true, image: string } }
```

#### `DELETE /api/docker/images`
```typescript
// Request
{ id: string, force?: boolean }

// Response 200
{ success: true, data: { deleted: true } }
```

#### `GET /api/docker/volumes`
Lista volumes Docker.

#### `POST /api/docker/volumes`
Cria volume.

#### `DELETE /api/docker/volumes`
Remove volume.

#### `GET /api/docker/networks`
Lista redes Docker.

#### `POST /api/docker/networks`
Cria rede.

#### `DELETE /api/docker/networks`
Remove rede.

#### `POST /api/docker/compose`
Operações docker compose (up, down, ps, logs) em um path específico.

```typescript
// Request
{ path: string, action: "up" | "down" | "restart" | "ps" | "logs" }

// Response 200
{ success: true, data: { result: string } }
```

---

### 2.7 Bancos de Dados

#### `GET /api/databases/:type`
Onde `:type` = `mysql` | `postgresql` | `mongodb`.

```typescript
// Response 200
{
  success: true,
  data: {
    installed: boolean,
    version?: string,
    running?: boolean,
    port?: number,
    dataDir?: string,
    databases?: string[],
    users?: string[]
  }
}
```

#### `POST /api/databases/:type/install`
Instala o binário via `apt` / `apt-get`.

```typescript
// Request (opcional)
{ version?: string }

// Response 200 (streaming opcional)
{ success: true, data: { installed: true, version: string, serviceStarted: true } }

// Response 400
{ success: false, error: "Já está instalado" }
```

#### `POST /api/databases/:type/database`
Cria/remove banco de dados.

```typescript
// Request
{ action: "create" | "drop", name: string }

// Response 200
{ success: true, data: { created: true, name: string } }
```

#### `POST /api/databases/:type/user`
Gerencia usuários do banco.

```typescript
// Request
{ action: "create" | "drop" | "password", username: string, password?: string }

// Response 200
{ success: true }
```

---

### 2.8 Segurança

#### `GET /api/security/fail2ban`
```typescript
// Response 200
{
  success: true,
  data: {
    installed: boolean,
    running: boolean,
    jails: [
      { name: string, enabled: boolean, banned: number, found: number }
    ]
  }
}
```

#### `POST /api/security/fail2ban/jail`
```typescript
// Request
{ jail: "sshd" | "nginx-http-auth" | "nginx-botsearch", action: "enable" | "disable" | "ban" | "unban", ip?: string }

// Response 200
{ success: true }
```

#### `POST /api/security/fail2ban/install`
Instala fail2ban via apt.

#### `GET /api/security/fail2ban/logs?jail=sshd`
Busca logs do fail2ban.

#### `GET /api/security/ssh-config`
Lê configuração SSH (`/etc/ssh/sshd_config` parseado).

#### `PUT /api/security/ssh-config`
Atualiza `/etc/ssh/sshd_config` (parâmetros permitidos: `Port`, `PermitRootLogin`, `PasswordAuthentication`, `PubkeyAuthentication`).

---

### 2.9 Configurações

#### `GET /api/settings/config`
```typescript
// Response 200
{ success: true, data: { serverName, hostname, language, aiApiKey: "••••••••", theme, ... } }
```

#### `PUT /api/settings/config`
```typescript
// Request (merge parcial)
{ serverName?: string, language?: string, aiApiKey?: string, theme?: string }

// Response 200
{ success: true, data: { updated: true } }
```

#### `PUT /api/settings/hostname`
```typescript
// Request
{ hostname: string }

// Response 200
{ success: true, data: { hostname: string } }
// Requer sudo; executa `hostnamectl set-hostname`
```

---

### 2.10 IA (Inteligência Artificial)

#### `POST /api/ai/chat`
**Streaming** via Server-Sent Events (SSE).

```typescript
// Request
{
  messages: [
    { role: "system" | "user" | "assistant", content: string }
  ],
  model?: string // default do config
}

// Response: text/event-stream (SSE)
data: {"type":"chunk","content":"Olá"}

data: {"type":"chunk","content":"! Como"}

data: {"type":"chunk","content":" posso ajudar?"}

data: {"type":"done"}

data: {"type":"error","content":"API key inválida"}
```

#### `POST /api/ai/execute-command`
Permite à IA sugerir comandos e ao usuário aprová-los.

```typescript
// Request
{ command: string, approved: boolean, alwaysAllow?: boolean }

// Response 200
{ success: true, data: { stdout: string, stderr: string, code: number } }

// Response 403
{ success: false, error: "Comando não aprovado pelo usuário" }
```

---

## 3. Tratamento de Erros por Categoria

| Código | Significado |
|--------|-------------|
| 200 | Sucesso |
| 400 | Parâmetros inválidos |
| 401 | Não autenticado |
| 403 | Não autorizado (ex: kill pid 1) |
| 404 | Recurso não encontrado |
| 408 | Timeout do comando |
| 409 | Conflito (ex: domínio duplicado) |
| 500 | Erro interno / comando falhou |

---

## 4. Limites e Timeouts

| Operação | Timeout |
|----------|---------|
| Comandos de leitura (stats, ps, df) | 10s |
| Comandos de escrita (nginx reload, ufw) | 20s |
| Instalação de pacotes (apt) | 300s |
| Upload de arquivos | 120s |
| Pull de imagens Docker | 180s |
| IA chat (streaming) | 120s por mensagem |
