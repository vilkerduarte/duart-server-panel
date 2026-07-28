import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

interface User {
  id: string;
  username: string;
  role: string;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  needsSetup: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  setupAdmin: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
  needsSetup: false,
  login: async () => ({ success: false }),
  logout: async () => {},
  setupAdmin: async () => ({ success: false }),
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    fetch('/api/auth/check')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data?.user) {
          setUser(json.data.user);
          setToken(json.data.token);
          setNeedsSetup(false);
        } else if (json.code === 'SETUP_REQUIRED') {
          setNeedsSetup(true);
        }
      })
      .catch(() => {
        // Might need setup
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();

      if (json.success && json.data) {
        setUser(json.data.user);
        setToken(json.data.token);
        return { success: true };
      }

      return { success: false, error: json.error || 'Erro ao fazer login' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setUser(null);
    setToken(null);
  }, []);

  const setupAdmin = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json();

      if (json.success && json.data) {
        setUser(json.data.user);
        setToken(json.data.token);
        setNeedsSetup(false);
        return { success: true };
      }

      return { success: false, error: json.error || 'Erro ao criar admin' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro de conexão' };
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        needsSetup,
        login,
        logout,
        setupAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
