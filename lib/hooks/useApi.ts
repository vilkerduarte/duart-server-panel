import { useState, useEffect, useCallback, useRef } from 'react';

interface UseApiOptions {
  immediate?: boolean;
  interval?: number; // polling interval in ms
}

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T = any>(
  url: string,
  options: UseApiOptions = {}
): UseApiResult<T> {
  const { immediate = true, interval } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url);
      const json = await res.json();

      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error || 'Erro desconhecido');
      }
    } catch (err: any) {
      setError(err.message || 'Erro de conexão');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (immediate) {
      fetchData();
    }

    if (interval) {
      intervalRef.current = setInterval(fetchData, interval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchData, immediate, interval]);

  return { data, loading, error, refetch: fetchData };
}

export function useApiPost<T = any>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async (body: any): Promise<{ success: boolean; data?: T; error?: string }> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setLoading(false);

      if (json.success) {
        setData(json.data);
        return { success: true, data: json.data };
      }
      setError(json.error);
      return { success: false, error: json.error };
    } catch (err: any) {
      setLoading(false);
      const msg = err.message || 'Erro de conexão';
      setError(msg);
      return { success: false, error: msg };
    }
  }, [url]);

  return { data, loading, error, post };
}
