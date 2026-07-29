import { useState, useEffect, useRef, useCallback } from 'react';
import { HiOutlinePaperAirplane, HiOutlineXMark, HiOutlineTrash, HiOutlinePlay, HiOutlineShieldCheck, HiOutlineSparkles } from 'react-icons/hi2';
import Spinner from '@/components/ui/Spinner';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface PendingCommand {
  command: string;
  description: string;
}

interface AiModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AiModal({ open, onClose }: AiModalProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Olá! Sou o assistente IA do Duart Panel, especializado em administração de servidores Linux. Posso ajudar com diagnóstico, configuração, e monitoramento do seu servidor. O que você precisa?',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef('');

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  // Stream real response from the API
  const handleSend = async () => {
    if (!input.trim() || streaming) return;

    const userMsg: Message = { role: 'user', content: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    streamingContentRef.current = '';

    // Add a placeholder for the streaming response
    const placeholderIndex = messages.length + 1;

    try {
      const resp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: input },
          ],
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }));
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `❌ Erro: ${err.error || 'Falha na comunicação'}`,
          timestamp: new Date().toISOString(),
        }]);
        setStreaming(false);
        return;
      }

      const reader = resp.body?.getReader();
      if (!reader) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '❌ Erro: Resposta inválida do servidor',
          timestamp: new Date().toISOString(),
        }]);
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'chunk') {
                streamingContentRef.current += data.content;
                // Update or add the assistant message
                setMessages(prev => {
                  const copy = [...prev];
                  const lastIdx = copy.length - 1;
                  if (copy[lastIdx]?.role === 'assistant' && copy[lastIdx]?.content && !copy[lastIdx]?.content.startsWith('❌')) {
                    // Update existing streaming message
                    copy[lastIdx] = { ...copy[lastIdx], content: streamingContentRef.current };
                  } else {
                    // Add new streaming message
                    copy.push({
                      role: 'assistant',
                      content: streamingContentRef.current,
                      timestamp: new Date().toISOString(),
                    });
                  }
                  return copy;
                });
              } else if (data.type === 'done') {
                // Finalize with the full content
                const finalContent = data.fullContent || streamingContentRef.current;
                setMessages(prev => {
                  const copy = [...prev];
                  const lastIdx = copy.length - 1;
                  if (copy[lastIdx]?.role === 'assistant') {
                    copy[lastIdx] = { ...copy[lastIdx], content: finalContent };
                  }
                  return copy;
                });

                // Check for command blocks in the response
                checkForCommands(finalContent);
              } else if (data.type === 'error') {
                setMessages(prev => [...prev, {
                  role: 'assistant',
                  content: `❌ ${data.content}`,
                  timestamp: new Date().toISOString(),
                }]);
              }
            } catch {}
          }
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ Erro de conexão: ${err.message}`,
        timestamp: new Date().toISOString(),
      }]);
    }

    setStreaming(false);
  };

  // Check for command blocks and ask for approval
  const checkForCommands = (content: string) => {
    const cmdRegex = /```command\s*\n([\s\S]*?)```/g;
    const matches = [...content.matchAll(cmdRegex)];
    if (matches.length > 0) {
      const lastCmd = matches[matches.length - 1][1].trim();
      if (lastCmd) {
        setPendingCommand({
          command: lastCmd,
          description: 'A IA sugere executar este comando no servidor. Deseja aprovar?',
        });
      }
    }
  };

  // Execute approved command
  const executeApprovedCommand = async () => {
    if (!pendingCommand) return;

    try {
      const resp = await fetch('/api/ai/execute-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: pendingCommand.command, approved: true }),
      });
      const result = await resp.json();

      if (result.success) {
        const output = result.data.stdout || result.data.stderr || '';
        setMessages(prev => [...prev, {
          role: 'system',
          content: `✅ Comando executado (${result.data.duration}ms):\n\`\`\`\n${output || '(sem saída)'}\n\`\`\``,
          timestamp: new Date().toISOString(),
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'system',
          content: `❌ Erro ao executar: ${result.error}`,
          timestamp: new Date().toISOString(),
        }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `❌ Erro: ${err.message}`,
        timestamp: new Date().toISOString(),
      }]);
    }

    setPendingCommand(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-[85vh] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] shrink-0">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <HiOutlineSparkles className="w-5 h-5 text-blue-400" />
            Assistente IA
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMessages([messages[0]])}
              className="p-1 text-[var(--text-muted)] hover:text-red-400"
              title="Limpar conversa"
            >
              <HiOutlineTrash className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <HiOutlineXMark className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : msg.role === 'system'
                    ? 'bg-amber-600/20 text-amber-300 border border-amber-500/30'
                    : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]'
                }`}
              >
                <MarkdownContent content={msg.content} />
                <div className={`text-xs mt-2 ${
                  msg.role === 'user'
                    ? 'text-blue-200'
                    : msg.role === 'system'
                    ? 'text-amber-400'
                    : 'text-[var(--text-muted)]'
                }`}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}

          {streaming && (
            <div className="flex justify-start">
              <div className="bg-[var(--bg-secondary)] rounded-lg px-4 py-3 text-sm text-[var(--text-muted)] border border-[var(--border-color)] flex items-center gap-2">
                <Spinner size="sm" /> Processando...
              </div>
            </div>
          )}
        </div>

        {/* Pending Command Approval */}
        {pendingCommand && (
          <div className="mx-4 p-3 bg-amber-600/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <HiOutlineShieldCheck className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-amber-300 font-medium">Aprovação Necessária</span>
            </div>
            <pre className="text-xs font-mono text-amber-200 bg-black/30 p-2 rounded mb-2 overflow-x-auto">
              {pendingCommand.command}
            </pre>
            <p className="text-xs text-amber-400/70 mb-2">{pendingCommand.description}</p>
            <div className="flex gap-2">
              <button
                onClick={executeApprovedCommand}
                className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-500 flex items-center gap-1"
              >
                <HiOutlinePlay className="w-3 h-3" /> Executar
              </button>
              <button
                onClick={() => setPendingCommand(null)}
                className="px-3 py-1.5 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)]"
              >
                Recusar
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="p-4 border-t border-[var(--border-color)] shrink-0">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem... (Shift+Enter para nova linha)"
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)] min-h-[44px]"
              rows={2}
              disabled={streaming}
            />
            <button
              onClick={handleSend}
              disabled={streaming || !input.trim()}
              className="self-end p-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <HiOutlinePaperAirplane className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            A IA pode sugerir comandos CLI que precisam da sua aprovação antes de executar.
          </p>
        </div>
      </div>
    </div>
  );
}

// Simple markdown renderer with code highlighting support
function MarkdownContent({ content }: { content: string }) {
  if (!content) return null;

  // Render code blocks with ```language ... ```
  const parts: React.ReactNode[] = [];
  const regex = /```(\w*)\s*\n([\s\S]*?)```|`([^`]+)`|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(~~([^~]+)~~)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(content)) !== null) {
    // Text before match
    if (match.index > lastIdx) {
      const beforeText = content.slice(lastIdx, match.index);
      parts.push(<span key={key++}>{renderInlineHtml(beforeText)}</span>);
    }

    if (match[1] !== undefined) {
      // Code block: ```lang\ncode```
      const lang = match[1] || '';
      const code = match[2];
      parts.push(
        <div key={key++} className="my-2 rounded-lg overflow-hidden border border-[var(--border-color)]">
          {lang && (
            <div className="px-3 py-1 bg-[var(--bg-hover)] text-xs text-[var(--text-muted)] font-mono">
              {lang}
            </div>
          )}
          <pre className="p-3 text-xs font-mono text-[var(--text-secondary)] bg-black/30 overflow-x-auto whitespace-pre-wrap">
            {code}
          </pre>
        </div>
      );
    } else if (match[3] !== undefined) {
      // Inline code
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 text-xs font-mono bg-black/30 text-[var(--text-secondary)] rounded">
          {match[3]}
        </code>
      );
    } else if (match[5] !== undefined || match[7] !== undefined) {
      // Bold
      parts.push(<strong key={key++} className="font-bold">{match[5] || match[7]}</strong>);
    } else if (match[9] !== undefined || match[11] !== undefined) {
      // Italic
      parts.push(<em key={key++} className="italic">{match[9] || match[11]}</em>);
    } else if (match[13] !== undefined) {
      // Strikethrough
      parts.push(<del key={key++} className="line-through">{match[13]}</del>);
    }

    lastIdx = match.index + match[0].length;
  }

  // Remaining text
  if (lastIdx < content.length) {
    parts.push(<span key={key++}>{renderInlineHtml(content.slice(lastIdx))}</span>);
  }

  return <div className="whitespace-pre-wrap break-words">{parts.length > 0 ? parts : content}</div>;
}

// Render inline HTML (tables, etc.) if the content starts with HTML tags
function renderInlineHtml(text: string): React.ReactNode {
  // If text contains HTML table tags, render as raw HTML
  if (/<(table|thead|tbody|tr|th|td|div|span|br|hr|ul|ol|li|h[1-6]|p|blockquote)/i.test(text)) {
    return <div dangerouslySetInnerHTML={{ __html: text }} />;
  }

  // Handle line breaks and basic formatting
  return text.split('\n').map((line, i, arr) => (
    <span key={i}>
      {line}
      {i < arr.length - 1 && <br />}
    </span>
  ));
}
