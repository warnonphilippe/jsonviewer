/**
 * Reading a JSON or NDJSON file, strictly read-only.
 *
 * The file is obtained from an <input type="file"> or a drop event and read with
 * `file.text()`. There is no write path anywhere in this application: no File
 * System Access handle, no `createWritable`, no network request. The source file
 * cannot be modified by this code.
 *
 * Two formats are accepted. A plain JSON document, and NDJSON -- one JSON value
 * per line, the shape every export and log pipeline emits when it streams records.
 * An NDJSON document becomes an array of its records, so the tree, the structure
 * view, search and the paths all work on it unchanged.
 *
 * Memory rule: the decoded text is never stored anywhere. It lives in a local,
 * is parsed, and falls out of scope. Retaining it would permanently add ~107MB
 * for the reference file -- more than the parsed graph itself, which is ~38MB.
 */

import { JsonErrorLocation, describeOffset, locateJsonError } from './json-locate-error';

/**
 * V8 cannot represent a string longer than this, so a file above it cannot be
 * decoded at all -- in a worker or anywhere else. Checked before reading so the
 * user gets a message instead of a RangeError.
 */
export const MAX_TEXT_LENGTH = 536_870_888;

/** Above this, warn before committing to the load. */
export const SOFT_WARN_BYTES = 200 * 1024 * 1024;

export type LoadErrorKind = 'empty' | 'too-large' | 'syntax' | 'read-failed' | 'out-of-memory';

/** How the document was read. NDJSON documents are exposed as an array. */
export type DocumentFormat = 'json' | 'ndjson';

/**
 * Extensions that mean NDJSON by convention. `.jsonl` and `.jsonlines` are the
 * same format under other names; all three are in the wild.
 */
const NDJSON_NAME = /\.(ndjson|jsonl|jsonlines)$/i;

/** True when the file name claims NDJSON. Only the name is inspected. */
export function isNdjsonName(fileName: string): boolean {
  return NDJSON_NAME.test(fileName);
}

export interface LoadError {
  readonly kind: LoadErrorKind;
  readonly message: string;
  /** Present for syntax errors. */
  readonly location?: JsonErrorLocation;
  /** The engine's own message, kept for a "copy details" action. */
  readonly detail?: string;
}

export interface LoadTimings {
  readonly readMs: number;
  readonly parseMs: number;
}

export type ParseOutcome =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly format: DocumentFormat;
      /** Number of lines kept, for NDJSON only. */
      readonly recordCount?: number;
      readonly parseMs: number;
    }
  | { readonly ok: false; readonly error: LoadError };

export type LoadOutcome =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly format: DocumentFormat;
      readonly recordCount?: number;
      readonly charSize: number;
      readonly timings: LoadTimings;
    }
  | { readonly ok: false; readonly error: LoadError };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Parse already-decoded text. Pure, so it is directly testable.
 *
 * On failure it locates the error itself rather than trying to read a position
 * out of the engine's message, which is not reliably present.
 */
/**
 * `TextDecoder` and `Blob.text()` both strip a UTF-8 BOM during decoding, but a
 * BOM that survives makes JSON.parse fail with a message that names an
 * invisible character. One cheap check avoids that, and only slices when a BOM
 * is genuinely present.
 */
function withoutBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseJsonText(text: string): ParseOutcome {
  const source = withoutBom(text);

  if (source.trim() === '') {
    return { ok: false, error: { kind: 'empty', message: 'This file contains no JSON.' } };
  }

  const started = performance.now();
  try {
    const value = JSON.parse(source);
    return { ok: true, value, format: 'json', parseMs: performance.now() - started };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (cause instanceof RangeError) {
      return {
        ok: false,
        error: {
          kind: 'out-of-memory',
          message: 'The browser ran out of memory parsing this file.',
          detail,
        },
      };
    }
    const location = locateJsonError(source) ?? undefined;
    return {
      ok: false,
      error: {
        kind: 'syntax',
        message: location
          ? `Invalid JSON at line ${location.line.toLocaleString()}, column ${location.column.toLocaleString()} — expected ${location.expected}.`
          : 'This file is not valid JSON.',
        location,
        detail,
      },
    };
  }
}

const CR = 13;
const TAB = 9;
const SPACE = 32;

/** True when [from, to) holds nothing but spaces and tabs. Allocates nothing. */
function isBlankRange(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c !== SPACE && c !== TAB && c !== CR) return false;
  }
  return true;
}

/**
 * Parse newline-delimited JSON: one value per line, blank lines ignored.
 *
 * The result is an array of the records, which is what the rest of the
 * application already knows how to show -- an NDJSON export of 40 000 rows
 * reads exactly like a JSON file containing those 40 000 rows in an array.
 *
 * The scan walks the text with `indexOf`, one slice per non-blank line and
 * nothing else: `split('\n')` would materialise every line at once, which on a
 * file of two million records means two million live strings on top of the
 * document itself.
 */
export function parseNdjsonText(text: string): ParseOutcome {
  const source = withoutBom(text);
  if (source.trim() === '') {
    return { ok: false, error: { kind: 'empty', message: 'This file contains no JSON.' } };
  }

  const started = performance.now();
  const records: unknown[] = [];
  let pos = 0;

  try {
    while (pos < source.length) {
      let end = source.indexOf('\n', pos);
      if (end === -1) end = source.length;
      // A CRLF file leaves a \r on every line. JSON.parse tolerates it as
      // whitespace, but dropping it keeps the reported columns honest.
      const stop = end > pos && source.charCodeAt(end - 1) === CR ? end - 1 : end;

      if (!isBlankRange(source, pos, stop)) {
        const line = source.slice(pos, stop);
        try {
          records.push(JSON.parse(line));
        } catch (cause) {
          if (cause instanceof RangeError) throw cause;
          return { ok: false, error: ndjsonSyntaxError(source, pos, line, cause) };
        }
      }
      pos = end + 1;
    }
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: 'out-of-memory',
        message: 'The browser ran out of memory parsing this file.',
        detail: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }

  return {
    ok: true,
    value: records,
    format: 'ndjson',
    recordCount: records.length,
    parseMs: performance.now() - started,
  };
}

/**
 * Turn a failure on one line into an error positioned in the WHOLE file.
 *
 * The line is scanned on its own -- that is the unit that had to be valid --
 * but the offset is then rebased on the document, so the message names the
 * file's line number and the frame shows the records around it.
 */
function ndjsonSyntaxError(
  source: string,
  lineStart: number,
  line: string,
  cause: unknown,
): LoadError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const inLine = locateJsonError(line);
  const location = inLine
    ? {
        ...inLine,
        ...describeOffset(source, lineStart + inLine.offset),
        offset: lineStart + inLine.offset,
      }
    : undefined;
  return {
    kind: 'syntax',
    message: location
      ? `Invalid NDJSON at line ${location.line.toLocaleString()}, column ${location.column.toLocaleString()} \u2014 expected ${location.expected}.`
      : 'This file is not valid NDJSON.',
    location,
    detail,
  };
}

/**
 * Does this text look like NDJSON rather than a malformed JSON document?
 *
 * Asked only after `JSON.parse` has already failed, to tell a genuinely broken
 * file apart from a well-formed NDJSON one that simply was not named `.ndjson`.
 * Two conditions, both cheap: there are at least two non-blank lines (a single
 * record is just JSON, and would have parsed), and the first one is a complete
 * JSON value on its own. A pretty-printed document fails the second -- its
 * first line is `{`.
 */
export function looksLikeNdjson(text: string): boolean {
  const source = withoutBom(text);
  let pos = 0;
  let first: string | null = null;

  while (pos < source.length) {
    let end = source.indexOf('\n', pos);
    if (end === -1) end = source.length;
    const stop = end > pos && source.charCodeAt(end - 1) === CR ? end - 1 : end;

    if (!isBlankRange(source, pos, stop)) {
      if (first === null) {
        first = source.slice(pos, stop);
      } else {
        // A second record exists; only now is the first one worth parsing.
        try {
          JSON.parse(first);
          return true;
        } catch {
          return false;
        }
      }
    }
    pos = end + 1;
  }
  return false;
}

/**
 * Parse text as the document it actually is.
 *
 * The name decides which format is tried first, and the other one is the
 * fallback -- an `.ndjson` holding a single pretty-printed document opens, and
 * so does an NDJSON export someone saved as `.json`. When both fail, the error
 * kept is the one for the format the name announced, because that is the
 * mistake the user is most likely looking for.
 */
export function parseDocumentText(text: string, preferNdjson = false): ParseOutcome {
  if (preferNdjson) {
    const ndjson = parseNdjsonText(text);
    if (ndjson.ok) return ndjson;
    const json = parseJsonText(text);
    return json.ok ? json : ndjson;
  }

  const json = parseJsonText(text);
  if (json.ok) return json;
  if (json.error.kind === 'syntax' && looksLikeNdjson(text)) {
    const ndjson = parseNdjsonText(text);
    if (ndjson.ok) return ndjson;
  }
  return json;
}

/** Check a file before reading it, so hopeless loads fail as a message. */
export function preflight(file: File): LoadError | null {
  if (file.size === 0) {
    return { kind: 'empty', message: 'This file is empty.' };
  }
  if (file.size > MAX_TEXT_LENGTH) {
    return {
      kind: 'too-large',
      message:
        `This file is ${formatBytes(file.size)}. A browser cannot hold more than ` +
        `about 512 MB of text in a single string, so it cannot be opened here.`,
    };
  }
  return null;
}

/** True when the user should be warned before committing to the load. */
export function needsSizeWarning(file: File): boolean {
  return file.size > SOFT_WARN_BYTES;
}

/** A human-readable size, for the status bar and warnings. */
export const describeSize = formatBytes;

/**
 * Yield long enough for the browser to paint.
 *
 * Without this the spinner never appears: `await file.text()` resolves in a
 * microtask, so the parse runs in the same frame as the state change that was
 * meant to show the spinner. `requestAnimationFrame` runs just before paint and
 * the nested `setTimeout` resolves just after it.
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/**
 * Read and parse a file, JSON or NDJSON. The decoded text is never retained.
 *
 * The name only chooses which format is tried first: the content decides.
 */
export async function loadJsonFile(file: File): Promise<LoadOutcome> {
  const failed = preflight(file);
  if (failed) return { ok: false, error: failed };

  const readStarted = performance.now();
  let text: string;
  try {
    text = await file.text();
  } catch (cause) {
    return {
      ok: false,
      error: {
        kind: 'read-failed',
        message:
          'The file could not be read. It may have been moved or changed since you chose it.',
        detail: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
  const readMs = performance.now() - readStarted;
  const charSize = text.length;

  // Let the progress indicator paint before the parse blocks the thread.
  await nextPaint();

  const parsed = parseDocumentText(text, isNdjsonName(file.name));
  // Drop the local reference before returning, so the ~107MB string becomes
  // collectable even if the caller holds on to the result for a long time.
  text = '';
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return {
    ok: true,
    value: parsed.value,
    format: parsed.format,
    recordCount: parsed.recordCount,
    charSize,
    timings: { readMs, parseMs: parsed.parseMs },
  };
}
