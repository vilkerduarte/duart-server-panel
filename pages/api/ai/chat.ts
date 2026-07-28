import type { NextApiRequest, NextApiResponse } from 'next';
import { authMiddleware, AuthenticatedRequest } from '@/lib/middleware/auth';
import { readConfig } from '@/lib/data/config';
import { createDeepSeekClient, buildSystemPrompt } from '@/lib/ai/client';
import { executeRaw } from '@/lib/system';

export default authMiddleware(async (req: AuthenticatedRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { messages, model: requestedModel } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: 'Mensagens são obrigatórias' });
  }

  try {
    const config = readConfig();

    if (!config.aiApiKey) {
      return res.status(400).json({
        success: false,
        error: 'API key não configurada. Configure em Configurações.',
      });
    }

    // Get system info for context
    let systemInfo = {
      hostname: 'unknown',
      distro: 'Linux',
      kernel: 'unknown',
      arch: 'x86_64',
      uptime: 'unknown',
    };

    try {
      const hostnameResult = await executeRaw('hostname', 3000);
      systemInfo.hostname = hostnameResult.stdout || 'unknown';

      const osResult = await executeRaw('cat /etc/os-release 2>/dev/null | head -1', 3000);
      systemInfo.distro = osResult.stdout?.replace('PRETTY_NAME=', '').replace(/"/g, '') || 'Linux';

      const kernelResult = await executeRaw('uname -r', 3000);
      systemInfo.kernel = kernelResult.stdout || 'unknown';

      const archResult = await executeRaw('uname -m', 3000);
      systemInfo.arch = archResult.stdout || 'x86_64';

      const uptimeResult = await executeRaw('uptime -p 2>/dev/null || cat /proc/uptime', 3000);
      systemInfo.uptime = uptimeResult.stdout?.replace('up ', '') || 'unknown';
    } catch {}

    const systemPrompt = buildSystemPrompt(systemInfo);
    const model = requestedModel || config.aiModel || 'deepseek-chat';

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const client = createDeepSeekClient(config.aiApiKey);

    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages,
        ],
        stream: true,
        max_tokens: 4096,
        temperature: 0.7,
      });

      let fullContent = '';

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        const content = delta?.content || '';

        if (content) {
          fullContent += content;
          res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
        }
      }

      // Send done event with full content for parsing
      res.write(`data: ${JSON.stringify({ type: 'done', fullContent })}\n\n`);
      res.end();

    } catch (streamError: any) {
      const errorMsg = streamError.message || 'Erro na comunicação com a IA';

      if (errorMsg.includes('401') || errorMsg.includes('403') || errorMsg.includes('authentication')) {
        res.write(`data: ${JSON.stringify({ type: 'error', content: 'API key inválida. Verifique em Configurações.' })}\n\n`);
      } else if (errorMsg.includes('429') || errorMsg.includes('rate')) {
        res.write(`data: ${JSON.stringify({ type: 'error', content: 'Limite de requisições atingido. Aguarde alguns segundos.' })}\n\n`);
      } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
        res.write(`data: ${JSON.stringify({ type: 'error', content: 'Timeout na conexão com a IA. Tente novamente.' })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', content: errorMsg })}\n\n`);
      }
      res.end();
    }
  } catch (err: any) {
    // If headers not sent yet, return JSON error
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: err.message });
    }
    // Otherwise try to send SSE error
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
      res.end();
    } catch {}
  }
});
