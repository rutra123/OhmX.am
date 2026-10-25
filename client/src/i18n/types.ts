export const SUPPORTED_LANGUAGES = ['ru', 'en', 'hy'] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'ru';
export const LANGUAGE_STORAGE_KEY = 'ohmx-language';

export const LANGUAGE_LABEL_KEYS = {
  ru: 'russian',
  en: 'english',
  hy: 'armenian',
} as const satisfies Record<SupportedLanguage, 'russian' | 'english' | 'armenian'>;

const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES);

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGE_SET.has(value);
}

export function resolveSupportedLanguage(value: unknown): SupportedLanguage | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;

  const baseLanguage = normalized.split('-')[0] ?? normalized;
  return isSupportedLanguage(baseLanguage) ? baseLanguage : null;
}

export function normalizeLanguage(value: unknown): SupportedLanguage {
  return resolveSupportedLanguage(value) ?? DEFAULT_LANGUAGE;
}
