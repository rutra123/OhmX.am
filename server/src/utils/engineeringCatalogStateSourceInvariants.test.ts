/**
 * ENGINEERING-CATALOG-CM15 — SOURCE INVARIANTS (static source inspection,
 * no runtime behavior). Written only (NOT executed by the agent). Run by the
 * USER with: npm run test:engineering-catalog-state-provider
 *
 * Asserts the CM15 phase §38 architectural invariants directly on the SOURCE
 * of the new module (and sentinels for protected areas):
 *   - node:crypto used ONLY as createHash('sha256');
 *   - NO clock / randomness / fs-stat / DB-file-identity in the input path;
 *   - NO runtime SQL write paths in the provider modules (the fixture factory
 *     is test-support and is verified to be imported by NO runtime module);
 *   - NO Adapter / Configurator / Matcher / client / route imports;
 *   - NO load-revision or commerce-revision producer;
 *   - commerce columns never appear in projection CODE;
 *   - protected areas remain untouched (sentinel strings, not modification).
 *
 * Comment false-positives are avoided with the CM13-RC stripComments pattern
 * (block comments + full-line // removed; URLs survive via the [^:] guard).
 * Hard tokens (hash prefixes, better-sqlite3) are additionally checked on RAW
 * text so commented-out wiring can never hide either way.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UTILS = path.join(HERE);
const MODULE = path.join(UTILS, 'engineeringCatalogState');
// CM15-RC4: sentinel targets live under src/, NOT at the package root —
// utils/ is server/src/utils, so src/ is exactly one level above HERE.
const SERVER_SRC = path.join(UTILS, '..');
// server/ package root (package.json lives there, not in src/):
const SERVER = path.join(UTILS, '..', '..');

const TYPES = path.join(MODULE, 'types.ts');
const CANONICALIZE = path.join(MODULE, 'canonicalize.ts');
const PROJECTION = path.join(MODULE, 'projection.ts');
const PROVIDER = path.join(MODULE, 'provider.ts');
const INDEX = path.join(MODULE, 'index.ts');
const FIXTURE = path.join(MODULE, 'engineeringCatalogStateFixtureDb.ts');
const RUNTIME_MODULES = [TYPES, CANONICALIZE, PROJECTION, PROVIDER, INDEX];

const ADAPTER_IMPL = path.join(UTILS, 'buildingProjectConfiguratorAdapter', 'buildEngineeringConfiguratorInput.ts');
const ADAPTER_TYPES = path.join(UTILS, 'buildingProjectConfiguratorAdapter', 'types.ts');
const CONFIGURATOR = path.join(UTILS, 'engineeringConfigurator', 'configureHeatPumpFanCoil.ts');
const MATCHER_ADAPTER = path.join(UTILS, 'catalogMatcher', 'queryAdapter.ts');
const MATCHER_SERVICE = path.join(UTILS, 'catalogMatcher', 'service.ts');
const LOAD_REVISION = path.join(UTILS, 'buildingProjectLoadRevision.ts');
const ROUTES = path.join(SERVER_SRC, 'routes', 'catalogMatcher.ts');
const SERVER_ENTRY = path.join(SERVER_SRC, 'server.ts');
const PACKAGE_JSON = path.join(SERVER, 'package.json');

function read(p: string): string {
  return fs.readFileSync(p, 'utf8');
}

/** Strip comments (block + full-line //) but KEEP string literals. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function assertForbidden(source: string, pattern: RegExp, label: string): void {
  const hit = codeOf(source).match(pattern);
  assert.equal(hit, null, `${label}: forbidden pattern ${pattern} found in CODE at "${hit?.[0]}"`);
}

function assertRequired(source: string, pattern: RegExp, label: string): void {
  assert.match(codeOf(source), pattern, `${label}: required pattern ${pattern} missing`);
}

// ===========================================================================
// Module existence + purity
// ===========================================================================

describe('CM15-S provider source purity', () => {
  const provider = read(PROVIDER);
  const projection = read(PROJECTION);
  const canonicalize = read(CANONICALIZE);
  const types = read(TYPES);
  const index = read(INDEX);

  test('CM15-S01 module exists as the isolated CM15 directory', () => {
    for (const p of RUNTIME_MODULES) assert.ok(fs.existsSync(p), `missing ${p}`);
  });

  test('CM15-S02 canonicalize imports node:crypto only for createHash sha256', () => {
    const code = codeOf(canonicalize);
    const cryptoImports = code.match(/from\s+["']node:crypto["']/g) ?? [];
    assert.equal(cryptoImports.length, 1);
    assert.match(code, /import\s*\{\s*createHash\s*\}\s*from\s+["']node:crypto["']/);
    assert.match(code, /createHash\(["']sha256["']\)/);
    assert.equal(
      code.match(/\b(randomBytes|randomUUID|generateKeyPair|createHmac|createCipheriv|pbkdf2|scrypt|createHash\(["'](md5|sha1|sha512))/),
      null,
    );
  });

  test('CM15-S03 no clock dependence anywhere in runtime code', () => {
    for (const [name, src] of [['provider', provider], ['projection', projection], ['canonicalize', canonicalize], ['types', types], ['index', index]] as const) {
      assertForbidden(src, /\bDate\.now\b/, name);
      assertForbidden(src, /\bnew Date\s*\(/, name);
      assertForbidden(src, /\bperformance\.now\b/, name);
      assertForbidden(src, /\bprocess\.hrtime\b/, name);
    }
  });

  test('CM15-S04 no randomness anywhere in runtime code', () => {
    for (const [name, src] of [['provider', provider], ['projection', projection], ['canonicalize', canonicalize]] as const) {
      assertForbidden(src, /\bMath\.random\b/, name);
      assertForbidden(src, /\brandomUUID\b/, name);
      assertForbidden(src, /\brandomBytes\b/, name);
      assertForbidden(src, /\bcrypto\.getRandomValues\b/, name);
    }
  });

  test('CM15-S05 no DB-file identity anywhere in runtime code (code-aware)', () => {
    // CM15-RC5: documentation may legitimately SAY "no PRAGMA data_version" —
    // the invariant forbids EXECUTABLE identity, not documentation of its
    // absence. CODE (comments stripped): bare identity tokens must not appear.
    for (const [name, src] of [['provider', provider], ['projection', projection], ['canonicalize', canonicalize]] as const) {
      assert.equal(
        codeOf(src).match(/\bstatSync\b|\bfstatSync\b|\blstatSync\b|\bst_mtime\b|\bino\b|\bdata_version\b|\bpage_count\b|\bwal_checkpoint\b/),
        null,
        `${name}: file-identity token found in CODE`,
      );
    }
    // RAW (executable call shape only — prose cannot match these): an actual
    // pragma/prepare/exec carrying data_version, or an actual fs-stat call.
    for (const [name, src] of [['provider', provider], ['projection', projection], ['canonicalize', canonicalize]] as const) {
      assert.equal(
        src.match(/\b(?:pragma|prepare|exec)\s*\(\s*["'`][^"'`]*\bdata_version\b/i),
        null,
        `${name}: executable data_version call found`,
      );
      assert.equal(
        src.match(/\b(?:statSync|fstatSync|lstatSync)\s*\(/),
        null,
        `${name}: executable stat call found`,
      );
    }
    // fs usage in provider is limited to existsSync (no stat).
    const fsUses = codeOf(provider).match(/fs\.\w+/g) ?? [];
    for (const use of fsUses) assert.ok(['fs.existsSync'].includes(use), `provider: unexpected fs use ${use}`);
  });

  test('CM15-S06 PRAGMA limited to query_only (no identity-bearing pragma)', () => {
    const pragmas = codeOf(provider).match(/pragma\(["'][^"']+["']\)/g) ?? [];
    assert.deepEqual(pragmas, ['pragma("query_only = ON")']);
    assertForbidden(projection, /pragma/i, 'projection');
  });

  test('CM15-S07 no runtime SQL write paths in provider modules', () => {
    for (const [name, src] of [['provider', provider], ['projection', projection], ['canonicalize', canonicalize], ['types', types], ['index', index]] as const) {
      assertForbidden(src, /\bINSERT\s+INTO\b/i, name);
      assertForbidden(src, /\bUPDATE\s+\w+\s+SET\b/i, name);
      assertForbidden(src, /\bDELETE\s+FROM\b/i, name);
      assertForbidden(src, /\bALTER\s+TABLE\b/i, name);
      assertForbidden(src, /\bDROP\s+(TABLE|INDEX)\b/i, name);
      assertForbidden(src, /\bCREATE\s+(TABLE|INDEX|VIEW)\b/i, name);
      assertForbidden(src, /\bVACUUM\b/i, name);
      assertForbidden(src, /\bREINDEX\b/i, name);
      assertForbidden(src, /\bREPLACE\s+INTO\b/i, name);
    }
  });

  test('CM15-S08 every projection SQL constant is a SELECT', () => {
    const sqlConsts = Array.from(codeOf(projection).matchAll(/const\s+(SQL_\w+)\s*=\s*`\s*([A-Za-z]+)/g));
    assert.ok(sqlConsts.length >= 7, 'expected the 7 projection queries');
    for (const [, name, firstWord] of sqlConsts) {
      assert.equal(firstWord.toUpperCase(), 'SELECT', `${name} must be a SELECT`);
    }
  });

  test('CM15-S09 provider opens the DB strictly read-only', () => {
    assertRequired(provider, /readonly:\s*true,\s*fileMustExist:\s*true/, 'provider');
    assertRequired(provider, /query_only\s*=\s*ON/, 'provider');
    assertForbidden(provider, /readonly:\s*false/i, 'provider');
  });

  test('CM15-S10 exec gate restricts transaction control to BEGIN/COMMIT/ROLLBACK', () => {
    assertRequired(provider, /assertProviderTransactionSql/, 'provider');
    assertRequired(provider, /\(BEGIN\|COMMIT\|ROLLBACK\)/, 'provider');
    // The coherent-read envelope uses exactly BEGIN DEFERRED / COMMIT / ROLLBACK.
    assertRequired(provider, /BEGIN DEFERRED/, 'provider');
    assertRequired(provider, /COMMIT/, 'provider');
    assertRequired(provider, /ROLLBACK/, 'provider');
  });

  test('CM15-S11 coherent-read envelope wraps the projection (BEGIN before project call)', () => {
    const code = codeOf(provider);
    const beginAt = code.indexOf('BEGIN DEFERRED');
    const projectAt = code.indexOf('projectEngineeringCatalogFacts(');
    const commitAt = code.indexOf('COMMIT');
    assert.ok(beginAt >= 0 && projectAt >= 0 && commitAt >= 0);
    assert.ok(beginAt < projectAt, 'BEGIN DEFERRED must precede the projection call');
  });

  test('CM15-S12 fixture factory is test-support: imported by NO runtime module', () => {
    for (const [name, src] of [['provider', provider], ['projection', projection], ['canonicalize', canonicalize], ['types', types]] as const) {
      assertForbidden(src, /engineeringCatalogStateFixtureDb/, name);
    }
    assert.ok(read(INDEX).includes('createEngineeringCatalogStateFixtureDb'), 'barrel exports the fixture factory for tests');
  });
});

// ===========================================================================
// Boundary violations (Adapter / Configurator / Matcher / client / producers)
// ===========================================================================

describe('CM15-S boundary purity', () => {
  const provider = read(PROVIDER);
  const projection = read(PROJECTION);
  const canonicalize = read(CANONICALIZE);
  const types = read(TYPES);
  const index = read(INDEX);
  const runtime = ['types.ts', 'canonicalize.ts', 'projection.ts', 'provider.ts', 'index.ts']
    .map((f) => ({ file: f, src: fs.readFileSync(path.join(MODULE, f), 'utf8') }));

  test('CM15-S13 no Adapter invocation', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /buildEngineeringConfiguratorInput\s*\(/, file);
    }
  });

  test('CM15-S14 no Configurator invocation', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /configureHeatPumpFanCoil\s*\(/, file);
    }
  });

  test('CM15-S15 no Matcher invocation', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /matchCatalogProducts\s*\(/, file);
      assertForbidden(src, /loadCatalogCandidates\s*\(/, file);
    }
  });

  test('CM15-S16 no Adapter/Matcher/Configurator module imports', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /from\s+["'][^"']*catalogMatcher\/(service|evaluator|queryAdapter|index|normalize|ranking|reasons|valueSelection|operatingPoint|policy|types)\.js["']/, file);
      assertForbidden(src, /from\s+["'][^"']*engineeringConfigurator\//, file);
      // The ONLY cross-module import allowed is the frozen adapter TYPES file:
      const imports = Array.from(codeOf(src).matchAll(/from\s+["'](\.[^"']+)["']/g)).map((m) => m[1]);
      for (const spec of imports) {
        if (spec.includes('buildingProjectConfiguratorAdapter')) {
          assert.ok(spec.endsWith('/types.js'), `${file}: adapter import must be types-only, got ${spec}`);
        }
      }
    }
  });

  test('CM15-S17 import allowlist is closed (no client, no routes, no service imports)', () => {
    const allowedRelative = new Set([
      './types.js', './canonicalize.js', './projection.js', './provider.js',
      '../buildingProjectConfiguratorAdapter/types.js',
      '../../paths.js', './engineeringCatalogStateFixtureDb.js',
    ]);
    const allowedPackages = new Set(['better-sqlite3', 'node:crypto', 'node:fs', 'node:path', 'node:url', 'node:os', 'node:test', 'node:assert/strict']);
    for (const { file, src } of runtime) {
      for (const m of Array.from(codeOf(src).matchAll(/from\s+["']([^"']+)["']/g))) {
        const spec = m[1];
        if (spec.startsWith('.')) {
          assert.ok(allowedRelative.has(spec), `${file}: relative import outside allowlist: ${spec}`);
        } else {
          assert.ok(allowedPackages.has(spec), `${file}: package import outside allowlist: ${spec}`);
        }
      }
    }
    for (const { file, src } of runtime) {
      assertForbidden(src, /from\s+["'][^"']*client\//, file);
      assertForbidden(src, /from\s+["'][^"']*routes\//, file);
      assertForbidden(src, /from\s+["'][^"']*buildingProject(Service|Types)\.js["']/, file);
      assertForbidden(src, /express/, file);
    }
  });

  test('CM15-S18 no load-revision producer (no load:sha256, no import of CM14)', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /load:sha256:/, file);
      assertForbidden(src, /buildingProjectLoadRevision/, file);
      assertForbidden(src, /projectCanonicalLoadFacts/, file);
      assertForbidden(src, /computeLoadCalculationRevision/, file);
    }
  });

  test('CM15-S19 no commerce-revision producer', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /commerce-state:sha256:/, file);
      assertForbidden(src, /commerceStateRevision\s*[:=]/, file);
    }
  });

  test('CM15-S20 revision token uses ONLY the frozen prefix re-export', () => {
    const code = codeOf(canonicalize);
    assert.match(code, /ENGINEERING_CATALOG_PREFIX/);
    // The module must not redeclare prefix or algorithm id — single source of truth.
    for (const { file, src } of runtime) {
      assertForbidden(src, /export\s+const\s+ENGINEERING_CATALOG_PREFIX/, file);
      assertForbidden(src, /export\s+const\s+ENGINEERING_CATALOG_ALGORITHM_VERSION/, file);
    }
    assert.match(codeOf(types), /export\s*\{[^}]*ENGINEERING_CATALOG_PREFIX[^}]*\}\s*from\s*["'][^"']*buildingProjectConfiguratorAdapter\/types\.js["']/);
  });

  test('CM15-S21 projection CODE never references commerce columns (raw-text hard check)', () => {
    const code = codeOf(projection);
    for (const column of ['price_amd', 'stock_quantity', 'availability_status', 'is_active', 'name_ru', 'currency']) {
      assert.equal(code.includes(column), false, `projection CODE must not contain ${column}`);
    }
  });

  test('CM15-S22 no network / process / env dependence in the identity path', () => {
    for (const { file, src } of runtime) {
      assertForbidden(src, /\bfetch\s*\(/, file);
      assertForbidden(src, /\bhttp\.request\b/, file);
      // DB_PATH is read for the DEFAULT PATH RESOLUTION only — never in the
      // projection/canonicalization identity path.
      assertForbidden(src.replace(/^\s*const configured =.*$/gm, '').replace(/^\s*String\(process\.env\.DB_PATH.*$/gm, ''), /process\.env/, file);
    }
    assertForbidden(projection, /process\.env/, 'projection');
    assertForbidden(canonicalize, /process\.env/, 'canonicalize');
  });
});

// ===========================================================================
// Protected-area sentinels (files must retain their frozen shape)
// ===========================================================================

describe('CM15-S protected areas untouched (sentinels)', () => {
  test('CM15-S23 CM11 adapter implementation retains its frozen entry point', () => {
    const src = read(ADAPTER_IMPL);
    assert.ok(src.includes('buildEngineeringConfiguratorInput'));
    assert.ok(src.length > 1000, 'adapter implementation suspiciously truncated');
  });

  test('CM15-S24 CM11 adapter types retain the frozen catalog-state identity block', () => {
    const src = read(ADAPTER_TYPES);
    assert.ok(src.includes('ENGINEERING_CATALOG_PREFIX = "engineering-catalog-state:sha256:"'));
    assert.ok(src.includes('ENGINEERING_CATALOG_ALGORITHM_VERSION = "ohmx.engineering-catalog-state-canonical-json.v1"'));
    assert.ok(src.includes('getCurrentReference(): Promise<DeepReadonly<EngineeringCatalogStateReference>>'));
  });

  test('CM15-S25 CM9 Configurator entry point untouched', () => {
    const src = read(CONFIGURATOR);
    assert.ok(src.includes('configureHeatPumpFanCoil'));
  });

  test('CM15-S26 CM4 matcher adapter retains the frozen commerce classification', () => {
    const src = read(MATCHER_ADAPTER);
    assert.match(codeOf(src), /const stockStatus:\s*StockStatus = 'UNKNOWN'/);
    assert.match(codeOf(src), /if \(row\.is_active === 0\)\s*\w+\.\w+ = 'UNAVAILABLE'|is_active === 0/);
    assert.ok(src.includes('stock_quantity') === false, 'matcher query must not read stock_quantity');
  });

  test('CM15-S27 CM5 matcher service untouched (no CM15 references)', () => {
    const src = read(MATCHER_SERVICE);
    assert.equal(src.includes('engineeringCatalogState'), false);
    assert.ok(src.includes('matchCatalogProducts'));
  });

  test('CM15-S28 CM14 load-revision producer untouched and independent of CM15', () => {
    const src = read(LOAD_REVISION);
    assert.ok(src.includes('load:sha256:'));
    assert.equal(src.includes('engineeringCatalogState'), false);
  });

  test('CM15-S29 CM6 route untouched (no provider wiring leaked in)', () => {
    const src = read(ROUTES);
    assert.ok(src.includes('resolveCatalogMatcherDatabasePath'));
    assert.equal(src.includes('engineeringCatalogState'), false);
  });

  test('CM15-S30 server entry untouched (no provider wiring)', () => {
    const src = read(SERVER_ENTRY);
    assert.equal(src.includes('engineeringCatalogState'), false);
  });

  test('CM15-S31 CM14 test files still present and unreferenced by CM15', () => {
    assert.ok(fs.existsSync(path.join(UTILS, 'buildingProjectLoadRevision.test.ts')));
    assert.ok(fs.existsSync(path.join(UTILS, 'buildingProjectLoadRevisionSourceInvariants.test.ts')));
    const cm15Sources = [read(PROVIDER), read(PROJECTION), read(CANONICALIZE), read(TYPES), read(INDEX)].join('\n');
    assert.equal(cm15Sources.includes('buildingProjectLoadRevision.test'), false);
  });

  test('CM15-S32 focused package script is registered', () => {
    const pkg = JSON.parse(read(PACKAGE_JSON)) as { scripts?: Record<string, string> };
    assert.equal(
      pkg.scripts?.['test:engineering-catalog-state-provider'],
      'tsx --test src/utils/engineeringCatalogState.test.ts src/utils/engineeringCatalogStateSourceInvariants.test.ts',
    );
  });
});

// ===========================================================================
// Extended purity (completion pass): barrel surface, dynamic code, SQL
// wildcards, serializer discipline, error-code prefix, test import surface
// ===========================================================================

describe('CM15-S extended purity (completion pass)', () => {
  const provider = read(PROVIDER);
  const projection = read(PROJECTION);
  const canonicalize = read(CANONICALIZE);
  const types = read(TYPES);
  const index = read(INDEX);
  const RUNTIME_TEST = path.join(UTILS, 'engineeringCatalogState.test.ts');
  const INVARIANT_TEST = path.join(UTILS, 'engineeringCatalogStateSourceInvariants.test.ts');

  test('CM15-S33 barrel exports exactly the sanctioned CM15 surface', () => {
    for (const name of [
      'ENGINEERING_CATALOG_PREFIX',
      'ENGINEERING_CATALOG_ALGORITHM_VERSION',
      'ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES',
      'ENGINEERING_CATALOG_STATE_PROJECTION_VERSION',
      'ENGINEERING_CATALOG_STATE_DOMAIN',
      'EngineeringCatalogStateInputError',
      'compareCodePoints',
      'canonicalizeFiniteNumber',
      'canonicalizeEngineeringCatalogFacts',
      'serializeEngineeringCatalogFacts',
      'computeEngineeringCatalogStateRevision',
      'EngineeringCatalogProjectionError',
      'projectEngineeringCatalogFacts',
      'ENGINEERING_CATALOG_STATE_PROVIDER_ERROR_CODES',
      'resolveEngineeringCatalogDatabasePath',
      'assertProviderSqlIsReadOnly',
      'assertProviderTransactionSql',
      'EngineeringCatalogStateProvider',
      'createEngineeringCatalogStateFixtureDb',
    ]) {
      assert.ok(index.includes(name), `barrel must export ${name}`);
    }
    for (const forbidden of ['buildEngineeringConfiguratorInput', 'configureHeatPumpFanCoil', 'matchCatalogProducts', 'express']) {
      assert.equal(index.includes(forbidden), false, `barrel must not reference ${forbidden}`);
    }
  });

  test('CM15-S34 no dynamic code execution in runtime modules', () => {
    for (const [name, src] of [
      ['provider', provider],
      ['projection', projection],
      ['canonicalize', canonicalize],
      ['types', types],
      ['index', index],
    ] as const) {
      assertForbidden(src, /\beval\s*\(/, name);
      assertForbidden(src, /\bnew\s+Function\b/, name);
      assertForbidden(src, /child_process/, name);
      assertForbidden(src, /node:vm/, name);
      assertForbidden(src, /\bimport\s*\(\s*["']/, name);
    }
  });

  test('CM15-S35 projection SQL constants never use SELECT *', () => {
    for (const m of Array.from(codeOf(projection).matchAll(/const\s+(SQL_\w+)\s*=\s*`([^`]*)`/g))) {
      assert.equal(/\bSELECT\s+\*/i.test(m[2]), false, `${m[1]} must not SELECT *`);
    }
  });

  test('CM15-S36 serializer discipline: single JSON.stringify emission, sha256-only digest', () => {
    const code = codeOf(canonicalize);
    assert.ok(code.includes('JSON.stringify('));
    assert.equal((code.match(/JSON\.stringify\(/g) ?? []).length, 1);
    assert.equal((code.match(/createHash\(["']sha256["']\)/g) ?? []).length, 1);
    assertForbidden(canonicalize, /JSON\.stringify\([^;]*,\s*(?:null\s*,\s*)?[0-9]\s*\)/, 'canonicalize');
  });

  test('CM15-S37 every emitted CM15 error code carries the catalog_state_ prefix', () => {
    for (const [name, src] of [
      ['provider', provider],
      ['projection', projection],
      ['canonicalize', canonicalize],
    ] as const) {
      for (const m of Array.from(codeOf(src).matchAll(/fail\(\s*["']([^"']+)["']/g))) {
        assert.ok(m[1].startsWith('catalog_state_'), `${name}: error code ${m[1]} must be catalog_state_-prefixed`);
      }
    }
  });

  test('CM15-S38 CM15 test files import only node builtins, better-sqlite3, and the CM15 barrel', () => {
    const allowed = new Set([
      'node:assert/strict',
      'node:crypto',
      'node:fs',
      'node:os',
      'node:path',
      'node:test',
      'node:url',
      'better-sqlite3',
      './engineeringCatalogState/index.js',
    ]);
    for (const file of [RUNTIME_TEST, INVARIANT_TEST]) {
      const src = read(file);
      for (const m of Array.from(src.matchAll(/from\s+["']([^"']+)["']/g))) {
        assert.ok(allowed.has(m[1]), `${path.basename(file)}: import outside the CM15 test allowlist: ${m[1]}`);
      }
    }
  });

  test('CM15-S39 CM11 adapter types retain the frozen scope constant literal', () => {
    const src = read(ADAPTER_TYPES);
    assert.ok(src.includes('ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES = ["FAN_COIL", "HEAT_PUMP"] as const'));
  });

  test('CM15-S40 commerce tokens never appear in canonicalize/types/index runtime code', () => {
    for (const [name, src] of [
      ['canonicalize', canonicalize],
      ['types', types],
      ['index', index],
    ] as const) {
      const code = codeOf(src);
      for (const column of ['price_amd', 'stock_quantity', 'availability_status', 'is_active', 'name_ru', 'currency']) {
        assert.equal(code.includes(column), false, `${name} CODE must not contain ${column}`);
      }
    }
  });
});
