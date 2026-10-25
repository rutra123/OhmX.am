import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The project has no component runner. Compile only these TS/TSX modules in
// memory, then render the actual React components; do not emit build files.
const require = createRequire(import.meta.url);
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
      fileName: filename,
    });
    module._compile(output.outputText, filename);
  };
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (name) => readFileSync(path.join(root, 'client/src', name), 'utf8');
const config = require('../client/src/config/categoryCompositions.ts');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { StaticRouter } = require('react-router-dom/server');
const i18n = require('i18next');
const { initReactI18next } = require('react-i18next');
await i18n.use(initReactI18next).init({ lng: 'en', fallbackLng: 'en', resources: { en: { translation: {
  'catalog.shared.counts.products_one': '{{count}} product',
  'catalog.shared.counts.products_other': '{{count}} products',
} } }, interpolation: { escapeValue: false } });
const { CategoryCompositionCard } = require('../client/src/components/CategoryCompositionCard.tsx');
const { CategoryComposition } = require('../client/src/components/CategoryComposition.tsx');
const category = { slug: 'test', name_ru: 'Test category', productsCount: 0 };
const composition = { ...config.CATEGORY_COMPOSITIONS[0], description: 'Meaningful pilot description' };
const renderCard = (extra = {}) => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(CategoryCompositionCard, { category, composition, to: '/catalog/test?q=valve', ...extra })));

test('pilot defaults off, respects the parent boundary, and requires explicit opt-in', () => {
  assert.equal(typeof config.isCategoryCompositionEnabled, 'function', 'missing default-off pilot gate');
  const parent = 'hvac-i-teplosnabzhenie-avtomatika-hvac';
  assert.equal(config.isCategoryCompositionEnabled(parent, false, false, null), false);
  assert.equal(config.isCategoryCompositionEnabled(parent, false, false, 'pilot'), false);
  assert.equal(config.isCategoryCompositionEnabled(parent, false, true, 'pilot'), true);
  assert.equal(config.isCategoryCompositionEnabled(parent, true, false, null), true);
  assert.equal(config.isCategoryCompositionEnabled('unrelated', true, true, 'pilot'), false);
  assert.equal(config.isCategoryCompositionEnabled(parent, false, true, 'true'), false);
});

test('known zero count is rendered, not suppressed by truthiness', () => {
  assert.match(renderCard(), />0 products</);
});

test('unknown, invalid and negative counts do not fabricate a zero', () => {
  for (const value of [undefined, null, '', -1, NaN, Infinity, 'invalid', 1.5]) {
    const html = renderCard({ category: { ...category, productsCount: value } });
    assert.doesNotMatch(html, /category-stat-pill/, `invalid count ${value}`);
  }
  assert.match(renderCard({ category: { ...category, productsCount: 0, products_count: 99 } }), />0 products</);
  assert.match(renderCard({ category: { ...category, productsCount: 18 } }), />18 products</);
});

test('card keeps pin controls outside its navigable link and retains route query', () => {
  const html = renderCard({ pinned: true, onTogglePin: () => {}, pinLabel: 'Unpin category' });
  assert.match(html, /href="\/catalog\/test\?q=valve"/);
  assert.match(html, /<button[^>]+title="Unpin category"/);
  assert.doesNotMatch(html, /<a\b[^>]*>(?:(?!<\/a>).)*<button/s);
  assert.match(html, /is-pinned/);
});

test('art is decorative and reserves intrinsic image dimensions', () => {
  const html = renderToStaticMarkup(React.createElement(CategoryComposition, { layers: composition.layers }));
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /role="img"/);
  assert.doesNotMatch(html, /<img[^>]*alt="[^"]+"/);
  assert.match(html, /<img[^>]*width="\d+"[^>]*height="\d+"/);
  assert.match(html, /srcSet=/);
});

test('HVAC compositions use 2–4 unique supplied layers with honest identity and scoped copy', () => {
  const hvac = config.CATEGORY_COMPOSITIONS.filter((item) => item.slug.startsWith('hvac-i-teplosnabzhenie-avtomatika-hvac-'));
  assert.equal(hvac.length, 4);
  const stems = new Set();
  for (const item of hvac) {
    assert.ok(item.description?.length > 20);
    assert.ok(item.layers.length >= 2 && item.layers.length <= 4);
    for (const layer of item.layers) {
      assert.ok(layer.sourceStem, 'each layer must retain archive provenance');
      assert.ok(!stems.has(layer.sourceStem), 'alternatives must not be duplicate products');
      stems.add(layer.sourceStem);
      assert.ok(existsSync(path.join(root, 'client/pwa', layer.src)));
      assert.ok(layer.intrinsicWidth > 0 && layer.intrinsicHeight > 0);
    }
  }
  const text = JSON.stringify(config.CATEGORY_COMPOSITIONS);
  assert.doesNotMatch(text, /Датчик ECL A266|Реле давления Danfoss KP1|смарт-термостат/);
  assert.doesNotMatch(source('data/catalogExperience.ts'), /OHMX-VISUAL-CATALOG/);
});

test('automation section: seven approved subcategories, no invented art until owner PNGs arrive', () => {
  const parent = 'avtomatika-i-upravlenie';
  assert.equal(config.isCategoryCompositionEnabled(parent, true, false, null), true);
  assert.equal(config.isCategoryCompositionEnabled(parent, false, false, null), false);
  const automation = config.CATEGORY_COMPOSITIONS.filter((item) => item.slug.startsWith(`${parent}-`));
  assert.deepEqual(automation.map((item) => item.slug.slice(parent.length + 1)), [
    'promezhutochnye-rele-i-taymery', 'rele-kontrolya-i-zaschity', 'kontrolno-izmeritelnye-pribory', 'kontrollery-avr',
    'knopki-indikatory-i-posty-upravleniya', 'chastotnye-preobrazovateli', 'domofony-i-dvernye-zvonki',
  ]);
  for (const item of automation) assert.equal(item.layers.length, 0);
  assert.ok(!automation.some((item) => /aksessuary-dlya/.test(item.slug)), 'merged categories must not get cards');
});

test('every composition description is translated in ru, en and hy', () => {
  const locales = Object.fromEntries(['ru', 'en', 'hy'].map((lang) => [lang, JSON.parse(source(`i18n/locales/${lang}/common.json`))]));
  const lookup = (tree, key) => key.split('.').reduce((node, part) => node?.[part], tree);
  for (const item of config.CATEGORY_COMPOSITIONS) {
    assert.ok(item.descriptionKey, item.slug);
    for (const [lang, tree] of Object.entries(locales)) assert.ok(lookup(tree, item.descriptionKey)?.length > 10, `${lang} ${item.descriptionKey}`);
    assert.equal(lookup(locales.ru, item.descriptionKey), item.description, 'RU copy and config fallback must agree');
  }
});

test('pending art shows the existing category image, decoratively', () => {
  const pending = { slug: 'avtomatika-i-upravlenie-kontrollery-avr', descriptionKey: 'x.y', description: 'Контроллеры автоматического ввода резерва.', layers: [] };
  const html = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(CategoryCompositionCard, {
    category: { ...category, image_url: '/storage/images/ats.png', productsCount: 13 }, composition: pending, to: '/catalog/x',
  })));
  assert.match(html, /category-composition--pending[^>]*aria-hidden="true"/);
  assert.match(html, /<img[^>]*src="\/storage\/images\/ats.png"[^>]*alt=""/);
  assert.match(html, />13 products</);
  assert.match(html, /Контроллеры автоматического ввода резерва\./);
});

test('category titles follow the UI language with a Russian fallback', () => {
  const { getCategoryTitle, getCategoryDescription } = require('../client/src/data/catalogExperience.ts');
  const item = { slug: 's', name_ru: 'Контроллеры АВР', name_en: 'ATS Controllers', name_hy: '', description_ru: 'Описание' };
  assert.equal(getCategoryTitle(item, 'ru'), 'Контроллеры АВР');
  assert.equal(getCategoryTitle(item, 'en'), 'ATS Controllers');
  assert.equal(getCategoryTitle(item, 'hy'), 'Контроллеры АВР');
  assert.equal(getCategoryDescription(item, 'ru'), 'Описание');
  assert.equal(getCategoryDescription(item, 'en'), '');
});

test('integration preserves pinned ordering and legacy fallback while guarding the pilot', () => {
  const page = source('pages/CategoryPage.tsx');
  assert.match(page, /isCategoryCompositionEnabled\(/);
  assert.match(page, /import\.meta\.env\.VITE_VISUAL_CATALOG_PILOT === 'true'/);
  assert.match(page, /import\.meta\.env\.DEV/);
  assert.match(page, /listClassName=\{useVisualCompositions \? 'category-composition-grid'/);
  assert.match(page, /<CategoryCompositionCard[\s\S]*?pinned=\{meta\.isPinned\}[\s\S]*?onTogglePin=/);
  assert.match(page, /<CategoryCard[\s\S]*?child\.slug/);
});

test('pilot does not turn an absent API total into a first-page estimate', () => {
  assert.match(source('pages/CategoryPage.tsx'), /const productsCount = useVisualCompositions\s*\? countFromApi/);
});

test('mobile save control is kept outside the equipment artwork', () => {
  assert.match(source('components/CategoryCompositionCard.tsx'), /has-pin/);
  assert.match(source('styles/index.css'), /@media \(max-width: 767px\)[\s\S]*category-composition-card__pin[\s\S]*top: auto/);
});

test('pilot styles preserve full category titles, keyboard focus and reduced motion', () => {
  const css = source('styles/index.css').split('OHMX-VISUAL-CATALOG')[1];
  assert.ok(css);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  const titleRule = css.match(/\.category-composition-card__title\s*\{([^}]+)\}/)?.[1];
  assert.ok(titleRule);
  assert.doesNotMatch(titleRule, /line-clamp|overflow:\s*hidden/);
});
