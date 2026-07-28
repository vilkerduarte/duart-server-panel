import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { useState } from "react";
import { ThemeProvider } from "@/lib/contexts/ThemeContext";
import { I18nProvider } from "@/lib/contexts/I18nContext";
import { AuthProvider, useAuth } from "@/lib/contexts/AuthContext";
import { ToastProvider } from "@/lib/contexts/ToastContext";
import LoginScreen from "@/components/auth/LoginScreen";
import AiModal from "@/components/ai/AiModal";
import { useKeyboard } from "@/lib/hooks/useKeyboard";

function AppContent({ Component, pageProps }: AppProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const [aiOpen, setAiOpen] = useState(false);

  useKeyboard([
    { key: '5', ctrl: true, handler: () => setAiOpen(prev => !prev) },
  ]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="animate-spin-slow w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--border-color)', borderTopColor: 'var(--accent)' }} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <>
      <Component {...pageProps} />
      <AiModal open={aiOpen} onClose={() => setAiOpen(false)} />
    </>
  );
}

export default function App(props: AppProps) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <AppContent {...props} />
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
