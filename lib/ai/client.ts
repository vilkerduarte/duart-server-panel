import OpenAI from 'openai';

/**
 * Creates a DeepSeek-compatible OpenAI client.
 * DeepSeek uses the OpenAI-compatible API endpoint.
 */
export function createDeepSeekClient(apiKey: string): OpenAI {
  return new OpenAI({
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: apiKey,
  });
}

/**
 * Builds the system prompt with server context for the AI.
 */
export function buildSystemPrompt(systemInfo: {
  hostname: string;
  distro: string;
  kernel: string;
  arch: string;
  uptime: string;
}): string {
  return `Você é um assistente especializado em administração de servidores Linux,
integrado ao Duart Panel.

Contexto do servidor:
- Sistema Operacional: ${systemInfo.distro}
- Kernel: ${systemInfo.kernel}
- Arquitetura: ${systemInfo.arch}
- Hostname: ${systemInfo.hostname}
- Uptime: ${systemInfo.uptime}

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

Seja conciso e técnico. Priorize soluções práticas e seguras. Responda sempre em português.`;
}
