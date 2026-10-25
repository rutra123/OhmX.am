import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same in-memory TS transpile hook as category-compositions.test.mjs; no build output.
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
const modulePath = process.env.PINNED_COLLECTION_MODULE || path.join(root, 'client/src/components/PinnedCollection.tsx');
const { reorderIds, moveIdToIndex } = require(modulePath);
const source = readFileSync(path.join(root, 'client/src/components/PinnedCollection.tsx'), 'utf8');

const cases = [
  // [before, from, to, after]
  ['AB', 'A', 'B', 'BA'], // adjacent forward — the recorded native no-op
  ['AB', 'B', 'A', 'BA'], // adjacent backward
  ['ABC', 'A', 'B', 'BAC'],
  ['ABC', 'B', 'C', 'ACB'], // adjacent forward to last
  ['ABC', 'C', 'B', 'ACB'],
  ['ABC', 'B', 'A', 'BAC'], // adjacent backward to first
  ['ABC', 'A', 'C', 'BCA'], // non-adjacent to last
  ['ABC', 'C', 'A', 'CAB'], // non-adjacent to first
];

test('a dragged pin takes the target slot in both directions', () => {
  assert.equal(typeof reorderIds, 'function');
  for (const [before, from, to, after] of cases) {
    assert.equal(reorderIds([...before], from, to).join(''), after, `${before}: ${from} -> ${to}`);
  }
});

test('no-op and invalid targets keep the same array, so nothing is persisted', () => {
  const ids = ['A', 'B', 'C'];
  assert.equal(reorderIds(ids, 'B', 'B'), ids);
  assert.equal(reorderIds(ids, 'Z', 'B'), ids);
  assert.equal(reorderIds(ids, 'A', 'Z'), ids);
});

test('keyboard index moves clamp to the first and last position', () => {
  assert.equal(moveIdToIndex(['A', 'B', 'C'], 'B', -1).join(''), 'BAC');
  assert.equal(moveIdToIndex(['A', 'B', 'C'], 'B', 9).join(''), 'ACB');
  const ids = ['A', 'B'];
  assert.equal(moveIdToIndex(ids, 'A', 0), ids);
});

test('pins hidden from the current list keep their slots', () => {
  assert.equal(reorderIds(['A', 'X', 'B'], 'A', 'B').join(''), 'XBA');
  assert.equal(reorderIds(['A', 'X', 'B'], 'B', 'A').join(''), 'BAX');
});

test('order is committed once per completed gesture, never on hover', () => {
  assert.doesNotMatch(source, /onPointerEnter/);
  assert.match(source, /onDrop=\{[\s\S]*?commitReorder\(nativeDragId\.current, id\)/);
  assert.match(source, /onDragEnd=\{clearDrag\}/);
  // Chrome sends pointercancel right after a native dragstart; it may only end a pointer gesture.
  assert.match(source, /onPointerCancel=\{cancelPointerDrag\}/);
  assert.match(source, /const cancelPointerDrag = [\s\S]*?pointerDrag\.current\?\.pointerId === event\.pointerId\) clearDrag\(\)/);
  const dragOver = source.match(/onDragOver=\{([\s\S]*?)\n {8}\}\}/)?.[1] ?? '';
  assert.ok(dragOver.includes('setOverId'));
  assert.doesNotMatch(dragOver, /commitReorder|onReorder/);
  const pointerMove = source.match(/const handlePointerMove = ([\s\S]*?)\n {2}\};/)?.[1] ?? '';
  assert.ok(pointerMove.includes('setOverId'));
  assert.doesNotMatch(pointerMove, /commitReorder|onReorder/);
});

test('keyboard reorder is available on the handle', () => {
  assert.match(source, /onKeyDown=\{\(event\) => handleKeyDown\(event, id\)\}/);
  for (const key of ['ArrowUp', 'ArrowDown', 'Home', 'End']) assert.match(source, new RegExp(`${key}:`));
  assert.match(source, /aria-live="polite"/);
  for (const language of ['ru', 'en', 'hy']) {
    const locale = JSON.parse(readFileSync(path.join(root, `client/src/i18n/locales/${language}/common.json`), 'utf8'));
    assert.match(locale.catalog.shared.pin.reorderMoved, /\{\{position\}\}[\s\S]*\{\{total\}\}/);
  }
});
