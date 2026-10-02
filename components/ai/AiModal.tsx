import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  HiOutlinePaperAirplane, HiOutlineXMark, HiOutlinePlus, HiOutlineClock, HiOutlinePaperClip,
  HiOutlineCheck, HiOutlineExclamationTriangle, HiOutlineChatBubbleOvalLeft,
  HiOutlineMagnifyingGlass, HiOutlineBolt, HiOutlineDocumentText, HiOutlineAcademicCap,
  HiOutlineShieldCheck, HiOutlineEye, HiOutlineClipboard, HiOutlineXCircle, HiSparkles,
  HiOutlineDocumentMagnifyingGlass, HiOutlineCircleStack, HiOutlineArrowPath, HiOutlineServerStack,
  HiOutlineCpuChip, HiOutlineEllipsisHorizontalCircle, HiOutlineCommandLine, HiOutlineLockClosed,
  HiOutlineGlobeAlt, HiOutlineKey, HiOutlineArchiveBox, HiOutlineCube, HiOutlineCog, HiStop,
} from 'react-icons/hi2';
import AiMarkdown from './AiMarkdown';
import { useI18n } from '@/lib/contexts/I18nContext';
import { useAuth } from '@/lib/contexts/AuthContext';
import { AI_MODES, AiMode, canWrite, normalizeAiMode } from '@/lib/ai/modes';

/* ------------------------------------------------------------------ */
/*  Tipos                                                              */
/* ------------------------------------------------------------------ */

interface PendingApproval {
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  preview: string;
  previewType: 'command' | 'diff' | 'text';
  risk: 'write' | 'irreversible';
  summary: string;
}

type ToolStatus = 'running' | 'done' | 'error' | 'rejected' | 'truncated' | 'unavailable';

interface PlanStep { title: string; status: 'pending' | 'running' | 'done' | 'failed' }

interface ToolEntry {
  kind: 'tool';
  id: string;
  name: string;
  detail: string;
  status: ToolStatus;
  error?: string;
  startedAt: number;
  durationMs?: number;
  output?: string;
}

type Entry =
  | { kind: 'user'; text: string; attachments?: string[] }
  | { kind: 'assistant'; text: string }
  | ToolEntry
  | { kind: 'approval'; pending: PendingApproval[]; resolved: boolean }
  | { kind: 'notice'; text: string }
  | { kind: 'error'; text: string };

/** Envelope dos eventos SSE; o campo `type` decide como ler o resto. */
interface StreamEvent {
  type: string;
  content?: string;
  sessionId?: string;
  fullAccess?: boolean;
  id?: string;
  name?: string;
  detail?: string;
  ok?: boolean;
  code?: string;
  durationMs?: number;
  output?: string;
  steps?: PlanStep[];
  pending?: PendingApproval[];
}

interface Attachment { name: string; content: string }

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  hasPending: boolean;
}

interface StoredEntry {
  kind: 'user' | 'assistant' | 'tool';
  text?: string;
  id?: string;
  name?: string;
  detail?: string;
  ok?: boolean | null;
  output?: string;
}

/* ------------------------------------------------------------------ */
/*  Catálogo da interface                                              */
/* ------------------------------------------------------------------ */

const TAB_ICONS: Record<AiMode, typeof HiOutlineEye> = {
  chat: HiOutlineChatBubbleOvalLeft,
  analyze: HiOutlineMagnifyingGlass,
  execute: HiOutlineBolt,
  generate: HiOutlineDocumentText,
  learn: HiOutlineAcademicCap,
};

/** Cartões da tela inicial de cada aba. Textos vêm de `ai.cards.<id>`. */
const CARDS: Record<AiMode, Array<{ id: string; icon: typeof HiOutlineEye; tone: string }>> = {
  chat: [
    { id: 'nginxLogs', icon: HiOutlineDocumentMagnifyingGlass, tone: 'text-sky-400' },
    { id: 'diskUsage', icon: HiOutlineCircleStack, tone: 'text-blue-400' },
    { id: 'restartService', icon: HiOutlineArrowPath, tone: 'text-emerald-400' },
    { id: 'processes', icon: HiOutlineServerStack, tone: 'text-cyan-400' },
    { id: 'analyzeErrors', icon: HiOutlineExclamationTriangle, tone: 'text-red-400' },
    { id: 'other', icon: HiOutlineEllipsisHorizontalCircle, tone: 'text-indigo-400' },
  ],
  analyze: [
    { id: 'diskCompare', icon: HiOutlineCircleStack, tone: 'text-blue-400' },
    { id: 'slowSite', icon: HiOutlineGlobeAlt, tone: 'text-amber-400' },
    { id: 'securityAudit', icon: HiOutlineLockClosed, tone: 'text-red-400' },
    { id: 'resourceHogs', icon: HiOutlineCpuChip, tone: 'text-cyan-400' },
  ],
  execute: [
    { id: 'cleanLogs', icon: HiOutlineArchiveBox, tone: 'text-orange-400' },
    { id: 'deploySite', icon: HiOutlineGlobeAlt, tone: 'text-emerald-400' },
    { id: 'renewCerts', icon: HiOutlineKey, tone: 'text-yellow-400' },
    { id: 'fixNginx', icon: HiOutlineCommandLine, tone: 'text-sky-400' },
  ],
  generate: [
    { id: 'vhost', icon: HiOutlineGlobeAlt, tone: 'text-sky-400' },
    { id: 'systemdUnit', icon: HiOutlineCog, tone: 'text-emerald-400' },
    { id: 'backupScript', icon: HiOutlineArchiveBox, tone: 'text-orange-400' },
    { id: 'dockerCompose', icon: HiOutlineCube, tone: 'text-blue-400' },
  ],
  learn: [
    { id: 'nginxConf', icon: HiOutlineGlobeAlt, tone: 'text-sky-400' },
    { id: 'ssl', icon: HiOutlineKey, tone: 'text-yellow-400' },
    { id: 'ufw', icon: HiOutlineShieldCheck, tone: 'text-emerald-400' },
    { id: 'cron', icon: HiOutlineClock, tone: 'text-indigo-400' },
  ],
};

const CHIPS = ['nginxLogs', 'diskUsage', 'restartPhp', 'dockerList', 'servicesStatus', 'systemErrors', 'cleanLogs'];

const MAX_ATTACHMENT_BYTES = 200 * 1024;
const MODE_STORAGE_KEY = 'duart:ai-mode';

function formatDuration(ms?: number): string {
  if (ms === undefined) return '';
  return ms < 950 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function toolStatusFrom(ok: boolean | null | undefined): ToolStatus {
  return ok === null || ok === undefined ? 'done' : ok ? 'done' : 'error';
}

/* ------------------------------------------------------------------ */
/*  Componente                                                         */
/* ------------------------------------------------------------------ */

interface AiModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AiModal({ open, onClose }: AiModalProps) {
  const { t, locale } = useI18n();
  const { user } = useAuth();

  const [entries, setEntries] = useState<Entry[]>([]);
  const [plan, setPlan] = useState<PlanStep[] | null>(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<AiMode>('chat');
  const [fullAccess, setFullAccess] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tools = useMemo(() => entries.filter((e): e is ToolEntry => e.kind === 'tool'), [entries]);
  const hasConversation = entries.length > 0;
  const showSidePanel = tools.length > 0 || Boolean(plan?.length);
  const selectedTool = tools.find(tool => tool.id === selectedToolId) ?? tools[tools.length - 1];

  // Ref para o efeito de abertura não depender de `entries` e reexecutar a cada mensagem.
  const hasConversationRef = useRef(false);
  useEffect(() => { hasConversationRef.current = hasConversation; }, [hasConversation]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // O cronômetro dos passos em andamento só corre enquanto há resposta em curso.
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, [streaming]);

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
      .then(json => {
        setFullAccess(Boolean(json?.data?.aiFullAccess));

        // Última aba usada; na falta dela, a padrão da configuração.
        let stored: string | null = null;
        try { stored = window.localStorage.getItem(MODE_STORAGE_KEY); } catch {}
        setMode(prev => (hasConversationRef.current ? prev : normalizeAiMode(stored ?? json?.data?.aiDefaultMode)));
      })
      .catch(() => setFullAccess(false));

    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [open, loadSessions]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const changeMode = (next: AiMode) => {
    setMode(next);
    try { window.localStorage.setItem(MODE_STORAGE_KEY, next); } catch {}
  };

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

    const push = (entry: Entry) => setEntries(prev => [...prev, entry]);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sessionId, locale, ...body }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        push({ kind: 'error', text: err?.error ?? t('ai.connectionError') });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        push({ kind: 'error', text: t('ai.invalidResponse') });
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
              if (typeof event.fullAccess === 'boolean') setFullAccess(event.fullAccess);
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

            case 'notice':
              push({ kind: 'notice', text: event.content ?? '' });
              break;

            case 'tool_start': {
              assistantOpen = false;
              const id = event.id ?? `${event.name}-${Date.now()}`;
              push({
                kind: 'tool', id, name: event.name ?? '?', detail: event.detail ?? '',
                status: 'running', startedAt: Date.now(),
              });
              setSelectedToolId(id);
              break;
            }

            case 'tool_result':
              assistantOpen = false;
              setEntries(prev => {
                const copy = [...prev];
                const status: ToolStatus = event.ok ? 'done' : (event.code as ToolStatus) ?? 'error';
                const index = copy.findIndex(e => e.kind === 'tool' && e.id === event.id);

                if (index === -1) {
                  // Resultado sem início (chamada recusada ou indisponível): entra já resolvido.
                  copy.push({
                    kind: 'tool', id: event.id ?? `${event.name}-${copy.length}`, name: event.name ?? '?',
                    detail: '', status, error: event.detail, startedAt: Date.now(),
                    durationMs: event.durationMs, output: event.output,
                  });
                } else {
                  const current = copy[index] as ToolEntry;
                  copy[index] = { ...current, status, error: event.detail, durationMs: event.durationMs, output: event.output };
                }
                return copy;
              });
              break;

            case 'plan':
              setPlan(event.steps ?? null);
              break;

            case 'approval_required':
              assistantOpen = false;
              push({ kind: 'approval', pending: event.pending ?? [], resolved: false });
              break;

            case 'error':
              push({ kind: 'error', text: event.content ?? t('ai.unknownError') });
              break;
          }
        }
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        push({ kind: 'error', text: err instanceof Error ? err.message : t('ai.connectionError') });
      }
    } finally {
      // Passos que ficaram "em andamento" por causa de uma interrupção não podem girar para sempre.
      setEntries(prev => prev.map(e => (e.kind === 'tool' && e.status === 'running' ? { ...e, status: 'error' } : e)));
      setStreaming(false);
      loadSessions();
    }
  }, [mode, sessionId, locale, t, loadSessions]);

  const submit = useCallback((text: string, files: Attachment[] = []) => {
    const clean = text.trim();
    if ((!clean && !files.length) || streaming) return;

    // O conteúdo dos anexos vai junto da mensagem; a tela mostra só os nomes.
    const withFiles = files.length
      ? `${clean}\n\n${files.map(f => `[${t('ai.attachedLabel')}: ${f.name}]\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}`
      : clean;

    setInput('');
    setAttachments([]);
    setEntries(prev => [...prev, { kind: 'user', text: clean, attachments: files.map(f => f.name) }]);
    runStream({ message: withFiles });
  }, [streaming, runStream, t]);

  const decide = (index: number, decisions: Array<{ toolCallId: string; approved: boolean }>) => {
    setEntries(prev => {
      const copy = [...prev];
      const entry = copy[index];
      if (entry?.kind === 'approval') copy[index] = { ...entry, resolved: true };
      return copy;
    });
    runStream({ approvals: decisions });
  };

  const stop = () => abortRef.current?.abort();

  const newConversation = () => {
    abortRef.current?.abort();
    setSessionId(null);
    setEntries([]);
    setPlan(null);
    setSelectedToolId(null);
    setShowSessions(false);
  };

  const openSession = async (id: string) => {
    abortRef.current?.abort();
    try {
      const res = await fetch(`/api/ai/sessions/${id}`);
      const json = await res.json();
      if (!json.success) return;

      const restored: Entry[] = (json.data.entries as StoredEntry[]).map(entry => {
        if (entry.kind === 'user') return { kind: 'user', text: entry.text ?? '' };
        if (entry.kind === 'assistant') return { kind: 'assistant', text: entry.text ?? '' };
        return {
          kind: 'tool', id: entry.id ?? '', name: entry.name ?? '?', detail: entry.detail ?? '',
          status: toolStatusFrom(entry.ok), startedAt: 0, output: entry.output,
        } as ToolEntry;
      });
      if (json.data.pending?.length) {
        restored.push({ kind: 'approval', pending: json.data.pending, resolved: false });
      }

      setSessionId(id);
      changeMode(normalizeAiMode(json.data.mode));
      setEntries(restored);
      setPlan(json.data.plan ?? null);
      setSelectedToolId(null);
      setShowSessions(false);
    } catch {}
  };

  const attachFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Attachment[] = [];

    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setEntries(prev => [...prev, { kind: 'notice', text: t('ai.attachTooLarge', { name: file.name }) }]);
        continue;
      }
      const content = await file.text();
      if (content.includes('\0')) continue;
      added.push({ name: file.name, content });
    }

    if (added.length) setAttachments(prev => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!open) return null;

  const initial = (user?.username ?? '?').charAt(0).toUpperCase();
  const writes = canWrite(mode);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={t('ai.title')}>
      <div className="fixed inset-0 bg-[#02050f]/85" onClick={onClose} />

      <div className="glow-border relative flex h-[90vh] w-full max-w-6xl animate-fade-in flex-col overflow-hidden rounded-3xl bg-[var(--panel-bg)] shadow-[0_30px_120px_rgba(2,8,30,0.7)]">
        {/* Brilho decorativo no canto, como nas referências */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.35),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute -left-24 bottom-0 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.18),transparent_70%)]" />

        {/* Cabeçalho */}
        <div className="relative flex items-start gap-3 px-6 pt-5">
          <HiSparkles className="mt-1 h-8 w-8 shrink-0 text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.7)]" />
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-2xl font-semibold text-[var(--text-primary)]">{t('ai.title')}</h2>
            <p className="m-0 mt-0.5 truncate text-sm text-[var(--text-secondary)]">{t('ai.subtitle')}</p>
          </div>

          <div className="flex items-center gap-1">
            <IconButton label={t('ai.history')} onClick={() => setShowSessions(v => !v)} active={showSessions}>
              <HiOutlineClock className="h-5 w-5" />
            </IconButton>
            <IconButton label={t('ai.newChat')} onClick={newConversation}>
              <HiOutlinePlus className="h-5 w-5" />
            </IconButton>
            <IconButton label={t('ai.close')} onClick={onClose}>
              <HiOutlineXMark className="h-6 w-6" />
            </IconButton>
          </div>
        </div>

        {/* Abas */}
        <div className="relative px-6 pt-4">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--glass-border)] bg-black/20 p-1" role="tablist">
            {AI_MODES.map(value => {
              const Icon = TAB_ICONS[value];
              const active = mode === value;
              return (
                <button
                  key={value}
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeMode(value)}
                  title={t(`ai.hints.${value}`)}
                  className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                    active
                      ? 'bg-blue-500/15 text-[var(--text-primary)] shadow-[0_0_0_1px_rgba(96,165,250,0.7),0_0_18px_rgba(59,130,246,0.35)]'
                      : 'text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t(`ai.tabs.${value}`)}
                </button>
              );
            })}
          </div>

          <AccessLine mode={mode} fullAccess={fullAccess} onNavigate={onClose} />
        </div>

        {/* Corpo */}
        <div className="relative flex min-h-0 flex-1 gap-4 px-6 pb-2 pt-3">
          {showSessions && (
            <aside className="w-60 shrink-0 overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-black/20">
              {sessions.length === 0 ? (
                <p className="p-4 text-xs text-[var(--text-muted)]">{t('ai.noHistory')}</p>
              ) : sessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => openSession(session.id)}
                  className={`w-full border-b border-[var(--glass-border)] px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-white/5 ${
                    session.id === sessionId ? 'bg-white/5' : ''
                  }`}
                >
                  <p className="m-0 truncate text-xs font-medium text-[var(--text-primary)]">{session.title}</p>
                  <p className="m-0 mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {new Date(session.updatedAt).toLocaleString(locale)}
                    {session.hasPending && ` · ${t('ai.awaiting')}`}
                  </p>
                </button>
              ))}
            </aside>
          )}

          <div ref={chatRef} className="min-w-0 flex-1 overflow-y-auto pr-1">
            {!hasConversation ? (
              <Welcome mode={mode} onPick={text => submit(text)} />
            ) : (
              <div className="flex flex-col gap-4 pb-2">
                {entries.map((entry, index) => (
                  <EntryView
                    key={index}
                    entry={entry}
                    initial={initial}
                    now={now}
                    onDecide={decisions => decide(index, decisions)}
                    disabled={streaming}
                    onSelectTool={setSelectedToolId}
                  />
                ))}

                {streaming && (
                  <div className="flex items-center gap-2 pl-1 text-xs text-[var(--text-muted)]">
                    <RingSpinner /> {t('ai.working')}
                  </div>
                )}
              </div>
            )}
          </div>

          {showSidePanel && (
            <aside className="hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto lg:flex xl:w-96">
              <TimelinePanel
                tools={tools} plan={plan} now={now}
                selectedId={selectedTool?.id} onSelect={setSelectedToolId}
              />
              <OutputPanel tool={selectedTool} />
            </aside>
          )}
        </div>

        {/* Entrada */}
        <div className="relative px-6 pb-5 pt-2">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((file, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-full border border-[var(--glass-border)] bg-black/20 py-1 pl-3 pr-1.5 text-xs text-[var(--text-secondary)]">
                  <HiOutlinePaperClip className="h-3.5 w-3.5" />
                  {file.name}
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    aria-label={t('ai.removeAttachment')}
                    className="rounded-full p-0.5 hover:bg-white/10"
                  >
                    <HiOutlineXMark className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={`flex items-end gap-2 rounded-2xl border bg-black/25 p-2 transition-shadow ${
            streaming
              ? 'border-blue-400/60 shadow-[0_0_20px_rgba(59,130,246,0.3)]'
              : 'border-[var(--glass-border)] focus-within:border-blue-400/70 focus-within:shadow-[0_0_20px_rgba(59,130,246,0.25)]'
          }`}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => attachFiles(e.target.files)}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title={t('ai.attach')}
              aria-label={t('ai.attach')}
              className="rounded-xl p-2.5 text-[var(--text-muted)] transition-colors hover:bg-white/5 hover:text-[var(--text-primary)]"
            >
              <HiOutlinePaperClip className="h-5 w-5" />
            </button>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit(input, attachments);
                }
              }}
              rows={1}
              placeholder={hasConversation ? t('ai.placeholderFollowUp') : t('ai.placeholder')}
              className="max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent px-1 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />

            {streaming ? (
              <button
                onClick={stop}
                className="flex items-center gap-2 rounded-xl border border-blue-400/50 bg-blue-500/10 py-2 pl-3 pr-4 text-sm text-[var(--text-primary)] transition-colors hover:bg-blue-500/20"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-blue-400">
                  <HiStop className="h-3 w-3 text-blue-300" />
                </span>
                <span className="hidden sm:inline">{t(writes ? 'ai.executing' : 'ai.working')}</span>
                <span className="sr-only">{t('ai.stop')}</span>
              </button>
            ) : (
              <button
                onClick={() => submit(input, attachments)}
                disabled={!input.trim() && attachments.length === 0}
                aria-label={t('ai.send')}
                title={t('ai.send')}
                className="flex h-11 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-[0_0_18px_rgba(59,130,246,0.45)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                <HiOutlinePaperAirplane className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Partes                                                             */
/* ------------------------------------------------------------------ */

function IconButton({
  children, label, onClick, active,
}: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-full p-2 transition-colors hover:bg-white/10 hover:text-[var(--text-primary)] ${
        active ? 'bg-white/10 text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
      }`}
    >
      {children}
    </button>
  );
}

function RingSpinner({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return <span className={`inline-block shrink-0 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400 ${className}`} />;
}

/** Diz, em uma linha, o que a aba atual pode fazer e o que vale o Acesso Total. */
function AccessLine({ mode, fullAccess, onNavigate }: { mode: AiMode; fullAccess: boolean; onNavigate: () => void }) {
  const { t } = useI18n();
  const writes = canWrite(mode);

  const tone = !writes
    ? { icon: HiOutlineEye, cls: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/5', label: t('ai.access.readOnly') }
    : fullAccess
      ? { icon: HiOutlineBolt, cls: 'text-amber-300 border-amber-400/40 bg-amber-400/10', label: t('ai.access.full') }
      : { icon: HiOutlineShieldCheck, cls: 'text-sky-300 border-sky-400/30 bg-sky-400/5', label: t('ai.access.approval') };
  const Icon = tone.icon;

  return (
    <div className="mx-auto mt-3 flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
      <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium ${tone.cls}`}>
        <Icon className="h-3.5 w-3.5" />
        {tone.label}
      </span>
      <span className="min-w-0 flex-1">
        {!writes ? t('ai.access.readOnlyDesc') : fullAccess ? t('ai.access.fullDesc') : t('ai.access.approvalDesc')}
      </span>
      {writes && !fullAccess && (
        <Link href="/settings" onClick={onNavigate} className="text-blue-400 hover:underline">
          {t('ai.access.enable')}
        </Link>
      )}
    </div>
  );
}

function Welcome({ mode, onPick }: { mode: AiMode; onPick: (text: string) => void }) {
  const { t } = useI18n();
  const cards = CARDS[mode];

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center pb-4 pt-6 text-center">
      <h3 className="m-0 text-4xl font-bold text-[var(--text-primary)]">
        {t('ai.helpPrefix')}{' '}
        <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">{t('ai.helpHighlight')}</span>
      </h3>
      <p className="m-0 mt-3 max-w-xl text-base leading-relaxed text-[var(--text-secondary)]">{t(`ai.helpSub.${mode}`)}</p>

      <div className={`mt-8 grid w-full gap-3 text-left ${cards.length > 4 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              onClick={() => onPick(t(`ai.cards.${card.id}.prompt`))}
              className="glass-card glass-card--interactive flex items-center gap-3 rounded-2xl p-4 text-left"
            >
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 ${card.tone}`}>
                <Icon className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-[var(--text-primary)]">{t(`ai.cards.${card.id}.title`)}</span>
                <span className="mt-0.5 block text-xs leading-snug text-[var(--text-muted)]">{t(`ai.cards.${card.id}.desc`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {mode === 'chat' && (
        <div className="mt-6 w-full text-left">
          <p className="m-0 mb-3 flex items-center gap-2 border-b border-[var(--glass-border)] pb-2 text-xs text-[var(--text-muted)]">
            <HiOutlineCommandLine className="h-3.5 w-3.5" />
            {t('ai.examplesLabel')}
          </p>
          <div className="flex flex-wrap gap-2">
            {CHIPS.map(id => (
              <button
                key={id}
                onClick={() => onPick(t(`ai.chips.${id}`))}
                className="rounded-full border border-[var(--glass-border)] bg-white/[0.03] px-4 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-blue-400/60 hover:bg-blue-500/10 hover:text-[var(--text-primary)]"
              >
                {t(`ai.chips.${id}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status, className = 'h-4 w-4' }: { status: ToolStatus | PlanStep['status']; className?: string }) {
  if (status === 'running') return <RingSpinner className={className} />;
  if (status === 'done') {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white ${className}`}>
        <HiOutlineCheck className="h-[70%] w-[70%] stroke-[3]" />
      </span>
    );
  }
  if (status === 'pending') return <span className={`shrink-0 rounded-full border-2 border-slate-500/60 ${className}`} />;
  return <HiOutlineExclamationTriangle className={`shrink-0 text-amber-400 ${className}`} />;
}

function toolLabel(t: (key: string) => string, name: string): string {
  const key = `ai.tools.${name}`;
  const label = t(key);
  return label === key ? name : label;
}

function TimelinePanel({
  tools, plan, now, selectedId, onSelect,
}: {
  tools: ToolEntry[];
  plan: PlanStep[] | null;
  now: number;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section className="glass-card rounded-2xl p-4">
      <h4 className="m-0 mb-3 text-sm font-semibold text-[var(--text-primary)]">{t('ai.functionsExecuted')}</h4>

      {plan && plan.length > 0 && (
        <ol className="m-0 mb-3 flex list-none flex-col gap-2 border-b border-[var(--glass-border)] p-0 pb-3">
          {plan.map((step, i) => (
            <li key={i} className={`m-0 flex items-start gap-2.5 text-xs ${step.status === 'pending' ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>
              <StatusIcon status={step.status} className="mt-px h-4 w-4" />
              <span className="min-w-0 flex-1">
                {step.title}
                {step.status === 'pending' && <span className="block text-[10px] text-[var(--text-muted)]">{t('ai.waiting')}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {tools.length === 0 ? (
        <p className="m-0 text-xs text-[var(--text-muted)]">{t('ai.noFunctions')}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {tools.map(tool => {
            const elapsed = tool.status === 'running' ? now - tool.startedAt : tool.durationMs;
            return (
              <li key={tool.id} className="m-0">
                <button
                  onClick={() => onSelect(tool.id)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 ${
                    tool.id === selectedId ? 'bg-blue-500/10 ring-1 ring-blue-400/30' : ''
                  }`}
                >
                  <StatusIcon status={tool.status} className="mt-0.5 h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-xs text-[var(--text-primary)]">
                      <span className="truncate">{toolLabel(t, tool.name)}</span>
                      <span className="shrink-0 tabular-nums text-[10px] text-[var(--text-muted)]">{formatDuration(elapsed)}</span>
                    </span>
                    {tool.detail && <span className="block truncate font-mono text-[10px] text-[var(--text-muted)]" title={tool.detail}>{tool.detail}</span>}
                    {tool.status !== 'done' && tool.status !== 'running' && (
                      <span className="block text-[10px] text-amber-400">
                        {t(`ai.tool.${tool.status}`)}{tool.error && tool.status === 'error' ? ` — ${tool.error}` : ''}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function OutputPanel({ tool }: { tool?: ToolEntry }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!tool) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tool.output ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <section className="glass-card flex min-h-0 flex-1 flex-col rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="m-0 truncate text-sm font-semibold text-[var(--text-primary)]">
          {t('ai.liveOutput')} <span className="font-normal text-[var(--text-muted)]">· {toolLabel(t, tool.name)}</span>
        </h4>
        {tool.output && (
          <button onClick={copy} className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            {copied ? <HiOutlineCheck className="h-3.5 w-3.5 text-emerald-400" /> : <HiOutlineClipboard className="h-3.5 w-3.5" />}
            {copied ? t('ai.copied') : t('ai.copy')}
          </button>
        )}
      </div>
      <pre className="m-0 max-h-64 min-h-[5rem] flex-1 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-emerald-200/90">
        {tool.output || (tool.status === 'running' ? '…' : t('ai.noOutput'))}
      </pre>
    </section>
  );
}

function EntryView({
  entry, initial, now, onDecide, disabled, onSelectTool,
}: {
  entry: Entry;
  initial: string;
  now: number;
  onDecide: (decisions: Array<{ toolCallId: string; approved: boolean }>) => void;
  disabled: boolean;
  onSelectTool: (id: string) => void;
}) {
  const { t } = useI18n();

  if (entry.kind === 'user') {
    return (
      <div className="glass-card flex items-start gap-3 rounded-2xl p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">{initial}</span>
        <div className="min-w-0 flex-1">
          <p className="m-0 max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">{entry.text}</p>
          {entry.attachments && entry.attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.attachments.map((name, i) => (
                <span key={i} className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-[var(--text-muted)]">
                  <HiOutlinePaperClip className="h-3 w-3" /> {name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (entry.kind === 'assistant') {
    return (
      <div className="flex items-start gap-3">
        <HiSparkles className="mt-0.5 h-7 w-7 shrink-0 text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]" />
        <div className="min-w-0 flex-1"><AiMarkdown text={entry.text} /></div>
      </div>
    );
  }

  if (entry.kind === 'notice') {
    return <p className="m-0 pl-10 text-xs italic text-[var(--text-muted)]">{entry.text}</p>;
  }

  if (entry.kind === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
        <HiOutlineExclamationTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {entry.text}
      </div>
    );
  }

  if (entry.kind === 'tool') {
    const elapsed = entry.status === 'running' ? now - entry.startedAt : entry.durationMs;
    // Em telas largas o painel lateral já mostra este passo com o detalhe.
    return (
      <button
        onClick={() => onSelectTool(entry.id)}
        className="flex items-center gap-2 pl-10 text-left text-xs text-[var(--text-muted)] lg:hidden"
      >
        <StatusIcon status={entry.status} className="h-3.5 w-3.5" />
        <span className="text-[var(--text-secondary)]">{toolLabel(t, entry.name)}</span>
        <span className="min-w-0 truncate font-mono text-[10px]">{entry.detail}</span>
        <span className="tabular-nums text-[10px]">{formatDuration(elapsed)}</span>
      </button>
    );
  }

  // Aprovação
  const irreversible = entry.pending.some(p => p.risk === 'irreversible');

  return (
    <div className={`ml-10 flex flex-col gap-3 rounded-2xl border p-4 ${
      irreversible ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'
    }`}>
      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <HiOutlineExclamationTriangle className={`h-5 w-5 ${irreversible ? 'text-red-400' : 'text-amber-400'}`} />
        {irreversible ? t('ai.irreversibleTitle') : t('ai.approvalTitle')}
      </p>

      {entry.pending.map(pending => (
        <div key={pending.toolCallId} className="flex flex-col gap-1.5">
          <p className="m-0 flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">{toolLabel(t, pending.tool)}</span>
            {pending.summary}
          </p>
          <pre className="m-0 max-h-64 overflow-auto rounded-xl bg-black/30 p-3 font-mono text-[11px] leading-tight">
            {pending.previewType === 'diff'
              ? pending.preview.split('\n').map((line, i) => (
                  <div key={i} className={
                    line.startsWith('+') && !line.startsWith('+++') ? 'text-emerald-400'
                      : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400'
                      : line.startsWith('@@') ? 'text-blue-400'
                      : 'text-[var(--text-secondary)]'
                  }>{line || ' '}</div>
                ))
              : <span className="whitespace-pre-wrap text-[var(--text-secondary)]">{pending.preview}</span>}
          </pre>
        </div>
      ))}

      {entry.resolved ? (
        <p className="m-0 text-xs text-[var(--text-muted)]">{t('ai.decisionRecorded')}</p>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={disabled}
            onClick={() => onDecide(entry.pending.map(p => ({ toolCallId: p.toolCallId, approved: true })))}
            className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
          >
            <HiOutlineCheck className="h-4 w-4" />
            {entry.pending.length > 1 ? t('ai.approveAll', { count: entry.pending.length }) : t('ai.approve')}
          </button>
          <button
            disabled={disabled}
            onClick={() => onDecide(entry.pending.map(p => ({ toolCallId: p.toolCallId, approved: false })))}
            className="flex items-center gap-1.5 rounded-xl border border-[var(--glass-border)] px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] transition-colors hover:bg-white/5 disabled:opacity-40"
          >
            <HiOutlineXCircle className="h-4 w-4" />
            {t('ai.reject')}
          </button>
        </div>
      )}
    </div>
  );
}
