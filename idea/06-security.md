# Duart Panel — Segurança e Autenticação

## 1. Modelo de Autenticação

### 1.1 File-Based Auth

Todo o sistema de autenticação é baseado em arquivos, sem dependência de banco de dados.

```
data/auth/
├── users.json      # Usuários e hashes de senha (permissão 640)
└── .secret         # Chave secreta JWT (permissão 600, 64 bytes aleatórios)
```

### 1.2 Estrutura do `users.json`

```json
{
  "version": 1,
  "users": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "username": "admin",
      "passwordHash": "$2b$12$L3vWqYz8XkJ5mNpR7sTtVuBdFgHiJkLmNoPqRsTuVwXyZaBcDeFg",
      "role": "admin",
      "createdAt": "2026-07-28T00:00:00.000Z",
      "lastLoginAt": "2026-07-28T03:30:00.000Z"
    }
  ],
  "settings": {
    "minPasswordLength": 8,
    "maxLoginAttempts": 5,
    "lockoutDurationMinutes": 15,
    "sessionDurationHours": 24
  }
}
```

### 1.3 Fluxo de Criação de Usuário (Primeiro Acesso)

1. No primeiro acesso (ou se `users.json` não existir), o painel exibe tela de **criação de admin**
2. Usuário define username + password (mín. 8 caracteres)
3. Backend gera `users.json` com bcrypt hash (12 rounds)
4. Gera `.secret` com 64 bytes aleatórios (`crypto.randomBytes(64).toString('hex')`)
5. Cria JWT e redireciona para o dashboard

### 1.4 Fluxo de Login

1. Usuário envia `{ username, password }` para `POST /api/auth/login`
2. Backend lê `users.json`, busca usuário
3. Compara senha com `bcrypt.compare()`
4. Se válido: gera JWT com payload `{ sub: userId, username, role, iat, exp }`
5. Set cookie: `token=JWT; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`
6. Se inválido: incrementa contador de tentativas, retorna 401
7. Se exceder `maxLoginAttempts` (5): bloqueia por `lockoutDurationMinutes` (15 min)

### 1.5 Proteção Contra Brute Force

- Contador de tentativas por username em `data/auth/login_attempts.json`
- Reset do contador após login bem-sucedido ou após expirar lockout
- Estrutura:

```json
{
  "admin": {
    "attempts": 2,
    "lastAttempt": "2026-07-28T03:25:00.000Z",
    "lockedUntil": null
  }
}
```

## 2. Middleware de Autenticação

### 2.1 API Middleware (`lib/middleware/auth.ts`)

```typescript
// Conceitual
export async function authMiddleware(
  req: NextApiRequest,
  res: NextApiResponse,
  next: () => void
) {
  // 1. Extrai token do cookie 'token'
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Não autenticado' });
  }
  
  // 2. Verifica JWT
  try {
    const secret = await readSecret();
    const decoded = jwt.verify(token, secret) as JwtPayload;
    
    // 3. Verifica se usuário ainda existe
    const users = await readUsers();
    const user = users.users.find(u => u.id === decoded.sub);
    
    if (!user) {
      return res.status(401).json({ success: false, error: 'Usuário não encontrado' });
    }
    
    // 4. Injeta no request
    (req as any).user = { id: user.id, username: user.username, role: user.role };
    
    return next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
  }
}
```

### 2.2 CSRF Protection

Como usamos cookies HttpOnly (não acessíveis via JavaScript), o risco de CSRF é reduzido. Medidas adicionais:

- Header `SameSite=Strict` no cookie
- Verificação de `Origin`/`Referer` header nas API routes de escrita
- (Opcional) Token CSRF adicional em header customizado para operações críticas

## 3. Segurança das API Routes

### 3.1 Validação de Input

Todas as API routes devem validar input usando uma lib de schema (ex: `zod`):

```typescript
import { z } from 'zod';

const createSiteSchema = z.object({
  domain: z.string().min(1).max(253),
  type: z.enum(['static', 'php', 'proxy']),
  root: z.string().optional(),
  proxyPort: z.number().int().min(1).max(65535).optional(),
  websocket: z.boolean().optional(),
});

export default async function handler(req, res) {
  const parsed = createSiteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: parsed.error.message });
  }
  // ...
}
```

### 3.2 Proteção de Path Traversal (File Manager)

```typescript
function sanitizePath(userPath: string, basePath: string = '/'): string {
  // 1. Resolve caminho
  const resolved = path.resolve(basePath, userPath);
  
  // 2. Bloqueia acesso a /proc, /sys, /dev (exceto leitura)
  const blockedPrefixes = ['/proc', '/sys', '/dev'];
  for (const prefix of blockedPrefixes) {
    if (resolved === prefix || resolved.startsWith(prefix + '/')) {
      throw new Error('Acesso negado a diretórios de sistema');
    }
  }
  
  // 3. Garante que não escapou do basePath
  if (!resolved.startsWith(basePath)) {
    throw new Error('Path traversal detectado');
  }
  
  return resolved;
}
```

### 3.3 Sanitização de Comandos Shell

```typescript
// Whitelist de comandos permitidos
const COMMAND_WHITELIST: Record<string, {
  bin: string;
  baseArgs: string[];
  allowedArgs: RegExp[];
  sudo: boolean;
}> = {
  nginx_test: {
    bin: 'nginx',
    baseArgs: ['-t'],
    allowedArgs: [/^-[a-zA-Z]$/],
    sudo: false,
  },
  nginx_reload: {
    bin: 'nginx',
    baseArgs: ['-s', 'reload'],
    allowedArgs: [],
    sudo: false,
  },
  ufw_allow: {
    bin: 'ufw',
    baseArgs: ['allow'],
    allowedArgs: [/^\d{1,5}(\/\w+)?$/, /^from\s+\S+$/, /^to\s+\S+$/],
    sudo: true,
  },
  // ...
};

function buildCommand(key: string, extraArgs: string[] = []): {
  command: string;
  sudo: boolean;
} {
  const entry = COMMAND_WHITELIST[key];
  if (!entry) throw new Error(`Comando não permitido: ${key}`);
  
  // Valida extraArgs contra allowedArgs
  for (const arg of extraArgs) {
    const allowed = entry.allowedArgs.some(regex => regex.test(arg));
    if (!allowed) throw new Error(`Argumento não permitido: ${arg}`);
  }
  
  const args = [...entry.baseArgs, ...extraArgs];
  const cmd = [entry.bin, ...args].join(' ');
  
  return {
    command: entry.sudo ? `sudo ${cmd}` : cmd,
    sudo: entry.sudo,
  };
}
```

## 4. Proteção de Dados Sensíveis

### 4.1 Arquivos com Permissões Restritas

| Arquivo | Permissão | Conteúdo |
|---------|-----------|----------|
| `data/auth/users.json` | 640 | Hashes bcrypt |
| `data/auth/.secret` | 600 | Chave JWT |
| `data/auth/login_attempts.json` | 600 | Registro de tentativas |
| `data/settings/config.json` | 640 | API key da IA |

### 4.2 Máscara de API Key no Frontend

- A API key da IA nunca é enviada do backend para o frontend em texto claro
- Endpoint `GET /api/settings/config` retorna `aiApiKey: "••••••••abcd"` (últimos 4 caracteres)
- Para atualizar: `PUT /api/settings/config { aiApiKey: "sk-new-key" }` — enviado diretamente

### 4.3 Logs

- `data/logs/panel.log` NÃO registra senhas ou API keys
- Comandos executados são logados, mas argumentos sensíveis são mascarados

## 5. Hardening do Next.js

### 5.1 Headers de Segurança

Configurar em `next.config.ts` ou via NGINX:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
```

### 5.2 Variáveis de Ambiente

Nenhuma variável de ambiente sensível é usada. Tudo está em arquivos com permissões restritas.

## 6. Recomendações de Produção

1. Rodar o painel com usuário não-root (ex: `duart-panel`) com sudo configurado para comandos específicos via `/etc/sudoers.d/duart-panel`
2. NGINX como proxy reverso na frente (já configurado pelo `install.sh`)
3. Manter o sistema atualizado (`apt update && apt upgrade`)
4. Monitorar `data/logs/panel.log` para atividades suspeitas
5. Fazer backup periódico de `data/` (especialmente `auth/` e `settings/`)

### Sudoers recomendado (`/etc/sudoers.d/duart-panel`):

```
duart-panel ALL=(root) NOPASSWD: /usr/sbin/nginx -t
duart-panel ALL=(root) NOPASSWD: /usr/sbin/nginx -s reload
duart-panel ALL=(root) NOPASSWD: /usr/sbin/ufw *
duart-panel ALL=(root) NOPASSWD: /usr/bin/systemctl start *
duart-panel ALL=(root) NOPASSWD: /usr/bin/systemctl stop *
duart-panel ALL=(root) NOPASSWD: /usr/bin/systemctl restart *
duart-panel ALL=(root) NOPASSWD: /usr/bin/systemctl reload *
duart-panel ALL=(root) NOPASSWD: /usr/bin/systemctl status *
duart-panel ALL=(root) NOPASSWD: /usr/bin/hostnamectl set-hostname *
duart-panel ALL=(root) NOPASSWD: /usr/bin/apt-get install -y *
duart-panel ALL=(root) NOPASSWD: /usr/bin/kill *
```
