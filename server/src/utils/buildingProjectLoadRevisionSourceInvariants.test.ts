/**
 * CM14 — SOURCE INVARIANTS (static source inspection, no runtime behavior).
 *
 * Written only (NOT executed by the agent). Run by the USER with:
 *   npm run test:building-project-load-revision
 *
 * These tests read the SOURCE of the CM14 producer and its wiring and assert
 * the CM12/CM14 architectural invariants directly (brief §36):
 *   - the producer may use node:crypto sha256 (this is the authorized phase);
 *   - NO clock/random/fs-stat/DB dependence may enter the revision input path;
 *   - NO Adapter / Configurator / Matcher / catalog-provider / client imports;
 *   - protected areas are untouched (adapter sources still carry their frozen
 *     CM11 shape — probed by sentinel strings, not by modification).
 *
 * IMPORTANT: comment false-positives are avoided by stripping `//` line
 * comments and `/* block comments *​/` before pattern matching, and by
 * requiring each hit to sit OUTSIDE string literals on its line.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UTILS = path.join(HERE);
const SERVER = path.join(UTILS, '..', '..');

const PRODUCER = path.join(UTILS, 'buildingProjectLoadRevision.ts');
const SERVICE = path.join(UTILS, 'buildingProjectService.ts');
const TYPES = path.join(UTILS, 'buildingProjectTypes.ts');

/** Strip comments (line + block) but KEEP string literals: import specifiers,
 * token prefixes and frozen literals are themselves strings, and the forbidden
 * patterns are prose-proof because comments are removed. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/^\s*\/\/.*$/gm, ' '); // full-line comments
}

function read(p: string): string { return fs.readFileSync(p, 'utf8'); }

function assertForbidden(source: string, pattern: RegExp, label: string): void {
  const code = codeOf(source);
  const hit = code.match(pattern);
  assert.equal(
    hit,
    null,
    `${label}: forbidden pattern ${pattern} found in CODE at "${hit?.[0]}"`,
  );
}

function assertRequired(source: string, pattern: RegExp, label: string): void {
  const code = codeOf(source);
  assert.match(code, pattern, `${label}: required pattern ${pattern} missing`);
}

// ===========================================================================
// Producer purity (CM14 §36)
// ===========================================================================

describe('CM14-S producer source purity', () => {
  const producer = read(PRODUCER);

  test('CM14-S01 producer exists as the isolated CM14 module', () => {
    assert.ok(fs.existsSync(PRODUCER), 'missing server/src/utils/buildingProjectLoadRevision.ts');
  });

  test('CM14-S02 producer imports node:crypto only for createHash', () => {
    const code = codeOf(producer);
    const cryptoImports = code.match(/from\s+"node:crypto"/g) ?? [];
    assert.equal(cryptoImports.length, 1);
    assert.match(code, /import\s*\{\s*createHash\s*\}\s*from\s+"node:crypto"/);
    // No other crypto surface (random, keys, hmac, cipher...) anywhere in code:
    assert.equal(code.match(/\b(randomBytes|randomUUID|generateKeyPair|createHmac|createCipheriv|pbkdf2|scrypt)\b/), null);
  });

  test('CM14-S03 no clock dependence in producer code', () => {
    assertForbidden(producer, /\bDate\.now\b/, 'clock');
    assertForbidden(producer, /\bnew Date\b/, 'clock');
    assertForbidden(producer, /\bperformance\.now\b/, 'clock');
    assertForbidden(producer, /\bprocess\.hrtime\b/, 'clock');
  });

  test('CM14-S04 no randomness in producer code', () => {
    assertForbidden(producer, /\bMath\.random\b/, 'random');
    assertForbidden(producer, /\brandomUUID\b/, 'random');
    assertForbidden(producer, /\brandomBytes\b/, 'random');
  });

  test('CM14-S05 no fs/stat/mtime identity inputs', () => {
    assertForbidden(producer, /\bfs\b\./, 'fs');
    assertForbidden(producer, /\bstatSync\b/, 'fs');
    assertForbidden(producer, /\bfstatSync\b/, 'fs');
    assertForbidden(producer, /\bmtimeMs?\b/, 'fs');
  });

  test('CM14-S06 no SQLite / better-sqlite3 / PRAGMA in producer', () => {
    assertForbidden(producer, /\bbetter-sqlite3\b/, 'sqlite');
    assertForbidden(producer, /\bsqlite3\b/, 'sqlite');
    assertForbidden(producer, /\bPRAGMA\b/i, 'sqlite');
    assertForbidden(producer, /\bdata_version\b/, 'sqlite');
  });

  test('CM14-S07 no Adapter / Configurator / Matcher entry calls', () => {
    assertForbidden(producer, /\bbuildEngineeringConfiguratorInput\b/, 'adapter');
    assertForbidden(producer, /\bconfigureHeatPumpFanCoil\b/, 'configurator');
    assertForbidden(producer, /\bmatchCatalogProducts\b/, 'matcher');
  });

  test('CM14-S08 no engineering-catalog-state token produced here (CM15 boundary)', () => {
    assertForbidden(producer, /engineering-catalog-state:sha256/, 'catalog provider');
    assertForbidden(producer, /\bEngineeringCatalogStateProvider\b/, 'catalog provider');
  });

  test('CM14-S09 no client imports', () => {
    assertForbidden(producer, /\bfrom\s+"[^"]*client\b/, 'client');
    assertForbidden(producer, /\bfrom\s+'[^']*client\b/, 'client');
  });

  test('CM14-S10 no network / DB in producer', () => {
    assertForbidden(producer, /\bfetch\s*\(/, 'network');
    assertForbidden(producer, /\bXMLHttpRequest\b/, 'network');
    assertForbidden(producer, /\bhttp\.request\b/, 'network');
    assertForbidden(producer, /\baxios\b/, 'network');
  });

  test('CM14-S11 hash is exactly SHA-256, lowercase hex, no digest options', () => {
    const code = codeOf(producer);
    assert.match(code, /createHash\("sha256"\)/);
    assert.equal(code.match(/createHash\(/g)?.length, 1);
    assert.match(code, /\.digest\("hex"\)/);
    assert.equal(code.match(/\.digest\(/g)?.length, 1);
  });

  test('CM14-S12 token literal built from the frozen prefix + 64-hex guard', () => {
    const code = codeOf(producer);
    assert.match(code, /load:sha256:\$\{digest\}/);
    assert.match(code, /\^\[0-9a-f\]\{64\}\$/);
  });

  test('CM14-S13 algorithm identity is imported from the frozen CM11 constant (not re-invented)', () => {
    const code = codeOf(producer);
    assert.match(code, /LOAD_CANONICAL_ALGORITHM_VERSION/);
    assert.match(code, /export const LOAD_REVISION_ALGORITHM_VERSION\s*=\s*LOAD_CANONICAL_ALGORITHM_VERSION/);
  });

  test('CM14-S14 canonical projection is imported from CM11, never re-implemented', () => {
    const code = codeOf(producer);
    assert.match(code, /import\s*\{\s*projectCanonicalLoadFacts\s*\}\s*from\s+"\.\/buildingProjectConfiguratorAdapter\/loadRevision\.js"/);
    // The producer calls CM11's projection:
    assert.match(code, /return\s+projectCanonicalLoadFacts\(/);
  });

  test('CM14-S15 -0 normalization reuses the frozen CM11 canonicalNumber policy', () => {
    const code = codeOf(producer);
    // The only -0 handling is the frozen `value === 0 ? 0` identity; no new policy text:
    assert.match(code, /value === 0 \? 0 : value/);
    assert.equal(code.match(/Object\.is\(/g), null);
  });

  test('CM14-S16 eligibility gate pins the frozen steady_state identity', () => {
    const code = codeOf(producer);
    assert.match(code, /load\.mode !== "steady_state"/);
    assert.match(code, /load\.status !== "calculated"/);
    assert.match(code, /load\.methodId !== "ohmx\.steady-state\.v1"/);
    assert.match(code, /load\.methodVersion !== "1\.0\.0"/);
    assert.match(code, /!\s*load\.engineeringQuality/);
  });

  test('CM14-S17 sourceCalculationId is assigned exactly once, equal to the revision', () => {
    const code = codeOf(producer);
    assert.match(code, /sourceCalculationId:\s*revision,\s*\/\/\s*CM12 §17/);
  });

  test('CM14-S18 attach mutates only the load result (never project/store/save)', () => {
    const code = codeOf(producer);
    assert.match(code, /export function attachLoadCalculationRevision\(/);
    assert.equal(code.match(/\bsaveProject\b/g), null);
    assert.equal(code.match(/\bwriteFileSync\b/g), null);
  });
});

// ===========================================================================
// Wiring invariants (service + types)
// ===========================================================================

describe('CM14-S wiring invariants', () => {
  const service = read(SERVICE);
  const types = read(TYPES);

  test('CM14-S19 service imports only the three producer functions', () => {
    const code = codeOf(service);
    assert.match(code, /import\s*\{\s*attachLoadCalculationRevision,\s*isLoadRevisionEligible,\s*produceLoadCalculationRevision,\s*\}\s*from\s*'\.\/buildingProjectLoadRevision\.js'/);
  });

  test('CM14-S20 service attaches identity only after facts are final, before save', () => {
    const code = codeOf(service);
    const attach = code.indexOf('attachLoadCalculationRevision(project.loads, production)');
    const save = code.indexOf('saveProject(project);', code.indexOf('const numericResult'));
    assert.ok(attach > -1, 'attach call missing');
    assert.ok(attach < save, 'identity must be attached BEFORE persistence');
  });

  test('CM14-S21 service gates attach on eligibility (no unconditional hashing)', () => {
    const code = codeOf(service);
    assert.match(code, /if\s*\(isLoadRevisionEligible\(project\.loads\)\)\s*\{\s*const production = produceLoadCalculationRevision\(project, project\.loads\);/s);
  });

  test('CM14-S22 DTO declares both identity fields as optional (legacy-safe)', () => {
    const code = codeOf(types);
    assert.match(code, /loadCalculationRevision\?:\s*string;/);
    assert.match(code, /sourceCalculationId\?:\s*string;/);
  });

  test('CM14-S23 read path never fabricates identity (no hashing in service load path)', () => {
    const code = codeOf(service);
    // The only producer calls sit behind the eligibility gate in the calculate path:
    const produceCalls = code.match(/produceLoadCalculationRevision\(/g) ?? [];
    assert.equal(produceCalls.length, 1);
    assert.equal(code.match(/loadRevisionFromPersisted|recomputeRevisionOnRead|ensureRevisionOnRead/g), null);
  });
});

// ===========================================================================
// Protected-area sentinels (CM14 §40) — read-only probes, no modification
// ===========================================================================

describe('CM14-S protected areas untouched', () => {
  const adapterLoad = path.join(UTILS, 'buildingProjectConfiguratorAdapter', 'loadRevision.ts');
  const adapterTypes = path.join(UTILS, 'buildingProjectConfiguratorAdapter', 'types.ts');
  const adapterPolicy = path.join(UTILS, 'buildingProjectConfiguratorAdapter', 'policy.ts');
  const adapterBuild = path.join(UTILS, 'buildingProjectConfiguratorAdapter', 'buildEngineeringConfiguratorInput.ts');

  test('CM14-S24 CM11 adapter files still exist', () => {
    for (const f of [adapterLoad, adapterTypes, adapterPolicy, adapterBuild]) {
      assert.ok(fs.existsSync(f), `missing protected file ${f}`);
    }
  });

  test('CM14-S25 CM11 projection still carries the frozen allowlist (sentinel)', () => {
    const code = codeOf(read(adapterLoad));
    assert.match(code, /export function projectCanonicalLoadFacts\(/);
    assert.match(code, /inputSnapshot:\s*\{/);
    assert.match(code, /requestedServices:\s*\["heating",\s*"cooling"\]/);
  });

  test('CM14-S26 CM11 frozen literals unchanged (sentinels)', () => {
    const code = codeOf(read(adapterTypes));
    assert.match(code, /"ohmx\.building-project-load-canonical-json\.v1"/);
    assert.match(code, /LOAD_REVISION_PREFIX\s*=\s*"load:sha256:"/);
  });

  test('CM14-S27 CM11 validation entry points unchanged (sentinels)', () => {
    const code = codeOf(read(adapterLoad));
    assert.match(code, /export function validateLoadRevisionReference\(/);
    assert.match(code, /export function validateEngineeringCatalogReference\(/);
  });

  test('CM14-S28 adapter never imports the CM14 producer (CM11 stays independent)', () => {
    const dir = path.join(UTILS, 'buildingProjectConfiguratorAdapter');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.ts')) continue;
      const code = codeOf(read(path.join(dir, name)));
      assert.equal(
        code.match(/buildingProjectLoadRevision/),
        null,
        `${name} must not import the CM14 producer`,
      );
    }
  });

  test('CM14-S29 catalog matcher + configurator dirs make no reference to CM14', () => {
    const cmDir = path.join(UTILS, 'catalogMatcher');
    const cfgDir = path.join(UTILS, 'engineeringConfigurator');
    for (const dir of [cmDir, cfgDir]) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.ts')) continue;
        const code = codeOf(read(path.join(dir, name)));
        assert.equal(code.match(/buildingProjectLoadRevision/), null, `${name} must not reference CM14`);
      }
    }
  });

  test('CM14-S30 no CM14 symbols leaked into routes or sqlite schema', () => {
    const routesDir = path.join(SERVER, 'src', 'routes');
    for (const name of fs.readdirSync(routesDir)) {
      if (!name.endsWith('.ts')) continue;
      const code = codeOf(read(path.join(routesDir, name)));
      assert.equal(code.match(/loadCalculationRevision|buildingProjectLoadRevision/), null, `${name} must stay CM14-free`);
    }
    const schema = path.join(SERVER, 'data', 'schema.sql');
    if (fs.existsSync(schema)) {
      assert.equal(codeOf(read(schema)).match(/load_calculation_revision/), null, 'schema.sql must stay untouched');
    }
  });
});

// ===========================================================================
// Package wiring (CM14 §38)
// ===========================================================================

describe('CM14-S package script', () => {
  test('CM14-S31 focused test script exists and names both CM14 test files', () => {
    const pkg = JSON.parse(read(path.join(SERVER, 'package.json'))) as { scripts: Record<string, string> };
    const script = pkg.scripts['test:building-project-load-revision'];
    assert.ok(script, 'missing test:building-project-load-revision');
    assert.match(script, /buildingProjectLoadRevision\.test\.ts/);
    assert.match(script, /buildingProjectLoadRevisionSourceInvariants\.test\.ts/);
    assert.match(script, /tsx --test/);
  });

  test('CM14-S32 no full-test script was repointed', () => {
    const pkg = JSON.parse(read(path.join(SERVER, 'package.json'))) as { scripts: Record<string, string> };
    assert.ok(pkg.scripts['test:engineering-selection-persistence']?.includes('buildingProjectEngineeringSelection.test.ts'));
  });
});
