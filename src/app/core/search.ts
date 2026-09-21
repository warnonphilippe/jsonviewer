/**
 * Full-document search over keys and values.
 *
 * A brute-force scan of the reference file takes ~50-70ms regardless of query,
 * so there is no index, no chunking and no worker -- just a debounced call.
 *
 * Two constraints come from measurement rather than taste:
 *
 * 1. Result cardinality explodes. The query "1" matches over 400,000 times in
 *    the reference file. Collecting every hit would allocate more than the tree
 *    itself, so hits are capped while `total` keeps counting to the end -- the
 *    UI can then say "showing 5,000 of 418,916".
 * 2. Paths are built only for hits. Concatenating a path at every one of 1.87M
 *    nodes was the dominant cost; carrying a mutable key stack and slicing it
 *    on a match is not.
 */

import { isContainer } from './flatten';

export interface SearchOptions {
  readonly query: string;
  readonly inKeys: boolean;
  readonly inValues: boolean;
  readonly caseSensitive: boolean;
}

export const DEFAULT_SEARCH: SearchOptions = {
  query: '',
  inKeys: true,
  inValues: true,
  caseSensitive: false,
};

export interface SearchHit {
  /** Ancestor containers, root-first -- feed straight into revealChain(). */
  readonly chain: readonly object[];
  /** Key path from the root to the matching node. */
  readonly keys: readonly (string | number)[];
  readonly where: 'key' | 'value';
}

export interface SearchResult {
  /** Capped at HIT_CAP. */
  readonly hits: readonly SearchHit[];
  /** Exact match count, never capped. */
  readonly total: number;
  readonly capped: boolean;
  readonly elapsedMs: number;
}

export const HIT_CAP = 5000;

export const NO_RESULT: SearchResult = { hits: [], total: 0, capped: false, elapsedMs: 0 };

/** How a scalar is matched against the query. */
function valueText(value: unknown): string {
  if (value === null) return 'null';
  return typeof value === 'string' ? value : String(value);
}

export function searchJson(
  root: unknown,
  options: SearchOptions,
  hitCap = HIT_CAP,
): SearchResult {
  const started = performance.now();
  const { query, inKeys, inValues, caseSensitive } = options;
  if (query === '' || (!inKeys && !inValues)) return NO_RESULT;

  const needle = caseSensitive ? query : query.toLowerCase();
  const matches = (text: string): boolean =>
    (caseSensitive ? text : text.toLowerCase()).includes(needle);

  const hits: SearchHit[] = [];
  let total = 0;

  if (!isContainer(root)) {
    if (inValues && matches(valueText(root))) {
      total = 1;
      hits.push({ chain: [], keys: [], where: 'value' });
    }
    return { hits, total, capped: false, elapsedMs: performance.now() - started };
  }

  interface Frame {
    readonly container: object;
    readonly isArray: boolean;
    readonly objectKeys: string[] | null;
    readonly n: number;
    i: number;
  }

  const makeFrame = (container: object): Frame => {
    const isArray = Array.isArray(container);
    const objectKeys = isArray ? null : Object.keys(container);
    return {
      container,
      isArray,
      objectKeys,
      n: isArray ? (container as unknown[]).length : objectKeys!.length,
      i: 0,
    };
  };

  const stack: Frame[] = [makeFrame(root)];
  // Mutable key stack, parallel to `stack`. Sliced only when a hit is recorded.
  const keyStack: (string | number)[] = [];
  const chain: object[] = [root];

  const record = (depth: number, where: 'key' | 'value') => {
    total++;
    if (hits.length < hitCap) {
      hits.push({
        chain: chain.slice(0, depth + 1),
        keys: keyStack.slice(0, depth + 1),
        where,
      });
    }
  };

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.n) {
      stack.pop();
      chain.pop();
      keyStack.length = stack.length;
      continue;
    }

    const depth = stack.length - 1;
    const key = frame.isArray ? frame.i : frame.objectKeys![frame.i];
    const value = (frame.container as Record<string | number, unknown>)[key];
    frame.i++;
    keyStack[depth] = key;

    // Array indices are positions, not names, so they are not "keys" to search.
    if (inKeys && !frame.isArray && matches(key as string)) record(depth, 'key');

    if (isContainer(value)) {
      stack.push(makeFrame(value));
      chain.push(value);
      continue;
    }
    if (inValues && matches(valueText(value))) record(depth, 'value');
  }

  return {
    hits,
    total,
    capped: total > hits.length,
    elapsedMs: performance.now() - started,
  };
}
