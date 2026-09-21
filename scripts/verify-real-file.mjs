/**
 * Runs the pure core against a real, large JSON file and checks the performance
 * budgets from the plan.
 *
 * The reference export is NOT part of this repository: it is too large for git. Point this at it by path instead.
 *
 *   node scripts/verify-real-file.mjs "/path/to/export.json"
 */
import { readFileSync, statSync } from 'node:fs';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/verify-real-file.mjs <path-to-json>');
  process.exit(2);
}

// Bundle the core so this script can use the same TypeScript the app ships.
const outfile = join(tmpdir(), `json-viewer-core-${process.pid}.mjs`);
await build({
  entryPoints: ['src/app/core/index.ts'],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  logLevel: 'warning',
});
const core = await import(outfile);

const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
const heap = () => {
  for (let i = 0; i < 4; i++) global.gc?.();
  return process.memoryUsage().heapUsed;
};

let failures = 0;
function check(label, actual, predicate, expectation) {
  const ok = predicate(actual);
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}: ${actual}${expectation ? `  (expected ${expectation})` : ''}`);
}
const under = (limit) => (v) => v <= limit;

const size = statSync(file).size;
console.log(`\n=== ${file}\n    ${mb(size)} (${size.toLocaleString()} bytes)\n`);

const baseline = heap();

// --- decode + parse -------------------------------------------------------
let t = performance.now();
const bytes = readFileSync(file);
const text = new TextDecoder('utf-8').decode(bytes);
const decodeMs = performance.now() - t;

const parsed = core.parseJsonText(text);
if (!parsed.ok) {
  console.error('FAILED TO PARSE:', parsed.error.message);
  if (parsed.error.location) console.error(parsed.error.location.frame);
  process.exit(1);
}
const root = parsed.value;

console.log('--- load ---');
check('decode ms', +decodeMs.toFixed(1), under(300), '<= 300');
check('parse ms', +parsed.parseMs.toFixed(1), under(500), '<= 500');
check('BOM handled (root is an object)', typeof root === 'object' && root !== null, (v) => v === true);

// --- structure of the reference export -----------------------------------
console.log('\n--- document shape ---');
const nodeCount = core.countNodes(root);
console.log(`  root keys: ${Object.keys(root).length}`);
console.log(`  node count: ${nodeCount.toLocaleString()}`);
const lengths = Object.values(root).map((v) => (Array.isArray(v) ? v.length : -1));
console.log(`  array lengths: ${lengths.join(', ')}`);

// --- schema inference ----------------------------------------------------
t = performance.now();
const schema = core.buildSchema(root);
const schemaMs = performance.now() - t;
const schemaNodes = core.allSchemaNodes(schema).size;
console.log('\n--- structure view ---');
check('schema inference ms', +schemaMs.toFixed(1), under(300), '<= 300');
console.log(`  schema nodes: ${schemaNodes}`);

// Spot-check the stats that make this view worth having.
const tables = Object.keys(root);
const first = schema.fields.get(tables[0]);
console.log(`  ${tables[0]}[] -> ${core.describeType(first)}, ${first.totalElements} elements`);
let alwaysNull = 0, alwaysEmpty = 0, optional = 0;
for (const [name, table] of schema.fields) {
  if (!table.items) continue;
  for (const [field, node] of table.items.fields) {
    if (node.nulls === node.count && node.count > 0) alwaysNull++;
    if (node.empties === node.count && node.count > 0) alwaysEmpty++;
    if (node.count < table.totalElements) {
      optional++;
      console.log(`  optional: ${name}[].${field} present ${node.count}/${table.totalElements}`);
    }
  }
}
console.log(`  always-null columns: ${alwaysNull}`);
console.log(`  always-empty-string columns: ${alwaysEmpty}`);
console.log(`  optional columns: ${optional}`);

// --- flatten -------------------------------------------------------------
console.log('\n--- flatten ---');
const limits = { ...core.DEFAULT_LIMITS, maxRows: core.maxRowsFor(24, core.CONSERVATIVE_MAX_HEIGHT_PX) };
console.log(`  row cap (24px rows, conservative clamp): ${limits.maxRows.toLocaleString()}`);

t = performance.now();
const collapsed = core.flatten(root, core.EMPTY_STATE, limits);
check('collapsed flatten ms', +(performance.now() - t).toFixed(3), under(5), '<= 5');
check('collapsed rows', collapsed.rows.length, (v) => v === Object.keys(root).length);

// Expand the biggest table.
const biggestKey = tables[lengths.indexOf(Math.max(...lengths))];
const biggest = root[biggestKey];
let state = core.revealChain(core.EMPTY_STATE, [biggest]);
t = performance.now();
const oneOpen = core.flatten(root, state, limits);
const oneOpenMs = performance.now() - t;
console.log(`  expanding ${biggestKey} (${biggest.length.toLocaleString()} items):`);
check('  flatten ms', +oneOpenMs.toFixed(1), under(50), '<= 50');
check('  rows', oneOpen.rows.length, (v) => v === Object.keys(root).length + limits.defaultReveal + 1,
  `${Object.keys(root).length} tables + ${limits.defaultReveal} revealed + 1 "more" row`);
check('  a "more" row is present', oneOpen.rows.some((r) => r.kind === 'more'), (v) => v === true);
check('  not truncated', oneOpen.truncated, (v) => v === false);

// Expand-to-depth: the O(1) rule. Depth 1 opens the tables (records collapsed),
// depth 2 also opens every record, which is what the cap is for.
for (const depth of [1, 2]) {
  t = performance.now();
  const r = core.flatten(root, core.expandToDepth(core.EMPTY_STATE, depth), limits);
  check(`expand-to-depth-${depth} flatten ms`, +(performance.now() - t).toFixed(1), under(200), '<= 200');
  console.log(`         rows ${r.rows.length.toLocaleString()} (truncated: ${r.truncated})`);
}

// Expand-all: the worst case the cap exists for.
t = performance.now();
const all = core.flatten(root, core.expandAll(core.EMPTY_STATE), limits);
const allMs = performance.now() - t;
check('expand-all flatten ms', +allMs.toFixed(1), under(500), '<= 500');
check('expand-all is capped, not unbounded', all.rows.length, (v) => v <= limits.maxRows);
check('expand-all reports truncation', all.truncated, (v) => v === true);
check('expand-all spacer fits the engine clamp',
  all.rows.length * 24 < core.CONSERVATIVE_MAX_HEIGHT_PX, (v) => v === true);

// --- search --------------------------------------------------------------
console.log('\n--- search ---');
for (const query of ['frais', '001', '1']) {
  const r = core.searchJson(root, { ...core.DEFAULT_SEARCH, query });
  check(`search "${query}" ms`, +r.elapsedMs.toFixed(1), under(400), '<= 400');
  console.log(`         hits ${r.hits.length.toLocaleString()} of ${r.total.toLocaleString()} total (capped: ${r.capped})`);
}

// --- paths ---------------------------------------------------------------
console.log('\n--- paths and the structure/data link ---');
const sample = oneOpen.rows.findIndex((r) => r.parent !== -1 && r.kind === 'object');
const keys = core.keyPath(oneOpen.rows, sample);
const pointer = core.toJsonPointer(keys);
const resolved = core.resolvePointer(root, pointer);
check('a row pointer resolves back to the same object',
  resolved?.value === oneOpen.rows[sample].value, (v) => v === true);
console.log(`  pointer: ${pointer}`);
console.log(`  accessor: ${core.toJsAccessor(keys)}`);

// Every schema position must map to a concrete data path.
let linked = 0, unlinked = 0;
const schemaRows = core.flattenSchema(schema, core.expandAll(core.EMPTY_STATE));
for (let i = 0; i < schemaRows.length; i++) {
  const schemaKeys = core.keyPath(schemaRows, i);
  const hit = core.firstDataPath(root, schemaKeys);
  if (hit.complete) linked++;
  else {
    unlinked++;
    if (unlinked <= 3) console.log(`  UNLINKED: ${schemaKeys.join(' / ')}`);
  }
}
check('every structure row links to real data', unlinked, (v) => v === 0, '0 unlinked');
console.log(`  structure rows: ${schemaRows.length} (all ${linked} link to data)`);

// --- memory --------------------------------------------------------------
console.log('\n--- memory ---');
const withEverything = heap() - baseline;
console.log(`  heap holding string + graph + schema + rows: ${mb(withEverything)}`);

// --- error location on a corrupted copy ----------------------------------
console.log('\n--- syntax error location on a corrupted copy ---');
// Corrupt a numeric value, not an arbitrary offset: a midpoint offset usually
// lands inside a string, where injected letters are still valid JSON.
const anchor = text.indexOf('"id":', Math.floor(text.length / 2));
let at = anchor + '"id":'.length;
while (at < text.length && /\s/.test(text[at])) at++;
const corrupted = text.slice(0, at) + 'q' + text.slice(at + 1);
t = performance.now();
const bad = core.parseJsonText(corrupted);
const locateMs = performance.now() - t;
check('locate ms (parse + scan)', +locateMs.toFixed(1), under(2000), '<= 2000');
if (!bad.ok && bad.error.location) {
  console.log(`  ${bad.error.message}`);
  console.log(bad.error.location.frame.split('\n').map((l) => '    ' + l).join('\n'));
} else {
  console.log('  FAIL: corrupted document was not rejected');
  failures++;
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
