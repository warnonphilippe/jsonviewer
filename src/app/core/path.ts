/**
 * Paths are *derived*, never stored and never parsed back.
 *
 * Rows carry `parent` (a row index) and `key`, so any path is reconstructed by
 * walking the parent chain. Because nothing round-trips through a string, keys
 * containing '.', '[', ']', '"', '/', '~' or newlines cannot break navigation --
 * they only affect how a path is *displayed*.
 *
 * Two display forms are offered for "copy path":
 *   - JSON Pointer (RFC 6901), the interchange form;
 *   - a JavaScript accessor, the form you paste into a console.
 */

import { Row, isContainer } from './flatten';
import { escapePointerSegment } from './schema';

/** Keys from the document root down to `rows[index]`, root-first. */
export function keyPath(rows: readonly Row[], index: number): (string | number)[] {
  const out: (string | number)[] = [];
  let i = index;
  while (i >= 0 && i < rows.length) {
    const row = rows[i];
    out.push(row.key);
    i = row.parent;
  }
  return out.reverse();
}

/** The chain of ancestor row indices of `rows[index]`, root-first. */
export function ancestorRows(rows: readonly Row[], index: number): number[] {
  const out: number[] = [];
  let i = rows[index]?.parent ?? -1;
  while (i >= 0) {
    out.push(i);
    i = rows[i].parent;
  }
  return out.reverse();
}

/** RFC 6901 JSON Pointer for a key path. The root is the empty string. */
export function toJsonPointer(keys: readonly (string | number)[]): string {
  return keys.map((k) => `/${escapePointerSegment(k)}`).join('');
}

const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A JavaScript accessor expression, e.g. `root.table[0]["odd.key"]`. */
export function toJsAccessor(keys: readonly (string | number)[], rootName = 'root'): string {
  let out = rootName;
  for (const key of keys) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else if (SAFE_IDENTIFIER.test(key)) {
      out += `.${key}`;
    } else {
      out += `[${JSON.stringify(key)}]`;
    }
  }
  return out;
}

/** Split a JSON Pointer into unescaped segments. `''` yields `[]`. */
export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`Not a JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    // '~1' must be undone before '~0', or '~01' would wrongly become '/'.
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export interface ResolvedPointer {
  /** Containers from the root down to (but excluding) the target. */
  readonly chain: object[];
  /** Keys from the root down to the target, as the data actually types them. */
  readonly keys: (string | number)[];
  readonly value: unknown;
}

/**
 * Follow a JSON Pointer through a parsed document.
 *
 * Returns the ancestor containers so callers can add them straight to the
 * expanded set -- no string path ever enters the expansion state.
 */
export function resolvePointer(root: unknown, pointer: string): ResolvedPointer | undefined {
  const segments = parsePointer(pointer);
  const chain: object[] = [];
  const keys: (string | number)[] = [];
  let current: unknown = root;

  for (const segment of segments) {
    if (!isContainer(current)) return undefined;
    chain.push(current);
    if (Array.isArray(current)) {
      // A pointer segment into an array must be a plain non-negative integer.
      if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
      const i = Number(segment);
      if (i >= current.length) return undefined;
      keys.push(i);
      current = current[i];
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
      keys.push(segment);
      current = (current as Record<string, unknown>)[segment];
    }
  }

  return { chain, keys, value: current };
}

/** Element-wise key path comparison. Avoids inventing a separator that a key
 * could itself contain. */
export function sameKeys(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // Compared loosely on purpose: an array index arrives as a number from the
    // data view and as a string from a schema path.
    if (String(a[i]) !== String(b[i])) return false;
  }
  return true;
}

/**
 * A hashable identity for a key path, for Set/Map lookups.
 *
 * `JSON.stringify` of a string array is collision-free -- it escapes quotes and
 * backslashes -- so unlike joining on a separator character this cannot be
 * confused by a key that contains the separator. Segments are coerced to strings
 * first, because an array index arrives as a number from the data view and as a
 * string from a schema path.
 */
export function keysId(keys: readonly (string | number)[]): string {
  return JSON.stringify(keys.map(String));
}

/** Index of the row whose key path equals `keys`, or -1. */
export function findRowByKeys(
  rows: readonly Row[],
  keys: readonly (string | number)[],
): number {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].depth !== keys.length - 1) continue;
    if (sameKeys(keyPath(rows, i), keys)) return i;
  }
  return -1;
}

/**
 * Display form for a STRUCTURE path, where the array wildcard is a position
 * rather than a key: `root.table[].field`, not `root.table["[]"].field`.
 */
export function toSchemaDisplayPath(
  keys: readonly string[],
  rootName = 'root',
  itemKey = '[]',
): string {
  let out = rootName;
  for (const key of keys) {
    if (key === itemKey) out += '[]';
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) out += `.${key}`;
    else out += `[${JSON.stringify(key)}]`;
  }
  return out;
}
