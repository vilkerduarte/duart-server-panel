import { useState, useEffect, useRef } from 'react';
import { HiOutlinePaperAirplane, HiOutlineXMark, HiOutlineTrash } from 'react-icons/hi2';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface AiModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AiModal({ open, onClose }: AiModalProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: 'Olá! Sou o assistente IA do Duart Panel. Como posso ajudar com a administração do seu servidor?', timestamp: new Date().toISOString() }
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '5') {
        e.preventDefault();
        if (!open) onClose(); // toggle behavior handled by parent
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    const userMsg: Message = { role: 'user', content: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);

    // Simulate streaming response
    const response = await simulateAIResponse(input);
    const aiMsg: Message = { role: 'assistant', content: response, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, aiMsg]);
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-[80vh] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col animate-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">🤖 Assistente IA</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setMessages([messages[0]])} className="p-1 text-[var(--text-muted)] hover:text-red-400"><HiOutlineTrash className="w-4 h-4" /></button>
            <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><HiOutlineXMark className="w-5 h-5" /></button>
          </div>
        </div>

        <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]'
              }`}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-[var(--text-muted)]'}`}>
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="bg-[var(--bg-secondary)] rounded-lg px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-color)]">
                <span className="animate-pulse-dot">●</span> Digitando...
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-[var(--border-color)]">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite sua mensagem..."
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              rows={2}
              disabled={streaming}
            />
            <button
              onClick={handleSend}
              disabled={streaming || !input.trim()}
              className="self-end p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <HiOutlinePaperAirplane className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-2">Ctrl+5 para abrir/fechar</p>
        </div>
      </div>
    </div>
  );
}

async function simulateAIResponse(prompt: string): Promise<string> {
  // Simulate delay
  await new Promise(r => setTimeout(r, 800 + Math.random() * 1500));

  const responses = [
    `Para verificar o status do NGINX, use: \`\`\`command\nsystemctl status nginx\n\`\`\``,
    `Você pode listar os containers Docker ativos com: \`\`\`command\ndocker ps\n\`\`\``,
    `Para verificar o uso de disco: \`\`\`command\ndf -h\n\`\`\``,
    `O UFW pode ser gerenciado pelo painel em Firewall. Para ver as regras atuais: \`\`\`command\nufw status verbose\n\`\`\``,
    `Para monitorar processos em tempo real, use o Gerenciador de Tarefas no painel.`,
  ];

  if (prompt.toLowerCase().includes('nginx')) return responses[0];
  if (prompt.toLowerCase().includes('docker')) return responses[1];
  if (prompt.toLowerCase().includes('disco') || prompt.toLowerCase().includes('disk')) return responses[2];
  if (prompt.toLowerCase().includes('firewall') || prompt.toLowerCase().includes('ufw')) return responses[3];
  if (prompt.toLowerCase().includes('processo') || prompt.toLowerCase().includes('process')) return responses[4];

  return `Entendi! "${prompt}" — estou aqui para ajudar com administração de servidores Linux. Você pode me perguntar sobre NGINX, Docker, firewall, processos, logs e muito mais.`;
}
