# Duart Panel — Referência da API

## Autenticação

Todas as rotas (exceto `/api/auth/login`, `/api/auth/setup`) requerem autenticação via cookie `token` (HttpOnly) ou header `Authorization: Bearer <token>`.

### POST /api/auth/login

```json
// Request
{ "username": "admin", "password": "minha-senha" }

// Response 200
{ "success": true, "data": { "token": "...", "user": { "id": "...", "username": "admin", "role": "admin" } } }

// Response 401
{ "success": false, "error": "Credenciais inválidas" }
```

### POST /api/auth/setup

Criação do primeiro administrador (apenas se `users.json` não existir).

```json
// Request
{ "username": "admin", "password": "minha-senha" }

// Response 200
{ "success": true, "data": { "token": "...", "user": { "id": "...", "username": "admin", "role": "admin" } } }
```

### POST /api/auth/logout

```json
// Response 200
{ "success": true }
```

### GET /api/auth/check

```json
// Response 200
{ "success": true, "data": { "user": { "id": "...", "username": "admin", "role": "admin" } } }

// Response 200 (setup required)
{ "success": false, "code": "SETUP_REQUIRED" }
```

---

## Sistema / Monitoramento

### GET /api/system/stats

```json
// Response 200
{
  "success": true,
  "data": {
    "cpu": { "percent": 23.5, "cores": 8, "model": "Intel(R) Core(TM)..." },
    "memory": { "total": 17179869184, "used": 8589934592, "free": 8589934592, "percent": 50 },
    "disk": [{ "mount": "/", "total": 107374182400, "used": 53687091200, "free": 53687091200, "percent": 50 }],
    "uptime": 86400,
    "load": { "1m": 0.45, "5m": 0.32, "15m": 0.28 },
    "os": { "hostname": "srv-01", "distro": "Ubuntu 25.10", "kernel": "6.17.0", "arch": "x64" }
  }
}
```

### GET /api/system/cpu-history?date=YYYY-MM-DD

```json
// Response 200
{
  "success": true,
  "data": [
    { "timestamp": "2026-07-28T01:00:05Z", "cpu": 23.5, "load1": 0.45, "load5": 0.32, "load15": 0.28 }
  ]
}
```

### GET /api/system/processes?sort=cpu&limit=50&search=nginx

```json
// Response 200
{
  "success": true,
  "data": [
    { "pid": 1234, "user": "root", "cpu": 2.5, "mem": 0.8, "state": "S", "time": "0:15", "command": "nginx -g daemon off" }
  ]
}
```

### POST /api/system/process

```json
// Request
{ "pid": 1234, "signal": "SIGTERM" }

// Response 200
{ "success": true, "data": { "killed": true, "pid": 1234 } }
```

---

## NGINX Manager

### GET /api/nginx/sites

```json
// Response 200
{
  "success": true,
  "data": [
    { "id": "...", "domain": "meusite.com", "type": "static", "root": "/var/www/meusite", "enabled": true, "ssl": false }
  ]
}
```

### POST /api/nginx/sites

```json
// Request
{ "domain": "meusite.com", "type": "static", "root": "/var/www/meusite" }

// Response 200
{ "success": true, "data": { "site": { ... }, "nginxReloaded": true } }
```

### DELETE /api/nginx/sites?id=...

```json
// Response 200
{ "success": true, "data": { "deleted": true, "nginxReloaded": true } }
```

---

## Firewall (UFW)

### GET /api/firewall/rules

```json
// Response 200
{
  "success": true,
  "data": {
    "status": "active",
    "defaultIncoming": "deny",
    "defaultOutgoing": "allow",
    "rules": [{ "number": "1", "action": "allow", "details": "22/tcp" }]
  }
}
```

### POST /api/firewall/rules

```json
// Request
{ "action": "allow", "port": "8080", "proto": "tcp" }

// Response 200
{ "success": true, "data": { "added": true } }
```

---

## Docker Manager

### GET /api/docker/containers

```json
// Response 200
{
  "success": true,
  "data": [
    { "ID": "abc123", "Names": "nginx", "Image": "nginx:latest", "State": "running", "Status": "Up 2 hours", "Ports": "0.0.0.0:80->80/tcp" }
  ]
}
```

### POST /api/docker/container

```json
// Request
{ "id": "abc123", "action": "restart" }

// Response 200
{ "success": true, "data": { "action": "restart", "containerId": "abc123" } }
```

---

## Segurança

### GET /api/security/fail2ban

```json
// Response 200
{
  "success": true,
  "data": {
    "installed": true,
    "running": true,
    "jails": [{ "name": "sshd", "enabled": true, "banned": 3, "found": 12 }]
  }
}
```

### GET /api/security/ssh-config

```json
// Response 200
{
  "success": true,
  "data": { "Port": "22", "PermitRootLogin": "prohibit-password", "PasswordAuthentication": "yes" }
}
```

---

## Configurações

### GET /api/settings/config

```json
// Response 200
{
  "success": true,
  "data": {
    "serverName": "Duart Panel",
    "language": "pt-BR",
    "theme": "dark",
    "aiApiKey": "••••••••abcd"
  }
}
```

### PUT /api/settings/config

```json
// Request
{ "theme": "light", "language": "en-US" }

// Response 200
{ "success": true, "data": { ... } }
```

---

## IA

### POST /api/ai/chat

Testa a conectividade com a API DeepSeek.

```json
// Response 200
{ "success": true, "data": { "connected": true } }
```

### POST /api/ai/execute-command

```json
// Request
{ "command": "df -h", "approved": true }

// Response 200
{ "success": true, "data": { "stdout": "...", "stderr": "", "code": 0, "duration": 150 } }
```

---

## Códigos de Status

| Código | Significado |
|--------|-------------|
| 200 | Sucesso |
| 400 | Parâmetros inválidos |
| 401 | Não autenticado |
| 403 | Não autorizado / comando bloqueado |
| 404 | Recurso não encontrado |
| 405 | Método não permitido |
| 408 | Timeout do comando |
| 409 | Conflito (domínio duplicado) |
| 429 | Rate limit / lockout de login |
| 500 | Erro interno |
