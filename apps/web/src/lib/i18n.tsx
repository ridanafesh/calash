'use client';

/**
 * Lightweight i18n provider. Two languages today (en + ar) and a
 * dependency-free dictionary lookup. Strings live in en/ar maps;
 * components call `t('key')` to render the active translation.
 *
 * Persistence: chosen language is stored in localStorage under
 * 'calash:lang' so it survives reloads. On first paint we default
 * to 'en' to avoid a hydration mismatch — the AppShell effect then
 * reads localStorage on the client and re-renders if the user had
 * previously picked Arabic.
 *
 * RTL: when ar is active, the provider sets <html dir="rtl" lang="ar">.
 * en sets dir="ltr" / lang="en". CSS keys off [dir] when needed.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { en } from './i18n/en';
import { ar } from './i18n/ar';

export type Lang = 'en' | 'ar';

const STORAGE_KEY = 'calash:lang';

const DICTIONARIES: Record<Lang, Record<string, string>> = { en, ar };

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /**
   * Translate a key. If the key is missing from the active dictionary,
   * falls back to English; if missing from English too, returns the key
   * itself (so missing translations show up loudly during development).
   *
   * Variables can be interpolated with {{name}} placeholders.
   */
  t: (key: string, vars?: Record<string, string | number>) => string;
  dir: 'ltr' | 'rtl';
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  // On mount, hydrate from localStorage. Doing this in an effect rather
  // than initial state avoids SSR/hydration mismatches.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (stored === 'en' || stored === 'ar') {
        setLangState(stored);
      }
    } catch {
      // localStorage may throw in private mode; default to 'en'.
    }
  }, []);

  // Apply <html dir/lang> whenever lang changes so RTL kicks in immediately.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  };

  const value = useMemo<I18nContextValue>(() => {
    const dict = DICTIONARIES[lang];
    const fallback = DICTIONARIES.en;
    return {
      lang,
      setLang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      t: (key, vars) => {
        const raw = dict[key] ?? fallback[key] ?? key;
        if (!vars) return raw;
        return raw.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
          k in vars ? String(vars[k]) : `{{${k}}}`,
        );
      },
    };
    // setLang is stable; lang is the only meaningful dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Outside the provider (eg. server components that try to use this)
    // we return a no-op English fallback so the page still renders. The
    // `t` function returns the key unchanged.
    return {
      lang: 'en',
      setLang: () => {},
      dir: 'ltr',
      t: (key) => key,
    };
  }
  return ctx;
}

/** Convenience hook — returns just the translate function. */
export function useT() {
  return useI18n().t;
}
