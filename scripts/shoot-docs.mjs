#!/usr/bin/env node
/**
 * Regenerate the screenshots the README embeds.
 *
 *   npm run build && node scripts/shoot-docs.mjs
 *
 * Drives a headless Chrome over the DevTools protocol, with no dependency at
 * all: Node has had a WebSocket client built in since v22, and CDP is just
 * JSON over a socket. The repository already refuses runtime dependencies; it
 * would be odd to take on a browser automation stack to photograph the result.
 *
 * The screenshots are taken against the PRODUCTION build served from `dist/`,
 * so the documentation shows what actually ships rather than what the dev
 * server renders.
 *
 * Every byte of the data in them is synthetic -- generated below, in the shape
 * of the real exports (records nested a few levels deep, an optional
 * sub-object, columns that are always empty or always null) but describing a
 * sensor fleet. No real export data has ever been in this repository.
 */

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'json-viewer', 'browser');
const OUT = join(ROOT, 'docs', 'images');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1340;
const HEIGHT = 840;
/** 2 keeps the 12.5px monospace rows legible when GitHub scales the image down. */
const SCALE = 2;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

// --- the synthetic document ------------------------------------------------

/**
 * A synthetic export with the shape that makes the two views worth having:
 * records nested a few levels deep, an optional sub-object, a field that is
 * sometimes null, and columns that are structurally present but carry nothing
 * -- always an empty string, or always null.
 *
 * Deliberately a sensor fleet rather than anything resembling a business
 * record: the documentation should not put data that looks accounting-like in
 * front of a reader, whether or not it is invented.
 */
function sampleExport() {
  const sites = [
    ['Gembloux', 'GBX'],
    ['Louvain-la-Neuve', 'LLN'],
    ['Mons', 'MNS'],
    ['Arlon', 'ARL'],
    ['Hasselt', 'HST'],
    ['Oostende', 'OST'],
  ];
  const kinds = ['thermocouple', 'hygrometer', 'anemometer', 'barometer', 'pyranometer'];
  const rows = [];
  for (let i = 0; i < 420; i++) {
    const [site, code] = sites[i % sites.length];
    rows.push({
      ID: 100_000 + i,
      LABEL: `${kinds[i % kinds.length]} ${code}-${String(i % 90).padStart(3, '0')}`,
      SERIAL: i % 7 === 0 ? null : `SN-${(4_100_200 + i * 13).toString(36).toUpperCase()}`,
      SAMPLE_HZ: Math.round((0.5 + (i % 12) * 0.25) * 100) / 100,
      UNIT: i % 5 === 2 ? 'hPa' : i % 5 === 1 ? '%RH' : 'degC',
      location: {
        site,
        building: `Hall ${(i % 4) + 1}`,
        level: `${i % 3}`,
        zone: '',
      },
      tags: i % 4 === 0 ? [] : i % 3 === 0 ? ['outdoor'] : ['outdoor', 'redundant'],
      ...(i % 3 === 0
        ? {
            calibration: {
              method: 'two-point',
              certificate: i % 9 === 0 ? null : `CERT-${2026}-${String(i).padStart(4, '0')}`,
              notes: '',
            },
          }
        : {}),
      FIRMWARE_NOTE: '',
      SERVICE_NOTE: '',
      LEGACY_ID: null,
      ACTIVE: i % 5 !== 0,
      UPDATED_AT: `2026-0${(i % 9) + 1}-1${i % 9}T08:30:00Z`,
    });
  }

  return {
    meta: {
      exportedAt: '2026-09-21T04:12:07Z',
      source: 'FIELD-TELEMETRY',
      version: 3,
      dryRun: false,
      checksum: null,
    },
    tables: [
      {
        name: 'SENSORS',
        rowCount: rows.length,
        columns: [
          { name: 'ID', type: 'number', nullable: false },
          { name: 'LABEL', type: 'string', nullable: false },
          { name: 'SERIAL', type: 'string', nullable: true },
          { name: 'SAMPLE_HZ', type: 'number', nullable: false },
        ],
        rows,
      },
      {
        name: 'RUNS',
        rowCount: 2,
        columns: [{ name: 'REF', type: 'string', nullable: false }],
        rows: [
          {
            REF: 'RUN-2026-000001',
            DURATION_S: 1200.0,
            steps: [{ phase: 'soak', minutes: 20, target: 60 }],
            passed: true,
          },
          { REF: 'RUN-2026-000002', DURATION_S: 84.9, steps: [], passed: false },
        ],
      },
    ],
    warnings: [],
    stats: { nodes: 1_867_216, durationMs: 115 },
  };
}

const BROKEN =
  '{\n  "meta": { "source": "FIELD-TELEMETRY" },\n  "tables": [1, 2,\n  "warnings": []\n}\n';

// --- a static server for dist/ ---------------------------------------------

function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(root, path === '/' ? 'index.html' : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// --- the DevTools protocol, by hand ----------------------------------------

async function connect(port) {
  // Chrome needs a moment before its debugging endpoint answers.
  let targets;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) throw new Error('Chrome never exposed a page target');

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    socket.addEventListener('open', ok, { once: true });
    socket.addEventListener('error', () => no(new Error('cannot reach Chrome')), { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { send, close: () => socket.close() };
}

/** Run an async expression in the page and return its value. */
async function run(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  }
  return result.value;
}

async function shoot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  const size = Buffer.from(data, 'base64').length;
  console.log(`  docs/images/${name}.png  ${(size / 1024).toFixed(0)} kB`);
}

/** Put a File into the picker, the way the browser would. */
const loadFile = (json, fileName) => `
  const dt = new DataTransfer();
  dt.items.add(new File([${JSON.stringify(json)}], ${JSON.stringify(fileName)}, { type: 'application/json' }));
  const input = document.querySelector('input[type=file]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
`;

const settle = (ms = 400) => `await new Promise(r => setTimeout(r, ${ms}));`;

// --- the shots --------------------------------------------------------------

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error(`No production build at ${DIST}.\nRun "npm run build" first.`);
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });

  const server = await serve(DIST);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = await mkdtemp(join(tmpdir(), 'json-viewer-shots-'));
  const port = 9333;

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  try {
    cdp = await connect(port);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });

    const sample = JSON.stringify(sampleExport(), null, 2);

    const goto = async (scheme) => {
      await cdp.send('Page.navigate', { url });
      await run(cdp, settle(1400));
      // Pin the colour scheme so a run on a dark machine matches a light one.
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      });
      await run(cdp, settle(200));
    };

    console.log('Shooting against the production build…');

    // 1. The landing screen.
    await goto('dark');
    await shoot(cdp, 'empty');

    // 2. The data view, deep in a record: pinned ancestors, breadcrumb, and the
    //    hover cluster on a row.
    await goto('dark');
    await run(cdp, loadFile(sample, 'telemetry-2026-09.json'));
    await run(
      cdp,
      `
      [...document.querySelectorAll('button[title]')]
        .find(b => b.title.includes('Open everything')).click();
      ${settle(500)}
      const vp = document.querySelector('.cdk-virtual-scroll-viewport');
      vp.scrollTop = 24 * 34;
      ${settle(450)}
      const row = [...document.querySelectorAll('.viewport .row')]
        .find(r => r.querySelector('.jv-key')?.textContent.trim() === 'location');
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      ${settle(250)}
    `,
    );
    await shoot(cdp, 'data-view');

    // 3. The same position, light.
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
    await run(cdp, settle(300));
    await shoot(cdp, 'data-view-light');

    // 4. The structure view -- what makes an export auditable.
    await goto('dark');
    await run(cdp, loadFile(sample, 'telemetry-2026-09.json'));
    await run(
      cdp,
      `
      [...document.querySelectorAll('[role=tab]')]
        .find(b => b.textContent.trim() === 'Structure').click();
      ${settle(300)}
      [...document.querySelectorAll('button[title]')]
        .find(b => b.title.includes('Open everything')).click();
      ${settle(500)}
      // Down to the columns that make the view worth having: the ones that are
      // always empty, always null, or only sometimes present.
      document.querySelector('.cdk-virtual-scroll-viewport').scrollTop = 24 * 22;
      ${settle(450)}
    `,
    );
    await shoot(cdp, 'structure-view');

    // 5. Search, with matches highlighted in place.
    await goto('dark');
    await run(cdp, loadFile(sample, 'telemetry-2026-09.json'));
    await run(
      cdp,
      `
      [...document.querySelectorAll('button[title]')]
        .find(b => b.title.includes('Open everything')).click();
      ${settle(400)}
      const input = document.querySelector('.search input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, 'anemometer');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      ${settle(900)}
    `,
    );
    await shoot(cdp, 'search');

    // 6. The row menu.
    await goto('dark');
    await run(cdp, loadFile(sample, 'telemetry-2026-09.json'));
    await run(
      cdp,
      `
      [...document.querySelectorAll('button[title]')]
        .find(b => b.title.includes('Open everything')).click();
      ${settle(400)}
      const vp = document.querySelector('.cdk-virtual-scroll-viewport');
      vp.scrollTop = 24 * 34;
      ${settle(400)}
      const row = [...document.querySelectorAll('.viewport .row')]
        .find(r => r.querySelector('.jv-key')?.textContent.trim() === 'location');
      const rect = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, clientX: rect.left + 150, clientY: rect.top + 14,
      }));
      ${settle(450)}
    `,
    );
    await shoot(cdp, 'row-menu');

    // 7. A corrupt file, located by our own scanner.
    await goto('dark');
    await run(cdp, loadFile(BROKEN, 'telemetry-broken.json'));
    await shoot(cdp, 'syntax-error');

    console.log(`\nWrote ${OUT}`);
  } finally {
    cdp?.close();
    chrome.kill();
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
