import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const readSource = (path) => readFile(new URL(path, root), 'utf8');

test('all root-category cards render the shared canonical media component', async () => {
  const [home, catalog, publicCard] = await Promise.all([
    readSource('client/src/pages/HomePage.tsx'),
    readSource('client/src/pages/CatalogPage.tsx'),
    readSource('client/src/components/PublicCategoryCard.tsx'),
  ]);

  for (const [name, source] of [['HomePage', home], ['CatalogPage', catalog], ['PublicCategoryCard', publicCard]]) {
    assert.match(source, /RootCategoryMedia/, `${name} must use RootCategoryMedia`);
  }

  assert.doesNotMatch(home, /catalog-home-card--fill|category\.slug\s*===/, 'Home must not contain slug-specific image-fit rules');
  assert.doesNotMatch(catalog, /fullBleedDirectionImageSlugs|catalog-direction-card--fill/, 'Catalog must not contain a root-image slug allowlist');
});

test('canonical root-category media CSS matches the catalog reference contract', async () => {
  const css = await readSource('client/src/styles/index.css');
  const mediaRule = css.match(/\.root-category-media\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  const imageRule = css.match(/\.root-category-media__image\s*\{([\s\S]*?)\}/)?.[1] ?? '';

  assert.match(mediaRule, /height:\s*clamp\(130px,\s*14vw,\s*170px\)/);
  assert.match(mediaRule, /overflow:\s*hidden/);
  assert.match(mediaRule, /border-radius:\s*22px/);
  assert.match(mediaRule, /background:\s*#fff/);
  assert.match(mediaRule, /padding:\s*0/);

  assert.match(imageRule, /display:\s*block/);
  assert.match(imageRule, /width:\s*100%/);
  assert.match(imageRule, /height:\s*100%/);
  assert.match(imageRule, /object-fit:\s*cover/);
  assert.match(imageRule, /object-position:\s*center/);
  assert.doesNotMatch(`${mediaRule}\n${imageRule}`, /transform\s*:|margin\s*:\s*-/);

  assert.match(css, /@media\s*\(max-width:\s*639px\)[\s\S]*?\.root-category-media\s*\{[\s\S]*?height:\s*138px/);
});

test('legacy per-surface root media selectors are removed', async () => {
  const [globalCss, catalogCss] = await Promise.all([
    readSource('client/src/styles/index.css'),
    readSource('client/src/styles/catalogDirectionCards.css'),
  ]);

  assert.doesNotMatch(globalCss, /\.catalog-home-card__media\s*\{/);
  assert.doesNotMatch(globalCss, /\.catalog-home-card__image\s*\{/);
  assert.doesNotMatch(globalCss, /\.category-showcase-card__media\s*\{/);
  assert.doesNotMatch(globalCss, /\.category-showcase-card__image\s*\{/);
  assert.doesNotMatch(catalogCss, /\.catalog-direction-card(?:--fill)?\s+\.catalog-direction-card__(?:media|image)|\.catalog-direction-card__media\s*\{/);
});
