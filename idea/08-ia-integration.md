# Duart Panel — Integração com Inteligência Artificial

## 1. Visão Geral

O Duart Panel integra um assistente de IA acessível via atalho `Ctrl+5` (ou `Cmd+5` no Mac) que abre um modal de chat. A IA utiliza o modelo **DeepSeek** através do **OpenAI SDK** (compatível com o endpoint da DeepSeek), operando em **modo streaming**.

## 2. Fluxo de Interação

```
┌──────────────────────────────────────────────────────┐
│                 USUÁRIO (Browser)                     │
│                                                      │
│  1. Pressiona Ctrl+5 / Cmd+5                        │
│  2. Modal abre (overlay)                             │
│  3. Digita mensagem                                  │
│  4. Resposta chega em streaming (SSE)                │
│  5. IA pode sugerir comandos consultivos             │
│     └─ Usuário aprova/rejeita                        │
│  6. IA pode gerar shell script                       │
│     └─ Usuário revisa → botão "Executar"             │
│                                                      │
└──────────────────────┬───────────────────────────────┘
                       │ POST /api/ai/chat (SSE)
                       ▼
┌──────────────────────────────────────────────────────┐
│              Next.js API Route                        │
│                                                      │
│  1. Valida sessão                                    │
│  2. Carrega API key de data/settings/config.json     │
│     └─ Se ausente: retorna erro "API key missing"   │
│  3. Envia mensagens para DeepSeek (OpenAI SDK)       │
│  4. Faz stream da resposta via SSE                   │
│                                                      │
└──────────────────────┬───────────────────────────────┘
                       │ OpenAI SDK (streaming)
                       ▼
┌──────────────────────────────────────────────────────┐
│              DeepSeek API                             │
│  Endpoint: https://api.deepseek.com/v1               │
│  Modelo: deepseek-chat                               │
│  Streaming: true                                     │
└──────────────────────────────────────────────────────┘
```

## 3. Especificação Técnica

### 3.1 Configuração do OpenAI SDK

```typescript
// lib/ai/client.ts (conceitual)
import OpenAI from 'openai';

export function createDeepSeekClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: apiKey,
  });
}
```

### 3.2 System Prompt

O system prompt da IA deve dar contexto sobre o ambiente:

```typescript
const SYSTEM_PROMPT = `Você é um assistente especializado em administração de servidores Linux, 
integrado ao Duart Panel.

Contexto do servidor:
- Sistema Operacional: {distro} {version}
- Kernel: {kernel}
- Hostname: {hostname}
- Uptime: {uptime}

Você pode:
1. Responder perguntas sobre Linux, NGINX, Docker, bancos de dados, firewall, etc.
2. Sugerir comandos para diagnóstico (que o usuário pode aprovar e executar)
3. Gerar shell scripts completos para automação

Quando sugerir comandos, use o formato:
\`\`\`command
comando aqui
\`\`\`

Quando gerar scripts, use:
\`\`\`shellscript
#!/bin/bash
# script completo aqui
\`\`\`

Seja conciso e técnico. Priorize soluções práticas e seguras.`;
```

### 3.3 API Route: `POST /api/ai/chat`

```typescript
// pages/api/ai/chat.ts (conceitual)
import type { NextApiRequest, NextApiResponse } from 'next';
import { createDeepSeekClient } from '@/lib/ai/client';
import { authMiddleware } from '@/lib/middleware/auth';
import { readConfig } from '@/lib/data/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth
  await authMiddleware(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Método não permitido' });
    }

    const { messages } = req.body;

    // Carregar API key
    const config = await readConfig();
    if (!config.aiApiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key não configurada. Configure em Configurações.',
        code: 'MISSING_API_KEY'
      });
    }

    // Configurar SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Desabilitar buffer do NGINX

    const client = createDeepSeekClient(config.aiApiKey);

    try {
      // Obter contexto do sistema
      const systemInfo = await getSystemInfoForAI();
      const systemPrompt = buildSystemPrompt(systemInfo);

      const stream = await client.chat.completions.create({
        model: config.aiModel || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        stream: true,
        max_tokens: 4096,
        temperature: 0.7,
      });

      // Stream chunks
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (error: any) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        content: error.message || 'Erro na comunicação com a IA'
      })}\n\n`);
      res.end();
    }
  });
}
```

### 3.4 Detecção de Comandos no Frontend

O frontend analisa a resposta da IA para detectar blocos de código:

```typescript
// lib/ai/parser.ts (conceitual)

interface ParsedContent {
  type: 'text' | 'command' | 'shellscript';
  content: string;
}

export function parseAIResponse(text: string): ParsedContent[] {
  const parts: ParsedContent[] = [];
  const regex = /```(command|shellscript)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Texto antes do bloco
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }

    const lang = match[1] || 'command';
    const code = match[2].trim();

    parts.push({
      type: lang === 'shellscript' ? 'shellscript' : 'command',
      content: code,
    });

    lastIndex = match.index + match[0].length;
  }

  // Texto restante
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts;
}
```

## 4. Aprovação de Comandos

### 4.1 Fluxo

1. IA sugere comando em bloco ` ```command ` 
2. Frontend detecta e renderiza com botão **"Executar Comando"**
3. Ao clicar, abre modal de confirmação:
   - Exibe o comando completo
   - Checkbox: **"Sempre permitir este tipo de comando"**
4. Usuário aprova → `POST /api/ai/execute-command`
5. Backend valida comando contra whitelist
6. Se permitido → executa → retorna resultado
7. Resultado é exibido no chat como mensagem do sistema

### 4.2 API: `POST /api/ai/execute-command`

```typescript
// Request
{
  command: string,         // ex: "df -h"
  approved: boolean,       // deve ser true
  alwaysAllow?: boolean    // salva na whitelist pessoal
}

// Response 200
{
  success: true,
  data: {
    stdout: string,
    stderr: string,
    code: number,
    duration: number // ms
  }
}

// Response 403
{
  success: false,
  error: "Comando não aprovado ou fora da whitelist"
}
```

### 4.3 Whitelist de Comandos para IA

```typescript
// Comandos permitidos para a IA sugerir/executar
const AI_COMMAND_WHITELIST = [
  // Leitura de sistema
  'ps', 'top', 'htop', 'free', 'df', 'du', 'ls', 'cat', 'head', 'tail',
  'grep', 'find', 'which', 'whereis', 'stat', 'file', 'lsof', 'netstat',
  'ss', 'ip', 'ifconfig', 'ping', 'traceroute', 'nslookup', 'dig', 'curl',
  'wget', 'uptime', 'uname', 'hostname', 'whoami', 'id', 'groups',
  
  // Serviços (somente status)
  'systemctl status *', 'journalctl *', 'service * status',
  
  // NGINX (leitura)
  'nginx -t', 'nginx -T',
  
  // Docker (leitura)
  'docker ps', 'docker images', 'docker logs', 'docker inspect',
  'docker volume ls', 'docker network ls',
  
  // Pacotes
  'apt list', 'apt-cache search', 'dpkg -l', 'snap list',
  
  // Firewall (leitura)
  'ufw status', 'ufw show',
  
  // Diversos
  'date', 'timedatectl', 'locale',
];

// Comandos PROIBIDOS (mesmo se usuário aprovar)
const AI_COMMAND_BLOCKLIST = [
  'rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:', // fork bomb
  'chmod 777 /', 'chown -R', '> /dev/sda',
];
```

## 5. Geração e Execução de Scripts

### 5.1 Fluxo

1. IA gera script em bloco ` ```shellscript `
2. Frontend renderiza com:
   - Syntax highlighting (bash)
   - Botão **"Revisar e Executar"**
   - Linhas numeradas
3. Ao clicar, abre modal **Script Viewer**:
   - Código completo com scroll
   - Botões: "Cancelar", "Baixar .sh", "Executar"
   - Aviso de segurança: "Revise cuidadosamente antes de executar"
4. Ao executar: `POST /api/ai/execute-script`
   - Backend salva script em `data/scripts/temp_TIMESTAMP.sh`
   - Executa com `bash script.sh`
   - Retorna stdout + stderr + exit code
   - Remove script temporário

### 5.2 API: `POST /api/ai/execute-script`

```typescript
// Request
{
  script: string,     // conteúdo completo do script
  approved: boolean,
}

// Response 200
{
  success: true,
  data: {
    stdout: string,
    stderr: string,
    exitCode: number,
    duration: number,
  }
}
```

## 6. Componentes do Frontend

### 6.1 AiModal (`components/ai/AiModal.tsx`)

- Overlay full-screen ou large modal (80vw x 80vh)
- Header: "Assistente IA" + botão fechar (Escape)
- Body: Chat área
- Footer: Input + botão enviar
- Atalho: `Ctrl+5` / `Cmd+5` → toggle

### 6.2 AiChat (`components/ai/AiChat.tsx`)

- Lista de mensagens com auto-scroll
- Indicador de "digitando..." (3 dots animados)
- Renderização de código com syntax highlight
- Botões de ação inline para comandos e scripts

### 6.3 AiMessage (`components/ai/AiMessage.tsx`)

- Bolha do usuário (direita, accent)
- Bolha da IA (esquerda, bg-card)
- Blocos de comando: fundo escuro, ícone terminal, botão executar
- Blocos de script: header "Shell Script" + botão revisar
- Timestamp em cada mensagem

### 6.4 CommandApproval (`components/ai/CommandApproval.tsx`)

- Modal de confirmação
- Exibe: comando formatado
- Checkbox: "Sempre permitir comandos como este"
- Botões: Cancelar / Executar

### 6.5 ScriptViewer (`components/ai/ScriptViewer.tsx`)

- Modal maior (90vw x 90vh)
- Código com syntax highlighting (bash)
- Linhas numeradas
- Botões: Cancelar / Baixar .sh / Executar
- Output area (aparece após execução)

## 7. Tratamento de Erros

| Cenário | Comportamento |
|---------|---------------|
| API key não configurada | Modal mostra input para configurar chave |
| API key inválida | Mensagem de erro: "API key inválida. Verifique em Configurações." |
| Rate limit DeepSeek | Mensagem: "Limite de requisições atingido. Aguarde X segundos." |
| Timeout (120s) | Mensagem: "Resposta demorou muito. Tente novamente." |
| Streaming interrompido | Mensagem parcial exibida + botão "Tentar novamente" |
| Comando bloqueado | Mensagem: "Este comando não é permitido por segurança." |

## 8. Segurança da Integração IA

- API key armazenada apenas no servidor (`data/settings/config.json`, permissão 640)
- Nunca exposta ao frontend (mascarada como `••••••••abcd`)
- Comandos passam por dupla validação: frontend (aprovação usuário) + backend (whitelist)
- Scripts são executados em sandbox implícita (usuário do painel, sem root)
- Bloqueio de padrões perigosos (fork bombs, wipe disk, etc.)
- Log de todos os comandos executados via IA em `data/logs/ai-commands.log`
