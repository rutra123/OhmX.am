/**
 * Phase 3.2K.1 — pre-release verification regressions: i18n fallback and the
 * primary load-mode labels.
 *
 * The building-project calculator is hardcoded-Russian by documented design
 * (ENGINEERING-MASTER-SPEC §33: "UI labels are hardcoded Russian. Future:
 * separate i18n layer"). These tests pin the SITE-level i18n fallback (ru) and
 * the calculator's primary mode labels so language switching degrades safely
 * and the "steady-state" engineering term never leaks onto the primary button.
 *
 * Run (tsx is available in server/node_modules):
 *   cd server && npx tsx --test ../client/tests/phase32k1.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  normalizeLanguage,
  resolveSupportedLanguage,
} from '../src/i18n/types.js';
import { loadModePrimaryLabel } from '../src/features/buildingProject/utils/smartLoadUx.js';

test('i18n: supported languages are ru/en/hy with ru fallback', () => {
  assert.deepEqual([...SUPPORTED_LANGUAGES], ['ru', 'en', 'hy']);
  assert.equal(DEFAULT_LANGUAGE, 'ru');
});

test('i18n: underscore/region subtags normalize to the base language', () => {
  assert.equal(resolveSupportedLanguage('hy-AM'), 'hy');
  assert.equal(resolveSupportedLanguage('en_US'), 'en');
  assert.equal(resolveSupportedLanguage('ru_RU'), 'ru');
});

test('i18n: unknown languages resolve to null; normalizeLanguage falls back to ru', () => {
  assert.equal(resolveSupportedLanguage('fr'), null);
  assert.equal(resolveSupportedLanguage('unknown'), null);
  assert.equal(normalizeLanguage('fr'), 'ru');
  assert.equal(normalizeLanguage(undefined), 'ru');
});

test('primary load mode labels hide the technical steady-state term', () => {
  assert.equal(loadModePrimaryLabel('quick'), 'Предварительный');
  assert.equal(loadModePrimaryLabel('steady_state'), 'Профессиональный');
  assert.equal(loadModePrimaryLabel('professional'), 'Legacy professional');
});