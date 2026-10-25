import test from 'node:test';
import assert from 'node:assert/strict';
import { shortProductName } from './shortName';

test('type - model - brand names split into model title and type·brand caption', () => {
  assert.deepEqual(shortProductName('Внутрипольный конвектор - KVZ 230-80-1200', 'KVZ-Heat'), { title: 'KVZ 230-80-1200', variant: '', caption: 'Внутрипольный конвектор · KVZ-Heat' });
});

test('trailing brand part is dropped from the title', () => {
  const r = shortProductName('Встраиваемый термостат - Comando Plus 2T - Riello', 'Riello');
  assert.equal(r.title, 'Comando Plus 2T');
  assert.equal(r.caption, 'Встраиваемый термостат · Riello');
});

test('model written inside the first part is separated from the Cyrillic type', () => {
  const r = shortProductName('Трубчатый отопительный прибор Koralux Linear Exclusive-M 900/450 - Korado', 'Korado');
  assert.equal(r.title, 'Koralux Linear Exclusive-M 900/450');
  assert.equal(r.caption, 'Трубчатый отопительный прибор · Korado');
});

test('a Latin word after a preposition stays in the type', () => {
  const r = shortProductName('Терморегулятор интеллектуальный с WIFI - DEVIreg Smart - Polar White', 'DEVI');
  assert.equal(r.caption, 'Терморегулятор интеллектуальный с WIFI · DEVI');
  assert.equal(r.title, 'DEVIreg Smart');
  assert.equal(r.variant, 'Polar White');
});

test('long titles are clipped, empty names are safe', () => {
  assert.ok(shortProductName('Тип - ' + 'X'.repeat(80), null).title.length <= 60);
  const v = shortProductName('Радиатор алюминиевый - Pegasus - шаг 50, высота 800 мм - белый', null);
  assert.equal(v.title, 'Pegasus');
  assert.equal(v.variant, 'шаг 50, высота 800 мм · белый');
  assert.deepEqual(shortProductName('', 'Acme'), { title: '', variant: '', caption: 'Acme' });
});
