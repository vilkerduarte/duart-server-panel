# Duart Panel — Especificação dos Módulos Funcionais

## Módulo 1: Dashboard

### Propósito
Visão geral do servidor com métricas em tempo real.

### Componentes Visuais
- **Cards de métricas**: CPU%, RAM usada/total, Disco usado/total, Uptime
- **Mini gráfico de CPU**: Últimos 60 minutos (linha sparkline)
- **Informações do sistema**: Hostname, distro, kernel, arquitetura
- **Lista de processos top 5**: Por uso de CPU
- **Status dos serviços**: NGINX, Docker, UFW, fail2ban (online/offline)

### Comportamento
- Polling a cada 5 segundos via `GET /api/system/stats`
- Métricas animadas com transições suaves (CSS transition)
- Indicador visual de thresholds: verde (< 60%), amarelo (60-80%), vermelho (> 80%)

---

## Módulo 2: Monitor de Recursos

### Propósito
Visualização detalhada e histórica de CPU, memória e disco.

### Seções

#### 2.1 CPU
- Gráfico de área/linha mostrando histórico do dia atual (Recharts)
- Seletor de data para ver dias anteriores
- Métricas: CPU%, Load Average (1m, 5m, 15m)
- Dados do arquivo: `data/cpu-history/YYYY-MM-DD.txt`
- Intervalo de polling: 5 segundos (appende ao gráfico em tempo real)

#### 2.2 Memória
- Barra de progresso: RAM usada / total
- Detalhes: Buffers, Cache, Swap usado
- Mini gráfico de tendência (últimos 30 min, em memória no frontend)

#### 2.3 Armazenamento
- Tabela de partições: mountpoint, filesystem, total, usado, livre, uso%
- Barras de progresso por partição
- Alertas para partições > 90%

### Fonte de Dados
- CPU: `/proc/stat` (cálculo delta entre leituras)
- Memória: `/proc/meminfo`
- Disco: `df -h` com parsing

---

## Módulo 3: Gerenciador de Arquivos

### Propósito
File manager completo com navegação, edição e gerenciamento de permissões.

### Funcionalidades

#### 3.1 Navegação
- Breadcrumb clicável: `/home/user/docs`
- Tabela de arquivos: Ícone, Nome, Tamanho, Tipo, Permissões, Dono, Modificado
- Ordenação por coluna (clique no cabeçalho)
- Filtro de busca por nome (debounced 300ms)
- Paginação / virtual scroll para diretórios grandes
- Duplo clique para abrir diretório
- Botão "Voltar" e "Home"

#### 3.2 Operações em Arquivos
- **Upload**: Arrastar e soltar ou botão; múltiplos arquivos; barra de progresso
- **Download**: Arquivo único ou múltiplos como .zip (via API)
- **Criar**: Novo arquivo de texto ou novo diretório
- **Editar**: Editor de texto inline com syntax highlighting básico
- **Renomear**: F2 ou botão direito > Renomear
- **Excluir**: Com confirmação (arquivo ou diretório recursivo)
- **Permissões**: Modal com checkboxes para rwx owner/group/other + chmod numérico
- **Copiar/Cortar/Colar**: Clipboard interno entre diretórios
- **Menu de contexto**: Botão direito com opções relevantes

#### 3.3 Segurança
- Path traversal protection (não permitir navegar acima de `/` ou fora de paths permitidos)
- Confirmação para exclusão de diretórios não vazios
- Bloqueio de paths sensíveis: `/sys`, `/proc`, `/dev` (somente leitura opcional)

---

## Módulo 4: Gerenciador de Tarefas

### Propósito
Visão acessível do comando `top` com capacidade de gerenciar processos.

### Funcionalidades

#### 4.1 Visualização
- Tabela similar ao `htop`: PID, Usuário, CPU%, MEM%, Tempo, Comando
- Ordenação por qualquer coluna
- Barra de busca/filtro por nome de processo
- Seleção de processo (clique na linha) → destaque
- Auto-refresh a cada 2 segundos (configurável, pausável)

#### 4.2 Ações
- **`Del` key**: Se um processo estiver selecionado, abre modal de confirmação
  - Mostra: PID, nome, CPU%, MEM%
  - Botões: "Cancelar", "SIGTERM" (padrão), "SIGKILL" (forçar)
- **Duplo clique**: Abre modal com detalhes completos:
  - Linha de comando completa
  - Diretório de trabalho (`/proc/<pid>/cwd`)
  - Environment variables
  - File descriptors abertos
  - Threads

#### 4.3 Proteções
- Não permitir kill de PID 1 (init/systemd)
- Não permitir kill do próprio processo do painel
- Confirmação explícita antes de qualquer kill

---

## Módulo 5: NGINX Manager

### Propósito
Gerenciar sites/blocos de servidor NGINX.

### Funcionalidades

#### 5.1 Listagem de Sites
- Cards ou tabela com: Domínio, Tipo (static/php/proxy), Status (enabled/disabled), Porta/Proxy
- Badge verde/vermelho: enabled/disabled
- Ações: Editar, Habilitar/Desabilitar, Excluir

#### 5.2 Criação de Site

**Tipo: Estático**
```
Domínio: meusite.com
Root path: /var/www/meusite
```

**Tipo: PHP**
```
Domínio: meusite.com
Root path: /var/www/meusite
PHP-FPM socket: (auto-detect / configurável)
```

**Tipo: Proxy Reverso**
```
Domínio: api.meusite.com
Porta alvo: 3001        (localhost)
WebSocket Upgrade: ☑    (adiciona headers Upgrade, Connection)
HTTPS: ☐ (futuro)
Custom location: (opcional)
```

#### 5.3 Template NGINX Gerado

**Estático:**
```nginx
server {
    listen 80;
    server_name {domain};
    root {root};
    index index.html index.htm;
    
    location / {
        try_files $uri $uri/ =404;
    }
    
    access_log /var/log/nginx/{domain}.access.log;
    error_log /var/log/nginx/{domain}.error.log;
}
```

**PHP:**
```nginx
server {
    listen 80;
    server_name {domain};
    root {root};
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php{version}-fpm.sock;
    }

    access_log /var/log/nginx/{domain}.access.log;
    error_log /var/log/nginx/{domain}.error.log;
}
```

**Proxy Reverso (com WebSocket opcional):**
```nginx
server {
    listen 80;
    server_name {domain};

    location / {
        proxy_pass http://localhost:{port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;       # ← se websocket=true
        proxy_set_header Connection "upgrade";         # ← se websocket=true
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;                      # ← se websocket=true
    }
}
```

#### 5.4 Ciclo de Vida
1. Formulário preenchido no painel → `POST /api/nginx/sites`
2. Backend gera arquivo `.conf` em `/etc/nginx/sites-available/`
3. Cria symlink em `/etc/nginx/sites-enabled/`
4. Executa `nginx -t` para validar
5. Se OK → `nginx -s reload`
6. Se erro → retorna stderr, reverte arquivo, não cria symlink

#### 5.5 Exclusão
1. Remove symlink de `sites-enabled/`
2. Remove arquivo de `sites-available/`
3. `nginx -s reload`

#### 5.6 Registro Local
- `data/nginx/sites.json`: mantém metadata (id, domain, type, createdAt, etc.)
- Útil para reconstrução ou auditoria

---

## Módulo 6: Firewall (UFW)

### Propósito
Gerenciamento simplificado do UFW (Uncomplicated Firewall).

### Funcionalidades

#### 6.1 Status Geral
- Indicador: UFW ativo/inativo
- Toggle: Ativar/Desativar (com confirmação)
- Políticas padrão: Incoming (deny), Outgoing (allow)

#### 6.2 Regras
- Tabela de regras numeradas
- Adicionar regra:
  - Ação: Allow / Deny / Reject / Limit
  - Porta: número ou range (ex: `8080:8085`)
  - Protocolo: TCP / UDP / Any
  - Origem: IP/Range ou Anywhere
- Remover regra (por número)
- Portas padrão sugeridas: 22, 80, 443, 587

#### 6.3 Perfis de Aplicação
- Listar perfis: `ufw app list`
- Info do perfil: `ufw app info <name>`
- Adicionar regra por perfil

#### 6.4 Logs UFW
- Visualizar `/var/log/ufw.log` (últimas 100 linhas)
- Filtrar por: BLOCK, ALLOW

---

## Módulo 7: Docker Manager

### Propósito
Gestão intuitiva de containers, imagens, volumes e redes Docker.

### Funcionalidades

#### 7.1 Visão Geral
- Total de containers: running / stopped / paused
- Total de imagens
- Total de volumes
- Total de redes com containers conectados

#### 7.2 Containers
- Lista com: Nome, Imagem, Status, Portas, CPU%, RAM, Rede I/O
- Ações por container:
  - Start, Stop, Restart, Pause, Unpause
  - Remove (com opção force)
  - View Logs (últimas 200 linhas, auto-scroll, tail)
  - Inspect (JSON formatado)
  - Terminal (futuro, via WebSocket + docker exec -it)
- Criar container: formulário avançado
  - Imagem (com search/pull)
  - Nome, Portas (host:container), Volumes (host:container), Env vars, Restart policy
  - Network mode (bridge, host, custom)

#### 7.3 Imagens
- Lista: Repository, Tag, Size, Created
- Pull: campo de texto + botão (ex: `nginx:latest`)
- Remove: com confirmação
- Prune: remover imagens não utilizadas
- Build (futuro): apontar para Dockerfile

#### 7.4 Volumes
- Lista: Name, Driver, Mountpoint
- Criar: nome + driver (opcional)
- Remove: com confirmação (não permite se em uso)
- Prune: remover volumes não utilizados

#### 7.5 Redes
- Lista: Name, Driver, Scope, Containers conectados
- Criar: nome + driver (bridge/overlay/host) + subnet/gateway (opcionais)
- Remove: com confirmação (não permite se em uso)

#### 7.6 Docker Compose
- Listar projetos em execução: `docker compose ls`
- Ações por projeto (informar path):
  - Up, Down, Restart, Pull, Logs
- Indicar arquivo compose alternativo: `-f`

---

## Módulo 8: Bancos de Dados

### Propósito
Instalação sob demanda e gestão básica de MySQL, PostgreSQL e MongoDB.

### Funcionalidades Comuns

#### 8.1 Tela Inicial (antes de instalar)
- Card informativo: "MySQL não está instalado"
- Botão: **"Instalar MySQL"**
  - Ao clicar: confirmação → `POST /api/databases/mysql/install`
  - Backend executa: `apt-get install -y mysql-server`
  - Progresso: streaming ou polling de status
  - Ao final: mostra versão e status

#### 8.2 Tela Pós-Instalação
- Status do serviço: running / stopped
- Versão instalada
- Controles: Start, Stop, Restart
- Lista de bancos de dados
- Gerenciamento de usuários

#### 8.3 MySQL Específico
```
Instalação: mysql-server (apt)
Porta padrão: 3306
Socket: /var/run/mysqld/mysqld.sock
```
- Criar/remover database
- Criar/remover usuário com host e privilégios
- Alterar senha de usuário
- (Futuro) Query editor básico

#### 8.4 PostgreSQL Específico
```
Instalação: postgresql (apt)
Porta padrão: 5432
```
- Criar/remover database
- Criar/remover role (usuário)
- Alterar senha

#### 8.5 MongoDB Específico
```
Instalação: mongod (via repositório oficial)
Porta padrão: 27017
```
- Criar/remover database
- Criar/remover usuário
- (MongoDB pode requerer adição de repositório no apt)

---

## Módulo 9: Segurança

### Propósito
Gestão de fail2ban e configuração SSH.

### 9.1 fail2ban

#### Status
- Instalado? Sim/Não → botão Instalar
- Rodando? Sim/Não → Start/Stop
- Jails configuradas

#### Jails Gerenciáveis
- `sshd` — proteção SSH
- `nginx-http-auth` — proteção auth básica NGINX
- `nginx-botsearch` — proteção contra bots

#### Ações por Jail
- Enable / Disable
- Status: currently banned IPs
- Ban IP manualmente: `fail2ban-client set <jail> banip <ip>`
- Unban IP: `fail2ban-client set <jail> unbanip <ip>`

#### Logs
- Visualizar `/var/log/fail2ban.log`
- Filtrar por jail

### 9.2 SSH Configuration

#### Leitura e Edição
- Arquivo: `/etc/ssh/sshd_config`
- Campos editáveis:
  - `Port` (padrão: 22)
  - `PermitRootLogin` (yes/no/prohibit-password)
  - `PasswordAuthentication` (yes/no)
  - `PubkeyAuthentication` (yes/no)
- Botão: **Aplicar** → grava arquivo → `systemctl reload sshd`
- Validação: `sshd -t` antes de aplicar

---

## Módulo 10: Configurações

### Propósito
Configurações globais do painel e do servidor.

### Seções

#### 10.1 Aparência e Idioma
- Nome do servidor (exibido no header e title)
- Idioma: Português, Inglês, Espanhol
- Tema: Dark (padrão) / Light

#### 10.2 Hostname
- Campo: hostname atual do sistema
- Botão: Alterar → `hostnamectl set-hostname`
- Requer confirmação

#### 10.3 Integração IA
- Campo: API Key (DeepSeek) — mascarada, com toggle de visibilidade
- Modelo: `deepseek-chat` (fixo ou selecionável)
- Testar conexão: botão "Testar" → `GET /api/ai/test`

#### 10.4 Usuário
- Alterar senha do painel
- (Futuro) Múltiplos usuários

#### 10.5 Manutenção
- Reiniciar painel (PM2 restart)
- Ver logs do painel (últimas 200 linhas de `data/logs/panel.log`)
- Versão do painel
