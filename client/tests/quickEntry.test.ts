/**
 * Fast data entry — pure helper tests + source guards for the redesigned
 * Building Project wizard. No renderer, no network.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  areaProgress,
  expandRoomRows,
  formatQuickNumber,
  parseQuickNumber,
  standardRoomSet,
  STANDARD_ROOM_SETS,
} from '../src/features/buildingProject/utils/quickEntry';

const wizardSource = readFileSync(new URL('../src/features/buildingProject/components/BuildingProjectWizard.tsx', import.meta.url), 'utf8');
const panelSource = readFileSync(new URL('../src/features/buildingProject/components/RoomEngineeringPanel.tsx', import.meta.url), 'utf8');

test('Q1: empty input is empty, never zero', () => {
  assert.deepEqual(parseQuickNumber(''), { status: 'empty' });
  assert.deepEqual(parseQuickNumber('   '), { status: 'empty' });
});

test('Q2: decimal comma and dot are both accepted', () => {
  assert.deepEqual(parseQuickNumber('12,5'), { status: 'ok', value: 12.5, expression: false });
  assert.deepEqual(parseQuickNumber('12.5'), { status: 'ok', value: 12.5, expression: false });
  assert.deepEqual(parseQuickNumber(' 18 '), { status: 'ok', value: 18, expression: false });
});

test('Q3: length × width and sums of parts', () => {
  assert.equal((parseQuickNumber('3,5×4') as any).value, 14);
  assert.equal((parseQuickNumber('3.5x4') as any).value, 14);
  assert.equal((parseQuickNumber('3,5х4') as any).value, 14); // Cyrillic х
  assert.equal((parseQuickNumber('3.5*4') as any).value, 14);
  assert.equal((parseQuickNumber('12+4,5') as any).value, 16.5);
  assert.equal((parseQuickNumber('3*4+2*1,5') as any).value, 15); // × before +
  assert.equal((parseQuickNumber('0.1+0.2') as any).value, 0.3); // no float noise
  assert.equal((parseQuickNumber('3*4') as any).expression, true);
});

test('Q4: invalid, negative and zero are rejected with a readable message', () => {
  for (const bad of ['abc', '12..5', '3**4', '+5', '5+', '1/2']) {
    assert.equal(parseQuickNumber(bad).status, 'invalid', bad);
  }
  const neg = parseQuickNumber('-3');
  assert.equal(neg.status, 'invalid');
  assert.match((neg as any).message, /отрицательн/);
  assert.equal(parseQuickNumber('0').status, 'invalid');
  assert.deepEqual(parseQuickNumber('0', { allowZero: true }), { status: 'ok', value: 0, expression: false });
});

test('Q5: no averaging anywhere — a+b is a sum, not a mean', () => {
  assert.equal((parseQuickNumber('10+20') as any).value, 30);
});

test('Q6: display uses decimal comma, null stays blank', () => {
  assert.equal(formatQuickNumber(12.5), '12,5');
  assert.equal(formatQuickNumber(null), '');
  assert.equal(formatQuickNumber(undefined), '');
});

test('Q7: standard room rows exist for every object type and carry no areas', () => {
  for (const type of ['apartment', 'private_house', 'commercial'] as const) {
    const rows = standardRoomSet(type);
    assert.ok(rows.length > 0, type);
    const expanded = expandRoomRows(rows);
    assert.ok(expanded.length >= rows.length);
    assert.ok(expanded.every((r) => r.areaM2 === null), 'areas must stay empty');
  }
  // returned rows are copies — editing them never mutates the defaults
  const rows = standardRoomSet('apartment');
  rows[0].count = 9;
  assert.notEqual(STANDARD_ROOM_SETS.apartment[0].count, 9);
});

test('Q8: room counts are clamped to the server range 0..30', () => {
  assert.equal(expandRoomRows([{ roomType: 'bedroom', count: 0 }]).length, 0);
  assert.equal(expandRoomRows([{ roomType: 'bedroom', count: 99 }]).length, 30);
  assert.equal(expandRoomRows([{ roomType: 'bedroom', count: -2 }]).length, 0);
});

test('Q9: progress counts only positive areas as filled', () => {
  assert.deepEqual(areaProgress([]), { filled: 0, total: 0, percent: 0 });
  assert.deepEqual(areaProgress([{ areaM2: 10 }, { areaM2: null }, { areaM2: 0 }, { areaM2: 5 }]), { filled: 2, total: 4, percent: 50 });
});

test('Q10: wizard sends preselected rooms through the existing create contract', () => {
  assert.match(wizardSource, /rooms: expandRoomRows\(createRooms\)/);
  assert.match(wizardSource, /standardRoomSet\(objectType\)/);
  assert.doesNotMatch(wizardSource, /totalAreaM2: '180'/);
});

test('Q11: inline area entry commits through updateRoom and never writes 0 for empty', () => {
  assert.match(wizardSource, /onCommit=\{\(v\) => void updateRoom\(room\.id, \{ areaM2: v \}\)\}/);
  assert.match(wizardSource, /parsed\.status === 'ok' \? parsed\.value : null/);
});

test('Q12: auto-applied scheme never overwrites existing room selections', () => {
  assert.match(wizardSource, /nothingChosen/);
  assert.match(wizardSource, /fresh\.objectType !== 'apartment' && nothingChosen/);
});

test('Q13: engineering panel inputs accept decimal comma and jump on Enter', () => {
  assert.match(panelSource, /QUICK_INPUT_PROPS/);
  assert.match(panelSource, /focusNextEntry\(e\.currentTarget\)/);
  assert.doesNotMatch(panelSource, /type="number"/);
});

const storeSource = readFileSync(new URL('../src/features/buildingProject/store/useBuildingProjectStore.ts', import.meta.url), 'utf8');

test('Q14: a transient load failure keeps the active project id (retry reopens it)', () => {
  const hydrate = storeSource.slice(storeSource.indexOf('hydrateFromStorage: async'), storeSource.indexOf('createProject: async'));
  // the active id is cleared ONLY when the server says the project does not exist
  assert.match(hydrate, /if \(errCode\(err\) === 'building\.not_found'\) \{\s*\/\/[^\n]*\n\s*writeActiveId\(null\)/);
  assert.equal((hydrate.match(/writeActiveId\(null\)/g) || []).length, 1);
  assert.match(hydrate, /loadFailed: true/);
  assert.match(wizardSource, /loadFailed && !project/);
  assert.match(wizardSource, />Повторить<\/button>/);
});

test('Q15: quality panel renders only when the server returned an assessment', () => {
  assert.match(wizardSource, /\{loads\?\.engineeringQuality && <EngineeringQualityPanel loads=\{loads\} rooms=\{project\.rooms\} \/>\}/);
});
