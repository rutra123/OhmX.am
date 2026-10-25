import test from 'node:test';
import assert from 'node:assert/strict';
import { unicodeFoldForSearch, normalizeSearchText, splitSearchTerms } from './searchRanking.js';

test('unicodeFoldForSearch performs NFKC + ru-RU lowercase + yo folding', () => {
  assert.equal(unicodeFoldForSearch('Звонок'), 'звонок');
  assert.equal(unicodeFoldForSearch('звонок'), 'звонок');
  assert.equal(unicodeFoldForSearch('ЗВОНОК'), 'звонок');
  assert.equal(unicodeFoldForSearch('Ёлка'), 'елка');
  assert.equal(unicodeFoldForSearch('елка'), 'елка');
  assert.equal(unicodeFoldForSearch('K'), 'k');
});

test('unicodeFoldForSearch is null-safe', () => {
  assert.equal(unicodeFoldForSearch(null), '');
  assert.equal(unicodeFoldForSearch(undefined), '');
});

test('search token normalization reuses the same unicode fold', () => {
  assert.equal(normalizeSearchText('  ЗВОНОК!!!  '), 'звонок');
  assert.deepEqual(splitSearchTerms('Звонок Legrand'), ['звонок', 'legrand']);
});
