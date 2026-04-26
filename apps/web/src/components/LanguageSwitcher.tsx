'use client';

import { useI18n } from '@/lib/i18n';

/**
 * Compact two-button toggle for switching between English and Arabic.
 * Lives in the page top bars / app shell. Tiny, uncluttered, fits in
 * any header alongside the existing nav buttons. Clicking flips both
 * the dictionary and the document direction (handled by the provider).
 */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      className="hand-toolbar-actions"
      role="radiogroup"
      aria-label={t('lang.switchTo')}
      style={{ flexShrink: 0 }}
    >
      <button
        type="button"
        role="radio"
        aria-checked={lang === 'en'}
        className={`hand-toolbar-btn ${lang === 'en' ? 'is-active' : ''}`}
        onClick={() => setLang('en')}
        title={t('lang.en')}
      >
        EN
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={lang === 'ar'}
        className={`hand-toolbar-btn ${lang === 'ar' ? 'is-active' : ''}`}
        onClick={() => setLang('ar')}
        title={t('lang.ar')}
        // Force LTR script-name reading order even in RTL mode so the label
        // stays visually identical regardless of context.
        style={{ fontFamily: 'inherit' }}
      >
        عربي
      </button>
    </div>
  );
}
