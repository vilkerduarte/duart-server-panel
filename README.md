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
| 5 | **NGINX Manager** | Sites estáticos, PHP, proxy, Python e Node · IPv6 · rate limit · manutenção · escrita transacional com rollback |
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
| 16 | **PHP** | Detecção e instalação de versões, pool FPM dedicado por site, limites e diagnóstico de 502 |
| 17 | **Python** | venv, gunicorn e unidade systemd por aplicação, com reload gracioso |
| 18 | **IA Assistant** | Agente com ferramentas (`Ctrl+5`): três modos de aprovação, diff antes de gravar, journal auditável |
| 19 | **Configurações** | Hostname, idioma (PT/EN/ES), tema dark/light, API key |
| 20 | **i18n** | Português (padrão), Inglês, Espanhol |

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

- Node.js 22 pelo **apt (NodeSource)** — o binário fica em `/usr/bin`, então o serviço volta sozinho depois de um reboot
- Instalação e ativação do **NGINX**, com os snippets compartilhados (TLS, gzip, proxy, ACME)
- **UFW** liberando 22, 80, 443 e 587
- Porta interna aleatória (10000–60000), reaproveitada em reexecuções
- Estrutura em `/var/lib/duart-panel/`
- `npm ci` + `next build` (o build precisa das devDependencies)
- vhost do NGINX com **backup datado** e rollback automático se o `nginx -t` reprovar
- Serviço **systemd** `duart-panel` (habilitado no boot)
- **TLS** por Let's Encrypt, com renovação a cargo do `certbot.timer` e deploy-hook que recarrega o NGINX
- Instalação do `duart-recover` em `/usr/local/sbin`

O script é idempotente: reexecutar repara o que estiver faltando e preserva
domínio, porta, configuração e o bloco TLS já existente.

Argumentos úteis para automação:

```bash
sudo bash scripts/install.sh --domain painel.exemplo.com --email admin@exemplo.com --yes
sudo bash scripts/install.sh --skip-ssl    # instala sem tentar emitir certificado
```

> **Já tem o painel instalado?** Não rode a instalação direto: siga o
> [guia de migração](MIGRACAO.md), que faz backup, adequa o estado em disco e
> lista o que muda de comportamento.

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
│      Next.js Server (systemd — porta aleatória)       │
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
│   ├── ai/                     # Agente: ferramentas, sessões, journal, rede de segurança
│   ├── contexts/               # Auth, I18n, Theme, Toast
│   ├── hooks/                  # useApi, useKeyboard, usePhpVersions
│   ├── middleware/             # Auth + verificação de origem
│   ├── auth.ts                 # Autenticação e sessões
│   ├── system.ts               # Execução sem shell (execFile) + whitelist
│   ├── nginx.ts                # Geração e leitura de vhost
│   ├── nginx-ops.ts            # Escrita transacional com rollback
│   ├── sites.ts                # Serviço de sites (usado pela API e pela IA)
│   ├── ssl.ts                  # Metadados de certificado lidos do disco
│   ├── certificates.ts         # Registro de certificados
│   ├── php.ts                  # Versões, pools FPM, diagnóstico
│   ├── python.ts               # venv, gunicorn, unidades systemd
│   ├── db.ts                   # Acesso a banco sem shell
│   ├── paths.ts                # Jaula do gerenciador de arquivos
│   ├── fsx.ts                  # Escrita atômica e serializada
│   ├── cron.ts                 # Leitura e escrita de agendamentos reais
│   └── diff.ts                 # Diff unificado (pré-visualização da IA)
├── languages/                  # i18n (pt-BR, en-US, es-ES)
├── scripts/                    # Scripts do sistema
│   ├── install.sh              # Instalação completa
│   ├── setup-ssl.sh            # Configurar SSL (Let's Encrypt)
│   ├── remove-ssl.sh           # Remover SSL
│   ├── recover.sh              # Modo de recuperação (instalado como duart-recover)
│   ├── register-cert.js        # Registra certificado no painel (merge, não sobrescreve)
│   ├── check-ssl.js            # Auditoria de validade real dos certificados
│   └── rotate-logs.js          # Rotação de logs
├── tests/                      # Testes das funções puras (vitest)

/var/lib/duart-panel/           # Dados persistentes
├── auth/                       # Usuários e chave JWT
├── cpu-history/                # Histórico CPU (1 arquivo/dia)
├── nginx/                      # Registro de sites
├── ssl/                        # Registro de certificados
├── cron/                       # Jobs customizados
├── backups/                    # Arquivos .tar.gz
├── settings/                   # config.json
├── ai/                         # Conversas e journal de auditoria da IA
├── python/                     # Registro de aplicações e arquivos de ambiente
└── logs/                       # Logs do painel
```

---

## Comandos Úteis

| Comando | Descrição |
|---------|-----------|
| `systemctl status duart-panel` | Estado do painel |
| `journalctl -u duart-panel -f` | Logs em tempo real |
| `systemctl restart duart-panel` | Reiniciar o painel |
| `sudo duart-recover` | Recuperação (NGINX quebrado ou painel fora do ar) |
| `sudo duart-recover --diagnose` | Só diagnostica, sem alterar nada |
| `sudo duart-recover --restore` | Restaura os vhosts do último backup |
| `npm run ssl:check` | Auditoria de validade dos certificados |
| `npm test` | Testes das funções puras |
| `sudo nginx -t` | Testar a configuração do NGINX |

---

## Stack Tecnológica

| Camada | Tecnologia |
|--------|-----------|
| **Frontend** | React 19, Next.js 16 (Pages Router), Tailwind CSS 4, Recharts, react-icons |
| **Renderização** | Next.js Server (SSR + API Routes, Turbopack no build) |
| **Backend** | Next.js API Routes, Node.js 22 (NodeSource) |
| **IA** | Endpoint compatível com a API OpenAI (DeepSeek por padrão), com function calling |
| **Supervisão** | systemd (painel e apps Python) · PM2 opcional para apps Node |
| **Testes** | vitest (funções puras: gerador NGINX, jaula, escape de SQL, cron, diff) |
| **Proxy Reverso** | NGINX (proxy total → `http://127.0.0.1:PORT`) |
| **Persistência** | File-based (JSON, .conf, .txt) — sem banco de dados |

---

## Segurança

- JWT em cookie `HttpOnly`, `SameSite=Strict` e `Secure` quando há HTTPS
- Versionamento de token: trocar a senha invalida as sessões abertas
- Verificação de origem em todos os métodos que alteram estado
- Limite de tentativas de login por usuário **e** por IP
- Senhas com bcrypt (12 rounds)
- Execução de comandos por `execFile` com array de argumentos — sem shell, sem injeção
- Whitelist de comandos com padrões específicos por argumento, sem curingas
- Segredos de banco nunca vão pela linha de comando (não aparecem em `ps aux`)
- Gerenciador de arquivos com raízes permitidas e lista de negação, resolvendo symlinks
- Escrita de estado atômica (`rename`) e serializada, com backup da última versão íntegra
- Chave de API da IA mascarada na interface
- Toda ação da IA registrada em journal (quem, quando, o quê, resultado, diff)

**Ainda não implementado:** o painel roda como `root`. Um usuário dedicado com
`sudoers` restrito reduziria bastante o impacto de qualquer falha — é a próxima
mudança estrutural de segurança.

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
