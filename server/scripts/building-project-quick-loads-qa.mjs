#!/usr/bin/env node
/**
 * OhmX Building Project — QUICK v1 loads regression QA baseline.
 *
 * Read-only, in-memory: imports the pure QUICK engine and the vendored climate
 * dataset, runs the canonical scenario + sensitivity matrix, and prints a
 * deterministic PASS/FAIL summary. No build, no test runner, no network, no
 * writes to the project store.
 *
 * Run:
 *   node server/scripts/building-project-quick-loads-qa.mjs
 * (requires Node with native TypeScript type-stripping, >= v22.18 / v23.)
 *
 * This baseline documents the QUICK v1 method as-is. Changing a QUICK coefficient
 * or formula MUST update the corresponding expectations here with an explicit
 * old/new/reason note — never silently re-green the baseline.
 */

const ENGINE = new URL('../src/utils/buildingProjectQuickLoadV1.ts', import.meta.url).href;
const eng = await import(ENGINE);
const ds = eng.loadClimateDataset();
const loc = (id) => ds.locations.find((l) => l.id === id);

function room(o = {}) {
  return {
    id: 'r1', roomType: o.type ?? 'living_room', name: o.type ?? 'living_room',
    areaM2: o.area ?? 20,
    extras: {
      geometry: {
        ceilingHeightM: o.height ?? 2.7,
        externalWallCount: o.walls ?? 1,
        floorPosition: o.floor ?? 'intermediate',
      },
      windows: { glazingType: o.glazing ?? 'standard', count: null, areaM2: null },
      insulationOverride: o.insulation ?? null,
      conditions: o.conditions ?? [],
      engineeringUse: 'stored_only',
    },
  };
}
function project(o = {}) {
  return {
    id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '',
    objectConfirmedAt: 'x', objectConfirmedRevision: 1, buildingRevision: 1,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: null, defaultCeilingHeightM: o.ceil ?? 2.7,
    insulationLevel: o.insulation ?? 'medium', topology: null, rooms: [],
    selectedSystems: [], systemsRevision: 1, systemsConfiguration: null,
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}
const YEREVAN = loc('yerevan-agro');
const calc = (p, r, l = YEREVAN) => ({
  heat: eng.computeQuickHeating(p, r, l),
  cool: eng.computeQuickCooling(p, r, l),
});
const r1 = (n) => Math.round(n);

let pass = 0, fail = 0;
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

console.log('=== 1. Fixture verification (exact) ===');
{
  const syn = { ...YEREVAN, heatingOutdoorDesignC: -10, coolingOutdoorDesignC: 35 };
  const { heat, cool } = calc(project(), room({ area: 20 }), syn);
  check('QL-14 heating 1215 W', r1(heat.demandW) === 1215, `${r1(heat.demandW)} W`);
  check('QL-15 cooling 2000 W', r1(cool.demandW) === 2000, `${r1(cool.demandW)} W`);
}

console.log('\n=== 2. Sensitivity (direction) ===');
{
  const p = project();
  const base = calc(p, room({ area: 20 }));
  const areaUp = calc(p, room({ area: 30 }));
  const heightUp = calc(p, room({ area: 20, height: 3.2 }));
  const poor = calc(project({ insulation: 'poor' }), room({ area: 20 }));
  const pano = calc(p, room({ area: 20, glazing: 'panoramic' }));
  const cold = calc(p, room({ area: 20 }), loc('gyumri'));
  const hot = calc(p, room({ area: 20 }), { ...YEREVAN, coolingOutdoorDesignC: 40 }); // synthetic hot (real dataset tops out at 33°C)
  check('area + -> heating +', areaUp.heat.demandW > base.heat.demandW);
  check('area + -> cooling +', areaUp.cool.demandW > base.cool.demandW);
  check('height + -> heating +', heightUp.heat.demandW > base.heat.demandW);
  check('height + -> cooling +', heightUp.cool.demandW > base.cool.demandW);
  check('worse insulation -> heating +', poor.heat.demandW > base.heat.demandW);
  check('worse insulation -> cooling +', poor.cool.demandW > base.cool.demandW);
  check('bigger glazing -> heating +', pano.heat.demandW > base.heat.demandW);
  check('bigger glazing -> cooling +', pano.cool.demandW > base.cool.demandW);
  check('colder climate -> heating +', cold.heat.demandW > base.heat.demandW);
  check('hotter climate -> cooling +', hot.cool.demandW > base.cool.demandW);
  // Specific-load sanity band (outlier warning range 30..200 W/m²).
  check('heating specific load in [30,200]', base.heat.specificLoadWm2 >= 30 && base.heat.specificLoadWm2 <= 200, `${r1(base.heat.specificLoadWm2)} W/m2`);
  check('cooling specific load in [30,200]', base.cool.specificLoadWm2 >= 30 && base.cool.specificLoadWm2 <= 200, `${r1(base.cool.specificLoadWm2)} W/m2`);
}

console.log('\n=== 3. Input-safety (no silent NaN / no fabricated zero) ===');
{
  // Non-integer external wall count must NOT silently produce NaN.
  const r = room({ area: 20 }); r.extras.geometry.externalWallCount = 1.5;
  const { heat, cool } = calc(project(), r);
  check('non-integer wallCount -> finite heating (no NaN)', Number.isFinite(heat.demandW), `${heat.demandW} W`);
  check('non-integer wallCount -> finite cooling (no NaN)', Number.isFinite(cool.demandW), `${cool.demandW} W`);
  check('non-integer wallCount -> warning emitted', heat.warnings.includes('external_wall_count_not_provided'));
  // Missing area -> missing_input (null), never 0 W.
  const noArea = room({ area: 20 });
  noArea.areaM2 = null;
  const res = eng.quickServiceResult('heating', noArea, project(), YEREVAN);
  check('missing area -> missing_input (null, not 0)', res.result.status === 'missing_input' && res.result.demandW === null);
}

console.log('\n=== 4. Scenario matrix (expected direction) ===');
{
  const p = project();
  // Well-insulated < poorly-insulated heating, at equal area/geometry.
  const good = calc(project({ insulation: 'good' }), room({ area: 20 }));
  const poor = calc(project({ insulation: 'poor' }), room({ area: 20 }));
  check('good insulation heating < poor insulation heating', good.heat.demandW < poor.heat.demandW,
    `${r1(good.heat.demandW)} < ${r1(poor.heat.demandW)}`);
  // Interior room (0 ext walls) < corner (2 ext walls), heating.
  const interior = calc(p, room({ area: 20, walls: 0 }));
  const corner = calc(p, room({ area: 20, walls: 2 }));
  check('interior heating < corner heating', interior.heat.demandW < corner.heat.demandW,
    `${r1(interior.heat.demandW)} < ${r1(corner.heat.demandW)}`);
  // Roof/top floor cooling > intermediate (top factor 1.1).
  const intermediate = calc(p, room({ area: 20, floor: 'intermediate' }));
  const top = calc(p, room({ area: 20, floor: 'top' }));
  check('top-floor cooling > intermediate cooling', top.cool.demandW > intermediate.cool.demandW,
    `${r1(top.cool.demandW)} > ${r1(intermediate.cool.demandW)}`);
}

console.log('\n=== 5. Documented limitations (INFORMATIONAL, not FAIL) ===');
{
  // Occupancy / internal gains are NOT modeled: cooling is identical regardless.
  const a = calc(project(), room({ area: 20 }));
  const b = calc(project(), room({ area: 20 })); // no occupancy input exists in the model
  console.log(`INFO   occupancy has no effect on cooling (${r1(a.cool.demandW)} W == ${r1(b.cool.demandW)} W) — not modeled`);
  // Cooling climate factor flatness across stations.
  const vals = new Set(ds.locations.map((l) => Math.min(1.25, Math.max(0.8, (l.coolingOutdoorDesignC - 24) / 11))));
  console.log(`INFO   cooling kClimate distinct values across 29 stations: ${[...vals].sort().map((v) => v.toFixed(3)).join(', ')} (only 2 → climate-insensitive)`);
}

console.log(`\n=== SUMMARY: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
