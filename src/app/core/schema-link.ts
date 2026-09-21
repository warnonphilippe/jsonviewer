/**
 * The bridge between the two views.
 *
 * A data path and a schema path differ in exactly one way: every array index in
 * the data becomes the single ITEM wildcard in the schema. Mapping is therefore
 * a type-directed walk -- we look at the live parent to decide whether a segment
 * is an index or a key, which keeps it correct for objects whose keys look like
 * numbers.
 */

import { Row, isContainer } from './flatten';
import { ITEM } from './schema';
import { keyPath } from './path';

/** How far to scan an array looking for an element that has an optional field. */
const SCAN_LIMIT = 1000;

/** Data key path -> schema key path. Array indices collapse to ITEM. */
export function toSchemaKeys(keys: readonly (string | number)[]): string[] {
  return keys.map((k) => (typeof k === 'number' ? ITEM : k));
}

/** Data row -> schema key path. */
export function schemaKeysForRow(rows: readonly Row[], index: number): string[] {
  return toSchemaKeys(keyPath(rows, index));
}

/**
 * Schema key path -> a concrete data key path, plus the containers along the way.
 *
 * For an ITEM segment this does not blindly take index 0: a field present in
 * only a few records would otherwise land on a record that lacks it. It scans
 * forward (bounded) for the first element where the *remaining* path resolves.
 *
 * Returns the deepest path it could reach, so a partial match still navigates
 * somewhere useful rather than failing outright.
 */
export function firstDataPath(
  root: unknown,
  schemaKeys: readonly string[],
): { keys: (string | number)[]; chain: object[]; complete: boolean } {
  const keys: (string | number)[] = [];
  const chain: object[] = [];
  let current: unknown = root;

  for (let i = 0; i < schemaKeys.length; i++) {
    if (!isContainer(current)) return { keys, chain, complete: false };
    const key = schemaKeys[i];
    const rest = schemaKeys.slice(i + 1);

    if (key === ITEM) {
      if (!Array.isArray(current)) return { keys, chain, complete: false };
      const limit = Math.min(current.length, SCAN_LIMIT);
      let picked = -1;
      for (let j = 0; j < limit; j++) {
        if (resolvesSchemaPath(current[j], rest)) {
          picked = j;
          break;
        }
      }
      if (picked === -1) return { keys, chain, complete: false };
      chain.push(current);
      keys.push(picked);
      current = current[picked];
      continue;
    }

    if (Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key)) {
      return { keys, chain, complete: false };
    }
    chain.push(current);
    keys.push(key);
    current = (current as Record<string, unknown>)[key];
  }

  return { keys, chain, complete: true };
}

/** Can the remaining schema path be followed from this value? */
function resolvesSchemaPath(value: unknown, schemaKeys: readonly string[]): boolean {
  let current = value;
  for (let i = 0; i < schemaKeys.length; i++) {
    if (!isContainer(current)) return false;
    const key = schemaKeys[i];
    if (key === ITEM) {
      if (!Array.isArray(current)) return false;
      const rest = schemaKeys.slice(i + 1);
      const limit = Math.min(current.length, SCAN_LIMIT);
      for (let j = 0; j < limit; j++) {
        if (resolvesSchemaPath(current[j], rest)) return true;
      }
      return false;
    }
    if (Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key)) {
      return false;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}
