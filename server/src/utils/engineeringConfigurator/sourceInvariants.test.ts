/** Source invariant tests; filesystem access is confined to this test file. NOT RUN by agent. */
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const root = dirname(fileURLToPath(import.meta.url));
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir,e.name))
    : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && e.name !== 'fixtures.ts' ? [join(dir,e.name)] : []);
}
const runtime = files(root).sort().map(path => ({path, text: readFileSync(path,'utf8')}));
// Comments are not executable and may document exclusions. No imports/calls are exempted.
const code = runtime.map(f=>f.text.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'')).join('\n');
const guards: readonly [string,string,RegExp][] = [
  ['CM9-S01','no SQLite/database dependency', /better-sqlite3|sqlite3|\bdb\.js\b/],
  ['CM9-S02','no runtime filesystem import', /(?:from\s*|import\s*)['"](?:node:)?fs(?:\/promises)?['"]/],
  ['CM9-S03','no network client', /\bfetch\s*\(|axios|(?:from\s*|import\s*)['"](?:node:)?(?:http|https|net|tls)['"]/],
  ['CM9-S04','no Matcher invocation or endpoint', /matchCatalogProducts|\/api\/catalog-matcher|catalogMatcher\/(?:service|queryAdapter|evaluator|ranking)\.js/],
  ['CM9-S05','no clock', /Date\s*\.\s*now|new\s+Date|\bDate\s*\(/],
  ['CM9-S06','no randomness', /Math\s*\.\s*random|randomUUID|randomBytes|crypto\.getRandomValues/],
  ['CM9-S07','no environment or process dependency', /\bprocess\s*[.[]|import\.meta\.env/],
  ['CM9-S08','no live Building Project service', /buildingProjectService|buildingProjectStorage|buildingProjectLoads|buildingProjectQualityAdapter/],
  ['CM9-S09','no candidate/title/price/stock logic', /\b(?:productId|sku|price|stock|stock_quantity|availability_status|name_ru|selectedCandidate|rankedCandidates)\s*[:.[]/],
  ['CM9-S10','no legacy combined revision field or reason', /\bcatalogStateRevision\b|['"]CATALOG_STATE_CHANGED['"]/],
  ['CM9-S11','no dynamic code/dependency execution', /\b(?:eval|require|Function)\s*\(|\bimport\s*\(/],
  ['CM9-S12','no persistence or procurement entrypoints', /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|VACUUM)\b|\b(?:purchaseAction|reserveStock|createOrder|writeFileSync|writeFile)\s*[:(]/],
];
for (const [id,title,forbidden] of guards) test(`${id} ${title} [CM8-50 CM8.1-26 CM8.1-27]`,()=>{
  assert.ok(runtime.length>0);assert.doesNotMatch(code,forbidden);
});
test('CM9-S13 runtime imports only local module or canonical type-only dependencies',()=>{
  for(const f of runtime){
    for(const match of f.text.matchAll(/import\s+(type\s+)?[\s\S]*?from\s*['"]([^'"]+)['"]/g)){
      const dependency=match[2];
      assert.ok(!dependency.includes('fixtures')&&!dependency.includes('.test.'),dependency);
      assert.ok(dependency.startsWith('./') || (Boolean(match[1]) && ['../catalogMatcher/types.js','../buildingProjectTypes.js'].includes(dependency)),`${relative(root,f.path)}: ${dependency}`);
    }
  }
});
test('CM9-S14 test script exists without build/test chaining',()=>{
  const pkg=JSON.parse(readFileSync(join(root,'../../../package.json'),'utf8'));
  assert.equal(pkg.scripts['test:engineering-configurator'],'tsx --test src/utils/engineeringConfigurator/*.test.ts');
});
