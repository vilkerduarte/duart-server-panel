import { useCallback, useEffect, useRef, useState } from 'react';

export interface InstallJobView {
  id: string;
  status: 'running' | 'completed' | 'error';
  log: string[];
  error?: string;
  result?: Record<string, unknown>;
}

/**
 * Acompanha um job de instalação do MySQL/phpMyAdmin
 * (GET /api/databases/mysql/install?job=<id>) até terminar.
 */
export function useInstallJob(onFinish?: (job: InstallJobView) => void) {
  const [job, setJob] = useState<InstallJobView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishRef = useRef(onFinish);
  useEffect(() => { finishRef.current = onFinish; }, [onFinish]);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const track = useCallback((jobId: string) => {
    stop();
    const poll = async () => {
      try {
        const resp = await fetch(`/api/databases/mysql/install?job=${encodeURIComponent(jobId)}`);
        const data = await resp.json();
        if (data.success) {
          setJob(data.data);
          if (data.data.status !== 'running') {
            finishRef.current?.(data.data);
            return;
          }
        }
      } catch {
        // Painel reiniciando ou rede instável: tenta de novo.
      }
      timer.current = setTimeout(poll, 2000);
    };
    poll();
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { job, track, reset: () => { stop(); setJob(null); } };
}
