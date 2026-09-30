import { NAMESPACES, loadNamespace } from '@/languages';
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

  // Bumped when a bundle finishes loading so `t` gets a new identity and every
  // consumer re-renders with real text instead of the raw keys.
  const [version, setVersion] = useState(0);

  // Pre-load translations for the active locale and for pt-BR, which is the
  // fallback for any key a locale does not define yet.
  useEffect(() => {
    document.documentElement.lang = locale;

    const w = window as any;
    if (!w.__translations) w.__translations = {};

    const locales = Array.from(new Set([locale, 'pt-BR']));
    let cancelled = false;

    Promise.all(
      locales.flatMap(loc => {
        if (!w.__translations[loc]) w.__translations[loc] = {};
        return NAMESPACES.map(ns =>
          loadNamespace(loc, ns)
            .then(bundle => {
              if (!bundle) return;
              w.__translations[loc][ns] = bundle;
              delete translationCache[`${loc}:${ns}`];
            })
            .catch(err => console.warn(`[i18n] could not load ${loc}/${ns}`, err)),
        );
      }),
    ).then(() => {
      if (!cancelled) setVersion(v => v + 1);
    });

    return () => { cancelled = true; };
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale, version]);

  return (
    <I18nContext.Provider value={{ t, locale, setLocale, availableLocales }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
