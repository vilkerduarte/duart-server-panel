import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';

interface I18nContextValue {
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
  setLocale: (locale: string) => void;
  availableLocales: { code: string; name: string; flag: string }[];
}

const I18nContext = createContext<I18nContextValue>({
  t: (key: string) => key,
  locale: 'pt-BR',
  setLocale: () => {},
  availableLocales: [],
});

const availableLocales = [
  { code: 'pt-BR', name: 'Português', flag: '🇧🇷' },
  { code: 'en-US', name: 'English', flag: '🇺🇸' },
  { code: 'es-ES', name: 'Español', flag: '🇪🇸' },
];

// Cache for loaded translations
const translationCache: Record<string, Record<string, any>> = {};

function getNestedValue(obj: any, path: string[]): any {
  let current = obj;
  for (const part of path) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function resolveTranslation(key: string, locale: string): string {
  const [namespace, ...path] = key.split('.');
  const cacheKey = `${locale}:${namespace}`;

  if (!translationCache[cacheKey]) {
    try {
      // Dynamic require for the translation file
      // In the browser, we'll need to fetch or load these differently
      // For now, we use a simple approach
      const translations = (window as any).__translations?.[locale]?.[namespace];
      if (translations) {
        translationCache[cacheKey] = translations;
      } else {
        return key; // fallback to key
      }
    } catch {
      return key;
    }
  }

  const translations = translationCache[cacheKey];
  const value = getNestedValue(translations, [namespace, ...path]);

  if (value === undefined && locale !== 'pt-BR') {
    return resolveTranslation(key, 'pt-BR');
  }

  return value ?? key;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState('pt-BR');

  useEffect(() => {
    fetch('/api/settings/config')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data?.language) {
          setLocaleState(json.data.language);
        }
      })
      .catch(() => {});
  }, []);

  // Pre-load translations
  useEffect(() => {
    const namespaces = ['common', 'auth', 'dashboard', 'monitor', 'files', 'tasks',
      'nginx', 'firewall', 'docker', 'databases', 'security', 'settings', 'ai',
      'ssl', 'cron', 'backup', 'logs', 'network'];

    if (!(window as any).__translations) {
      (window as any).__translations = {};
    }
    if (!(window as any).__translations[locale]) {
      (window as any).__translations[locale] = {};
    }

    // Load all namespaces for current locale
    Promise.all(
      namespaces.map(ns =>
        import(`@/languages/${locale}/${ns}.js`)
          .then(mod => {
            (window as any).__translations[locale][ns] = mod.default || mod;
            delete translationCache[`${locale}:${ns}`]; // clear cache
          })
          .catch(() => {})
      )
    );
  }, [locale]);

  const setLocale = useCallback((newLocale: string) => {
    setLocaleState(newLocale);
    document.documentElement.lang = newLocale;
    fetch('/api/settings/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: newLocale }),
    }).catch(() => {});
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    let text = resolveTranslation(key, locale);

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }

    return text;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ t, locale, setLocale, availableLocales }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
