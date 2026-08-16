import { useState, useEffect, useRef, useCallback } from 'react';
import {
  HiOutlinePaperAirplane, HiOutlineXMark, HiOutlinePlus, HiOutlineEye,
  HiOutlineShieldCheck, HiOutlineBolt, HiOutlineWrenchScrewdriver,
  HiOutlineCheck, HiOutlineExclamationTriangle, HiOutlineClock, HiOutlineBeaker,
} from 'react-icons/hi2';
import Spinner from '@/components/ui/Spinner';

type Mode = 'read' | 'assisted' | 'autonomous' | 'full';

interface PendingApproval {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string;
  previewType: 'command' | 'diff' | 'text';
  risk: 'write' | 'irreversible';
  summary: string;
}

type Entry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; ok: boolean | null; summary: string }
  | { kind: 'approval'; pending: PendingApproval[]; resolved: boolean }
  | { kind: 'error'; text: string };

/** Envelope dos eventos SSE; o campo `type` decide como ler o resto. */
interface StreamEvent {
  type: string;
  content?: string;
  sessionId?: string;
  title?: string;
  mode?: Mode;
  name?: string;
  summary?: string;
  ok?: boolean;
  pending?: PendingApproval[];
}

interface StoredMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  hasPending: boolean;
}

const MODES: Array<{ value: Mode; label: string; hint: string; icon: typeof HiOutlineEye }> = [
  {
    value: 'read',
    label: 'Leitura',
    hint: 'Só diagnostica. Nenhuma alteração no servidor.',
    icon: HiOutlineEye,
  },
  {
    value: 'assisted',
    label: 'Assistido',
    hint: 'Lê à vontade; cada alteração mostra o efeito e pede sua aprovação.',
    icon: HiOutlineShieldCheck,
  },
  {
    value: 'autonomous',
    label: 'Autônomo',
    hint: 'Executa a tarefa inteira. Só para no que é irreversível.',
    icon: HiOutlineBolt,
  },
  {
    value: 'full',
    label: 'Laboratório',
    hint: 'Execução irrestrita: qualquer comando, qualquer caminho, inclusive o código do painel. Sem aprovação.',
    icon: HiOutlineBeaker,
  },
];

interface AiModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AiModal({ open, onClose }: AiModalProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('assisted');
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  /** O modo laboratório só aparece disponível se estiver liberado na configuração. */
  const [labEnabled, setLabEnabled] = useState(false);

  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [entries]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/sessions');
      const json = await res.json();
      if (json.success) setSessions(json.data);
    } catch {}
  }, []);

  useEffect(() => {
    if (!open) return;
    loadSessions();
    fetch('/api/settings/config')
      .then(res => res.json())
      .then(json => setLabEnabled(Boolean(json?.data?.aiUnrestrictedEnabled)))
      .catch(() => setLabEnabled(false));
  }, [open, loadSessions]);

  /**
   * Consome o stream de eventos do servidor.
   *
   * O mesmo endpoint atende tanto uma mensagem nova quanto a retomada depois de
   * uma aprovação — o servidor guarda o estado da chamada pendente, então basta
   * reenviar as decisões para o laço continuar de onde parou.
   */
  const runStream = useCallback(async (body: Record<string, unknown>) => {
    setStreaming(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sessionId, ...body }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha na comunicação' }));
        setEntries(prev => [...prev, { kind: 'error', text: err.error ?? 'Falha na comunicação' }]);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setEntries(prev => [...prev, { kind: 'error', text: 'Resposta inválida do servidor' }]);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assistantOpen = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          let event: StreamEvent;
          try {
            event = JSON.parse(line.slice(6)) as StreamEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case 'session':
              setSessionId(event.sessionId ?? null);
              break;

            case 'chunk':
              setEntries(prev => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                const chunk = event.content ?? '';
                if (assistantOpen && last?.kind === 'assistant') {
                  copy[copy.length - 1] = { kind: 'assistant', text: last.text + chunk };
                } else {
                  assistantOpen = true;
                  copy.push({ kind: 'assistant', text: chunk });
                }
                return copy;
              });
              break;

            case 'tool_start':
              assistantOpen = false;
              setEntries(prev => [...prev, { kind: 'tool', name: event.name ?? '?', ok: null, summary: event.summary ?? '' }]);
              break;

            case 'tool_result':
              setEntries(prev => {
                const copy = [...prev];
                for (let i = copy.length - 1; i >= 0; i--) {
                  const entry = copy[i];
                  if (entry.kind === 'tool' && entry.name === event.name && entry.ok === null) {
                    copy[i] = { kind: 'tool', name: entry.name, ok: event.ok ?? false, summary: event.summary ?? '' };
                    break;
                  }
                }
                return copy;
              });
              break;

            case 'approval_required':
              assistantOpen = false;
              setEntries(prev => [...prev, { kind: 'approval', pending: event.pending ?? [], resolved: false }]);
              break;

            case 'error':
              setEntries(prev => [...prev, { kind: 'error', text: event.content ?? 'Erro desconhecido' }]);
              break;
          }
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        const message = err instanceof Error ? err.message : 'Erro de conexão';
        setEntries(prev => [...prev, { kind: 'error', text: message }]);
      }
    } finally {
      setStreaming(false);
      loadSessions();
    }
  }, [mode, sessionId, loadSessions]);

  const send = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setEntries(prev => [...prev, { kind: 'user', text }]);
    runStream({ message: text });
  };

  const decide = (index: number, decisions: Array<{ toolCallId: string; approved: boolean }>) => {
    setEntries(prev => {
      const copy = [...prev];
      const entry = copy[index];
      if (entry?.kind === 'approval') copy[index] = { ...entry, resolved: true };
      return copy;
    });
    runStream({ approvals: decisions });
  };

  const newConversation = () => {
    abortRef.current?.abort();
    setSessionId(null);
    setEntries([]);
    setShowSessions(false);
  };

  const openSession = async (id: string) => {
    abortRef.current?.abort();
    const res = await fetch(`/api/ai/sessions/${id}`);
    const json = await res.json();
    if (!json.success) return;

    setSessionId(id);
    setMode(json.data.mode);
    setEntries((json.data.messages as StoredMessage[]).map(message =>
      message.role === 'user'
        ? { kind: 'user' as const, text: message.content }
        : { kind: 'assistant' as const, text: message.content },
    ));
    if (json.data.pending?.length) {
      setEntries(prev => [...prev, { kind: 'approval', pending: json.data.pending, resolved: false }]);
    }
    setShowSessions(false);
  };

  if (!open) return null;

  const activeMode = MODES.find(m => m.value === mode)!;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl h-[85vh] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-color)]">
          <h2 className="text-base font-semibold">Assistente</h2>

          <div className="flex items-center gap-1 ml-2 p-0.5 rounded-lg bg-[var(--bg-hover)]">
            {MODES.map(m => {
              const Icon = m.icon;
              const isLab = m.value === 'full';
              const disabled = isLab && !labEnabled;
              const active = mode === m.value;

              return (
                <button
                  key={m.value}
                  onClick={() => !disabled && setMode(m.value)}
                  disabled={disabled}
                  title={disabled ? 'Ative o modo laboratório em Configurações → IA' : m.hint}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    active
                      // O laboratório usa vermelho de propósito: é o único modo
                      // em que nada pede confirmação.
                      ? (isLab ? 'bg-red-600 text-white' : 'bg-blue-600 text-white')
                      : disabled
                        ? 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setShowSessions(v => !v)}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title="Conversas anteriores"
            >
              <HiOutlineClock className="w-4 h-4" />
            </button>
            <button
              onClick={newConversation}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title="Nova conversa"
            >
              <HiOutlinePlus className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <HiOutlineXMark className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className={`px-5 py-1.5 text-xs border-b border-[var(--border-color)] ${
          mode === 'full' ? 'text-red-400 bg-red-600/5' : 'text-[var(--text-muted)]'
        }`}>
          {mode === 'full' && <strong>Sem confirmação. </strong>}
          {activeMode.hint}
        </p>

        <div className="flex-1 flex overflow-hidden">
          {showSessions && (
            <aside className="w-60 border-r border-[var(--border-color)] overflow-y-auto shrink-0">
              {sessions.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-muted)]">Nenhuma conversa salva.</p>
              ) : sessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => openSession(session.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-[var(--border-color)] hover:bg-[var(--bg-hover)] transition-colors ${
                    session.id === sessionId ? 'bg-[var(--bg-hover)]' : ''
                  }`}
                >
                  <p className="text-xs font-medium truncate">{session.title}</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {new Date(session.updatedAt).toLocaleString('pt-BR')}
                    {session.hasPending && ' · aguardando'}
                  </p>
                </button>
              ))}
            </aside>
          )}

          {/* Conversa */}
          <div ref={chatRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
            {entries.length === 0 && (
              <div className="text-sm text-[var(--text-muted)] max-w-xl">
                <p className="mb-3">
                  Posso inspecionar e operar este servidor: sites, NGINX, certificados, PHP, Python,
                  serviços, logs e firewall.
                </p>
                <p className="mb-2">Alguns exemplos:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>&quot;Por que o site X está dando 502?&quot;</li>
                  <li>&quot;Crie um site PHP para loja.exemplo.com com certificado&quot;</li>
                  <li>&quot;Quais certificados vencem nos próximos 30 dias?&quot;</li>
                  <li>&quot;O NGINX está com erro de sintaxe? Conserte&quot;</li>
                </ul>
              </div>
            )}

            {entries.map((entry, index) => (
              <EntryView
                key={index}
                entry={entry}
                onDecide={decisions => decide(index, decisions)}
                disabled={streaming}
              />
            ))}

            {streaming && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <Spinner /> trabalhando…
              </div>
            )}
          </div>
        </div>

        {/* Entrada */}
        <div className="border-t border-[var(--border-color)] p-3 flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Descreva a tarefa ou o problema…"
            className="flex-1 resize-none px-3 py-2 rounded-lg bg-[var(--input-bg)] border border-[var(--input-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <HiOutlinePaperAirplane className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function EntryView({
  entry, onDecide, disabled,
}: {
  entry: Entry;
  onDecide: (decisions: Array<{ toolCallId: string; approved: boolean }>) => void;
  disabled: boolean;
}) {
  if (entry.kind === 'user') {
    return (
      <div className="self-end max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-sm bg-blue-600 text-white text-sm whitespace-pre-wrap">
        {entry.text}
      </div>
    );
  }

  if (entry.kind === 'assistant') {
    return <div className="max-w-[90%] text-sm"><Markdown text={entry.text} /></div>;
  }

  if (entry.kind === 'error') {
    return (
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-600/10 border border-red-600/30 text-sm text-red-400">
        <HiOutlineExclamationTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        {entry.text}
      </div>
    );
  }

  if (entry.kind === 'tool') {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pl-1">
        {entry.ok === null
          ? <Spinner />
          : entry.ok
            ? <HiOutlineCheck className="w-3.5 h-3.5 text-green-400" />
            : <HiOutlineExclamationTriangle className="w-3.5 h-3.5 text-amber-400" />}
        <HiOutlineWrenchScrewdriver className="w-3.5 h-3.5" />
        <span className="font-mono">{entry.name}</span>
        <span className="truncate">— {entry.summary}</span>
      </div>
    );
  }

  // Aprovação
  const irreversible = entry.pending.some(p => p.risk === 'irreversible');

  return (
    <div className={`rounded-lg border p-3 flex flex-col gap-3 ${
      irreversible ? 'border-red-600/40 bg-red-600/5' : 'border-amber-600/40 bg-amber-600/5'
    }`}>
      <p className="text-xs font-semibold flex items-center gap-1.5">
        <HiOutlineExclamationTriangle className={`w-4 h-4 ${irreversible ? 'text-red-400' : 'text-amber-400'}`} />
        {irreversible
          ? 'Operação irreversível — confirme antes de aplicar'
          : 'Aguardando sua aprovação'}
      </p>

      {entry.pending.map(pending => (
        <div key={pending.toolCallId} className="flex flex-col gap-1.5">
          <p className="text-xs font-medium">{pending.summary}</p>
          <pre className={`text-[11px] font-mono p-2.5 rounded-md overflow-x-auto max-h-64 bg-[var(--bg-hover)] ${
            pending.previewType === 'diff' ? 'leading-tight' : ''
          }`}>
            {pending.previewType === 'diff'
              ? pending.preview.split('\n').map((line, i) => (
                  <div key={i} className={
                    line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400'
                      : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400'
                      : line.startsWith('@@') ? 'text-blue-400'
                      : ''
                  }>{line || ' '}</div>
                ))
              : pending.preview}
          </pre>
        </div>
      ))}

      {!entry.resolved && (
        <div className="flex gap-2">
          <button
            disabled={disabled}
            onClick={() => onDecide(entry.pending.map(p => ({ toolCallId: p.toolCallId, approved: true })))}
            className="px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium disabled:opacity-40"
          >
            Aprovar {entry.pending.length > 1 ? `(${entry.pending.length})` : ''}
          </button>
          <button
            disabled={disabled}
            onClick={() => onDecide(entry.pending.map(p => ({ toolCallId: p.toolCallId, approved: false })))}
            className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-xs font-medium disabled:opacity-40"
          >
            Recusar
          </button>
        </div>
      )}
      {entry.resolved && <p className="text-xs text-[var(--text-muted)]">Decisão registrada.</p>}
    </div>
  );
}

/**
 * Renderizador de markdown mínimo.
 * Cobre o que o modelo realmente usa (blocos de código, código inline, negrito,
 * listas) sem trazer uma dependência nem injetar HTML do modelo na página.
 */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);

  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => {
        if (index % 2 === 1) {
          const newline = block.indexOf('\n');
          const code = newline === -1 ? block : block.slice(newline + 1);
          return (
            <pre key={index} className="text-[11px] font-mono p-2.5 rounded-md bg-[var(--bg-hover)] overflow-x-auto">
              {code.replace(/\n$/, '')}
            </pre>
          );
        }

        return (
          <div key={index} className="whitespace-pre-wrap leading-relaxed">
            {block.split('\n').map((line, lineIndex) => (
              <div key={lineIndex}>{inline(line)}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function inline(line: string) {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={index} className="px-1 py-0.5 rounded bg-[var(--bg-hover)] font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}
