import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import hyCommon from './locales/hy/common.json';
import ruCommon from './locales/ru/common.json';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguage,
  resolveSupportedLanguage,
  type SupportedLanguage,
} from './types';

export * from './types';

const resources = {
  ru: { common: ruCommon },
  en: { common: enCommon },
  hy: { common: hyCommon },
} as const;

function setDocumentLanguage(language: SupportedLanguage) {
  if (typeof document === 'undefined') return;

  document.documentElement.lang = language;
  document.documentElement.dir = 'ltr';
}

function persistLanguage(language: SupportedLanguage) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore storage failures and keep the runtime working.
    }
  }

  setDocumentLanguage(language);
}

function readStoredLanguage(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readBrowserLanguage(): SupportedLanguage {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;

  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const candidate of candidates) {
    const resolved = resolveSupportedLanguage(candidate);
    if (resolved) return resolved;
  }

  return DEFAULT_LANGUAGE;
}

export function resolveInitialLanguage(): SupportedLanguage {
  const storedLanguage = resolveSupportedLanguage(readStoredLanguage());
  if (storedLanguage) return storedLanguage;

  return readBrowserLanguage();
}

if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    resources,
    lng: resolveInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    defaultNS: 'common',
    ns: ['common'],
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: false,
    load: 'languageOnly',
    interpolation: {
      escapeValue: false,
    },
    saveMissing: false,
    returnEmptyString: false,
    returnNull: false,
    initAsync: false,
  });
}

persistLanguage(resolveSupportedLanguage(i18next.resolvedLanguage ?? i18next.language) ?? DEFAULT_LANGUAGE);

i18next.on('languageChanged', (language) => {
  persistLanguage(normalizeLanguage(language));
});

export const i18n = i18next;

export async function setLanguage(language: SupportedLanguage) {
  const nextLanguage = isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE;
  await i18next.changeLanguage(nextLanguage);
  persistLanguage(nextLanguage);
  return nextLanguage;
}
