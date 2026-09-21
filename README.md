# JSON viewer

A read-only, browser-based viewer for large JSON and NDJSON files. Built for export
files that text editors and pretty-printers cannot navigate — the reference case
is a **56 MB / 2,054,886-line** export containing **1,867,216 JSON nodes**.

Angular 22 (dev server: Vite 8, via `@angular/build:application`).
`@angular/cdk` for virtual scrolling; no other runtime dependency.

## Two views, both navigable

| View | Shows |
|---|---|
| **Data** | The full tree with values, expand/collapse per node. |
| **Structure** | The document's *shape only* — types, occurrences, presence ratio, null and empty counts, array length ranges. No values. |

The structure view is what makes a large export auditable. On the reference file
it collapses 1.87M nodes into **230 rows**, which immediately surfaces things
like 6 always-null columns and 58 columns that are structurally present but
always an empty string.

Press <kbd>j</kbd> (or use *Show structure* / *Show data*) to jump between the
two views at the same position.

## Two formats

| Format | Read as |
|---|---|
| **JSON** | The document itself. |
| **NDJSON** — one JSON value per line, also called `.jsonl` | An **array of its records**, so both views, search and the paths work on it unchanged. |

The extension only decides which format is *tried first*; the content decides
the rest. An NDJSON export someone saved as `.json` opens, and so does a single
pretty-printed document named `.ndjson`. A file that is simply broken keeps the
error for the format its name announced, rather than being accused of being the
other one.

NDJSON errors are reported at the **line number of the file**, not of the
record: the failing line is validated on its own, then the position is rebased
on the document so the caret frame shows the records around it.

Blank lines are ignored, a UTF-8 BOM is stripped, and CRLF files — which is how
the real exports arrive — read the same as LF ones.

## The source file is never modified

Files are read through `<input type="file">` and drag-and-drop only. There is no
File System Access handle, no `createWritable`, and no network request anywhere
in the application — the code has no write path at all. Nothing leaves the
browser.

## Measured behaviour on the 56 MB reference file

| Operation | Measured |
|---|---|
| Read (off-thread) | ~40–90 ms |
| `JSON.parse` | **~67 ms** |
| Structure inference (full scan, no sampling) | ~48 ms |
| Parsed graph in heap | ~38 MB (smaller than the 107 MB source string, which is released) |
| Flatten, typical interaction | 0.1–1.3 ms |
| Flatten, expand-all (capped) | ~14 ms |
| Full-text search over keys and values | ~65–75 ms |
| Locate a syntax error in a corrupt file | ~137 ms |

Because the whole load blocks for roughly 115 ms, there is **no Web Worker**: a
`postMessage` protocol, async child fetching and a page cache would add
permanent complexity to hide a delay nobody can perceive, and `structuredClone`
of the parsed graph alone costs more than parsing it again.

## Two hard limits worth knowing

1. **~512 MB of text.** A JS engine cannot hold a string longer than 536,870,888
   characters, so a larger file cannot be decoded at all — in a worker or
   anywhere else. Files above it are refused up front with a clear message
   instead of failing with a `RangeError`.
2. **Browsers clamp element height** (~33.5M px in Chromium/WebKit, ~17.9M px in
   Gecko). A fixed-size virtual scroller's spacer *is* one very tall element, and
   past the clamp the viewport silently cannot reach its own bottom — rows exist
   but are unreachable and nothing throws. The limit is therefore measured at
   runtime (`core/scroll-limits.ts`) and converted into a row cap; hitting it
   shows a banner rather than losing rows quietly.

## How it works

The core (`src/app/core/`) is pure and Angular-free — ten modules that take a
value and return data, so they are testable without a browser.

- **No node objects.** The parsed value *is* the tree. Rows hold a live
  reference into it and are recomputed from scratch on every expand/collapse
  (36–85 ms worst case), which removes every cache-coherence bug a node layer
  would introduce.
- **Expansion is keyed by object identity**, never by a string path. `JSON.parse`
  never produces aliased references, so identity is a perfect key — and since no
  code ever parses a path, keys containing `.`, `[`, `]`, `"`, `/`, `~` or
  newlines cannot break navigation. Paths are *derived* for display only, in both
  JSON Pointer (RFC 6901) and JavaScript-accessor form.
- **`autoExpandDepth` is a rule, not an enumeration**, so "expand all" and
  "expand to depth N" are O(1) instead of materialising a set of all 93,758
  containers.
- **Large containers get a "show more" row** rather than synthetic bucket nodes.
  A bucket would be a node that does not exist in the document, which every
  path, search result and keyboard move would then have to model.
- **Syntax errors are located by our own scanner** (`core/json-locate-error.ts`),
  because V8's `SyntaxError` message cannot be relied on: the most common form
  (`Unexpected token '}' …`) carries no position at any input size. The scanner
  allocates nothing per character and reports an exact line, column and caret
  frame. It runs only after a parse has already failed.

## Running it

One command. It installs npm dependencies if they are missing or stale, finds a
free port, and starts the dev server:

```bash
./start.sh
```

There is nothing else to start — no backend, no database, no services.

| Option | Effect |
|---|---|
| `-p, --port N` | Preferred port (default 4200; the next free one is used if taken) |
| `-n, --no-open` | Do not open a browser |
| `-f, --fixture` | Also generate a ~59 MB synthetic test fixture (see below) |
| `-c, --clean` | Reinstall `node_modules` from scratch first |
| `-b, --build` | Produce a production build instead of serving |
| `-t, --test` | Run the unit tests first |
| `-h, --help` | Show help |

To try the viewer at full scale immediately:

```bash
./start.sh --fixture
```

then open `large.json` from `public/fixtures/` in the file picker.

The underlying npm scripts remain available:

```bash
npm start          # dev server (Vite)
npm test           # unit tests (Vitest) — 190 tests
npm run build      # production build
```

### As a container

The image is a static nginx serving the production build — no Node, no backend,
nothing to configure:

```bash
docker run --rm -p 5176:80 pwarnon/json-viewer
```

`deploy.sh` builds it for `linux/amd64` and `linux/arm64` and pushes both to
Docker Hub under `pwarnon` (a `docker login` is required first):

```bash
./deploy.sh          # pwarnon/json-viewer:latest
./deploy.sh 1.0.0    # :1.0.0 and :latest
```

The build resolves dependencies from the public npm registry rather than the
private npm mirror the lockfile records, so it works off-VPN and without
credentials — same versions, same `integrity` hashes, different mirror. The
59 MB fixture in `public/fixtures/` is excluded by `.dockerignore`; the image
serves 252 KB.

The same image is mounted by the compose-stack stack on port **5176**
(`src/main/docker/json-viewer/json-viewer.yml`):

```bash
cd ../compose-stack/src/main/docker && docker compose up -d json-viewer
```

### Checking against a real large file

The reference export is **not** in this repository: it has no business in git. Point the verification script at it by path instead.
It checks every performance budget above and every structural invariant:

```bash
node --expose-gc scripts/verify-real-file.mjs "/path/to/export.json"
```

To get a large file for browser testing without touching real data, generate a
shape-identical fixture. `test/fixtures/shape.json` records only table names,
column names and column types — no values were taken from the real file. The
generator reproduces the awkward parts of the real encoding (UTF-8 BOM, CRLF,
tab-before-comma, a few characters above U+00FF that force a two-byte string):

```bash
node test/fixtures/gen-large.mjs public/fixtures/large.json
```

Generated fixtures live in `public/fixtures/` and are git-ignored.

## Keyboard

| Key | Action |
|---|---|
| <kbd>↑</kbd> <kbd>↓</kbd> | Move |
| <kbd>→</kbd> | Expand, or step into the first child |
| <kbd>←</kbd> | Collapse, or step out to the parent |
| <kbd>Enter</kbd> <kbd>Space</kbd> | Toggle |
| <kbd>Home</kbd> <kbd>End</kbd> | First / last row |
| <kbd>PageUp</kbd> <kbd>PageDown</kbd> | One screen |
| <kbd>*</kbd> | Expand all |
| <kbd>j</kbd> | Jump to the other view |
| <kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> | Find |

<kbd>Ctrl/Cmd</kbd>+<kbd>F</kbd> deliberately shadows the browser's own find,
which would only see the ~40 virtualised rows that exist in the DOM and is
therefore actively misleading. For the same reason, copy actions are explicit
buttons: <kbd>Cmd</kbd>+<kbd>A</kbd> in a virtualised list would copy 40 rows.
