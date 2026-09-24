/**
 * Generates a large JSON fixture with the same SHAPE as the reference
 * export, and entirely synthetic values.
 *
 * Why this exists rather than a copy of the real file:
 *   - the real export is ~60 MB, which has no business in a git repository;
 *   - real data must not be copied into a project tree, a test fixture or a
 *     CI artifact.
 *
 * `shape.json` alongside this script carries the export's STRUCTURE only: how
 * many tables, how many records in each, how many columns and of which types.
 * Table and column names are neutral placeholders, kept at the real names'
 * lengths so the generated file keeps its size -- nothing in it names the
 * source system, and no value was ever taken from the real file.
 *
 * The output deliberately reproduces the awkward parts of the real file's
 * encoding, because those are what break parsers:
 *   - a leading UTF-8 BOM (JSON.parse rejects it if it is not stripped);
 *   - CRLF line endings;
 *   - tab-before-comma formatting;
 *   - a few characters above U+00FF, which make V8 pick a two-byte string
 *     representation for the whole document and so double its transient cost.
 *
 * Usage:
 *   node test/fixtures/gen-large.mjs [outfile] [--scale=1]
 */

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shape = JSON.parse(readFileSync(resolve(here, 'shape.json'), 'utf8'));

const args = process.argv.slice(2);
const outPath = resolve(args.find((a) => !a.startsWith('--')) ?? 'public/fixtures/large.json');
const scale = Number((args.find((a) => a.startsWith('--scale=')) ?? '--scale=1').slice(8));

/** Deterministic PRNG, so a failure is always reproducible. */
let seed = 0x2f6e2b1;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 0x100000000;
};

const pick = (list) => list[Math.floor(rand() * list.length)];

const WORDS = [
  'Sample entry',
  'Measurement entries',
  'Scheduled maintenance run',
  'Sensor unit',
  'Reading buffer',
  'Diagnostic trace segments',
  'Firmware revision checkpoint',
  'Secondary telemetry',
];
// A handful of characters above U+00FF, as in the real file: they are what make
// V8 pick a two-byte representation for the whole document.
const WIDE = ['12,50 Ω', 'Tolérance Ω', 'Écart moyen Ω'];

function value(types, column, rowIndex) {
  if (types.length === 1 && types[0] === 'null') return null;
  if (types.includes('number') && !types.includes('string')) {
    if (column === 'id') return rowIndex + 1;
    return Math.floor(rand() * 90000) + 1;
  }
  // Strings: mirror the real file's distribution -- mostly empty, some codes,
  // some labels, the longest 98 characters.
  const roll = rand();
  if (roll < 0.55) return '';
  if (roll < 0.62) return String(Math.floor(rand() * 999)).padStart(3, '0');
  if (roll < 0.7) return `2026-09-16 1${Math.floor(rand() * 9)}.0${Math.floor(rand() * 9)}.33`;
  if (roll < 0.74) return pick(WIDE);
  if (roll < 0.8) {
    return `SEGMENT - Run_NumSeq: ${Math.floor(rand() * 999)} - Set_numseq: ${Math.floor(
      rand() * 999999,
    )} - Idx_numseq: ${Math.floor(rand() * 99999)}`.slice(0, 98);
  }
  return `${pick(WORDS)}${roll < 0.85 ? ' _v2' : ''}`;
}

await mkdir(dirname(outPath), { recursive: true });
const out = createWriteStream(outPath);
const write = (text) =>
  out.write(text) ? Promise.resolve() : new Promise((r) => out.once('drain', r));

// UTF-8 BOM, exactly as the real export begins.
await write('﻿{\r\n');

const tables = Object.entries(shape);
let totalRows = 0;
for (let t = 0; t < tables.length; t++) {
  const [table, info] = tables[t];
  const columns = Object.entries(info.columns);
  const count = Math.max(1, Math.round(info.count * scale));
  totalRows += count;

  await write(`\r\n"${table}":\r\n  [\r\n`);
  for (let i = 0; i < count; i++) {
    const fields = columns
      .map(([column, types]) => `\t"${column}": ${JSON.stringify(value(types, column, i))}\t`)
      .join(',\r\n');
    await write(`     {\r\n${fields}\r\n     }${i < count - 1 ? ',' : ''}\r\n`);
  }
  await write(`  ]${t < tables.length - 1 ? ',' : ''}\r\n`);
}
await write('\r\n }\r\n');

await new Promise((r) => out.end(r));

const { size } = await import('node:fs').then((fs) => fs.promises.stat(outPath));
console.log(
  `wrote ${outPath}\n  ${(size / 1048576).toFixed(1)} MB, ${tables.length} tables, ` +
    `${totalRows.toLocaleString()} records`,
);
