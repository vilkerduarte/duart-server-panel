import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { ThemeProvider } from "@/lib/contexts/ThemeContext";
import { I18nProvider } from "@/lib/contexts/I18nContext";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import { ToastProvider } from "@/lib/contexts/ToastContext";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <Component {...pageProps} />
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
