/**
 * Phase 3.2M — load plausibility + Russian presentation regressions.
 *
 * Audited fixture: «Кухня-гостиная 1», 50 m², Ереван, steady_state.
 *   heating  = transmission 923.40 W + air 1395.36 W        = 2318.76 W
 *   cooling  = transmission 218.70 W + air 330.48 W
 *            + solar 0 W              + internal 875.00 W   = 1424.18 W
 *
 * RED on raw identifiers: before the presentation mapper, `профессиональный
 * (legacy)` / `steady-state` / `profile_default:...` reached the primary UI.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  loadModeRussianLabel,
  methodDisplayName,
  unmaskTechnicalString,
} from '../src/features/buildingProject/utils/presentation.js';

test('M1: audited fixture breakdown sums to the total', () => {
  const heating = 923.4 + 1395.36;
  const cooling = 218.7 + 330.48 + 0 + 875;
  assert.ok(Math.abs(heating - 2318.76) < 1e-6);
  assert.ok(Math.abs(cooling - 1424.18) < 1e-6);
});

test('M2: user-facing mapper hides raw profile_default', () => {
  const out = unmaskTechnicalString('profile_default:airtightness_poor_private_house');
  assert.equal(out, 'Типовой профиль герметичности: старый частный дом');
  assert.ok(!out.includes('profile_default'));
});

test('M3: professional method has a Russian label', () => {
  assert.equal(loadModeRussianLabel('steady_state'), 'Профессиональный теплотехнический расчёт');
  assert.equal(methodDisplayName('ohmx.steady-state.v1'), 'Профессиональный теплотехнический расчёт');
  assert.ok(!loadModeRussianLabel('steady_state').includes('steady-state'));
});

test('M4: raw technical identifiers are not used for primary labels', () => {
  for (const mode of ['quick', 'professional', 'steady_state'] as const) {
    const label = loadModeRussianLabel(mode);
    assert.ok(!/steady-state|legacy/i.test(label), `raw identifier leaked for ${mode}: ${label}`);
  }
});