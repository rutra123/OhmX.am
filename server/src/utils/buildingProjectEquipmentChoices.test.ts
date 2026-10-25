import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EquipmentChoicesError, createEquipmentChoicesStore, normalizeEquipmentChoices } from './buildingProjectEquipmentChoices.js';

test('equipment choices: round trip, atomic file beside the projects, removal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohmx-choices-'));
  const store = createEquipmentChoicesStore(dir);
  assert.deepEqual(store.read('p-1').choices, {});
  const doc = store.write('p-1', { 'fc-mounting:r1': 'CASSETTE', 'towel-water': 'P12/800/450/SW', 'terminal:r2': '' });
  assert.deepEqual(doc.choices, { 'fc-mounting:r1': 'CASSETTE', 'towel-water': 'P12/800/450/SW' }, 'empty value = cleared choice');
  assert.deepEqual(store.read('p-1').choices, doc.choices);
  assert.deepEqual(fs.readdirSync(dir), ['p-1.json'], 'no temp files left');
  store.remove('p-1');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('equipment choices: hostile input is rejected, not repaired', () => {
  const store = createEquipmentChoicesStore(fs.mkdtempSync(path.join(os.tmpdir(), 'ohmx-choices-')));
  assert.throws(() => store.read('../etc/passwd'), EquipmentChoicesError);
  assert.throws(() => normalizeEquipmentChoices([1, 2]), /object/);
  assert.throws(() => normalizeEquipmentChoices({ 'bad key!': 'x' }), /invalid choice key/);
  assert.throws(() => normalizeEquipmentChoices({ k: 5 }), /invalid value/);
  assert.throws(() => normalizeEquipmentChoices({ k: 'x'.repeat(200) }), /invalid value/);
  assert.throws(() => normalizeEquipmentChoices(Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`k${i}`, 'v']))), /too many/);
});
