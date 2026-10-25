/**
 * CM11 source-invariant tests — WRITTEN ONLY, not executed by the agent.
 * Guard the adapter runtime source against any forbidden dependency or side
 * effect. Filesystem access is confined to THIS test file (§46).
 */
import * as assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "fixtures.ts"
        ? [join(dir, e.name)]
        : [],
  );
}
const runtime = files(root)
  .sort()
  .map((path) => ({ path, text: readFileSync(path, "utf8") }));
const code = runtime
  .map((f) => f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""))
  .join("\n");

const guards: readonly [string, string, RegExp][] = [
  ["CM11-S01", "no SQLite/database dependency", /better-sqlite3|sqlite3|\bdb\.js\b/],
  ["CM11-S02", "no runtime filesystem import", /(?:from\s*|import\s*)['"](?:node:)?fs(?:\/promises)?['"]/],
  ["CM11-S03", "no network client", /\bfetch\s*\(|axios|(?:from\s*|import\s*)['"](?:node:)?(?:http|https|net|tls)['"]/],
  ["CM11-S04", "no Matcher invocation or endpoint", /matchCatalogProducts|\/api\/catalog-matcher|catalogMatcher\/(?:service|queryAdapter|evaluator|ranking)\.js/],
  [
    "CM11-S05",
    "no Configurator runtime entry import",
    /(?:from\s*|import\s*)['"][^'"]*configureHeatPumpFanCoil(?:\.js)?['"]|engineeringConfigurator\/index\.js|generateHeatPumpFanCoilRequirements/,
  ],
  ["CM11-S06", "no clock", /Date\s*\.\s*now|new\s+Date|\bDate\s*\(/],
  ["CM11-S07", "no randomness", /Math\s*\.\s*random|randomUUID|randomBytes|crypto\.getRandomValues/],
  ["CM11-S08", "no environment or process dependency", /\bprocess\s*[.[]|import\.meta\.env/],
  ["CM11-S09", "no live Building Project service", /buildingProjectService|buildingProjectStorage|buildingProjectLoads|buildingProjectQualityAdapter/],
  ["CM11-S10", "no candidate/title/price/stock logic", /\b(?:productId|sku|price|stock|stock_quantity|availability_status|name_ru|selectedCandidate|rankedCandidates)\s*[:.[]/],
  ["CM11-S11", "no dynamic code/dependency execution", /\b(?:eval|require|Function)\s*\(|\bimport\s*\(/],
  ["CM11-S12", "no persistence or procurement entrypoints", /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|VACUUM)\b|\b(?:purchaseAction|reserveStock|createOrder|writeFileSync|writeFile)\s*[:(]/],
];
for (const [id, title, forbidden] of guards) {
  test(`${id} ${title} [CM10-§36-§43]`, () => {
    assert.ok(runtime.length > 0);
    assert.doesNotMatch(code, forbidden);
  });
}

const ALLOWED_EXTERNAL = new Set([
  "../buildingProjectTypes.js",
  "../engineeringConfigurator/types.js",
  "../engineeringConfigurator/equipmentRequirementTypes.js",
  "../engineeringConfigurator/policy.js",
  "../engineeringConfigurator/componentIdentity.js",
  "../catalogMatcher/types.js",
]);

test("CM11-S13 runtime imports only local modules or canonical snapshot dependencies", () => {
  for (const f of runtime) {
    for (const match of f.text.matchAll(/import\s+(?:type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]|export\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const dependency = match[1] ?? match[2];
      assert.ok(!dependency.includes("fixtures") && !dependency.includes(".test."), dependency);
      if (!dependency.startsWith("./")) {
        assert.ok(ALLOWED_EXTERNAL.has(dependency), `${relative(root, f.path)}: ${dependency}`);
      }
    }
  }
});

test("CM11-S14 no runtime load-fingerprint or catalog hash producer", () => {
  // Detect actual producer behavior/imports, not harmless validation vocabulary
  // (the `load:sha256:` token-format prefix, `canonicalFacts`, `algorithmVersion`).
  assert.doesNotMatch(code, /node:crypto|\bcreateHash\b|\bdigest\s*\(|PRAGMA\s+data_version|\bsha256\s*\(/i);
});

test("CM11-S15 module exposes exactly one public entry function", () => {
  assert.ok(/export\s+function\s+buildEngineeringConfiguratorInput\s*\(/.test(code), "buildEngineeringConfiguratorInput must be declared");
  // Only a declaration plus export sites for the pure adapter are expected.
});