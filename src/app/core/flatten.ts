/**
 * The flattening engine: turns a parsed JSON value into the flat list of rows
 * that the virtual scroller renders.
 *
 * Two deliberate design choices drive this whole file:
 *
 * 1. There is no node object layer. The parsed value *is* the tree. Rows hold a
 *    reference into that graph and are recomputed from scratch on every toggle,
 *    which is cheap (measured: 36-85ms for a fully expanded 1.87M-node document)
 *    and removes every cache-coherence bug a node layer would bring.
 *
 * 2. Expansion state is keyed by container *object identity*, never by a string
 *    path. `JSON.parse` never produces aliased references, so identity is a
 *    perfect key -- and no code ever has to parse a path, so keys containing
 *    '.', '[', ']', '"', '/', '~' or newlines cannot break anything.
 */

import { TreeState, isOpen } from './tree-state';

/** What a row represents. `more` is an affordance, not a node in the document. */
export type RowKind = 'object' | 'array' | 'leaf' | 'more';

/** The scalar type names we report, in the structure view and as row badges. */
export type ScalarType = 'string' | 'number' | 'boolean' | 'null';

/** Statistics attached to structure-view rows. See schema.ts. */
export interface FieldStats {
  /** Types observed at this position across the whole document. */
  readonly types: readonly ScalarType[];
  /** How many instances of this position were observed. */
  readonly count: number;
  /** How many parent instances existed (count < parentCount => optional key). */
  readonly parentCount: number;
  /** Observed `null` values. Distinct from an absent key. */
  readonly nulls: number;
  /** Observed empty strings. */
  readonly empties: number;
  /** For arrays: observed length range. */
  readonly lengths?: { readonly min: number; readonly max: number };
}

export interface Row {
  readonly kind: RowKind;
  /** Property name, or array index. */
  readonly key: string | number;
  readonly depth: number;
  /** Index into the rows array of the parent container row; -1 at top level. */
  readonly parent: number;
  /** Child count for containers, 0 for leaves. */
  readonly size: number;
  /**
   * Position among siblings, and how many siblings there are. Emitted here
   * because the walk already knows both, and a virtualised `role="tree"` needs
   * `aria-posinset`/`aria-setsize` on every rendered row -- only ~40 rows are in
   * the DOM, so without these a screen reader would be told the tree is 40 items
   * long. Recovering them afterwards would cost a scan per row.
   */
  readonly indexInParent: number;
  readonly siblingCount: number;
  /**
   * Identity key for expansion. Present on container rows only.
   * For the data view this is the container from the parsed graph; for the
   * structure view it is the SchemaNode. Either way: object identity.
   */
  readonly ref?: object;
  /** Data view: a reference INTO the parsed graph. Never a copy. */
  readonly value?: unknown;
  /** Structure view: types and statistics. */
  readonly meta?: FieldStats;
  /** Set on `more` rows: how many children are hidden behind this affordance. */
  readonly more?: { readonly ref: object; readonly shown: number; readonly total: number };
}

export interface FlattenLimits {
  /**
   * Hard ceiling on emitted rows. Derived at runtime from the browser's
   * max element height (see scroll-limits.ts) -- past that limit a virtual
   * scroller silently cannot reach its own bottom.
   */
  readonly maxRows: number;
  /** Children shown per container before a `more` row appears. */
  readonly defaultReveal: number;
  /** Guard against pathologically deep documents. */
  readonly maxDepth: number;
}

export const DEFAULT_LIMITS: FlattenLimits = {
  maxRows: 400_000,
  defaultReveal: 10_000,
  maxDepth: 512,
};

export interface FlattenResult {
  readonly rows: readonly Row[];
  /** True when `maxRows` cut the walk short. */
  readonly truncated: boolean;
}

/** True for values that have children and can therefore be expanded. */
export function isContainer(v: unknown): v is object {
  return v !== null && typeof v === 'object';
}

/** Child count of a container. */
export function childCount(v: object): number {
  return Array.isArray(v) ? v.length : Object.keys(v).length;
}

/** The scalar type name of a non-container value. */
export function scalarType(v: unknown): ScalarType {
  if (v === null) return 'null';
  const t = typeof v;
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'string';
}

interface Frame {
  readonly container: object;
  readonly isArray: boolean;
  /** Pre-read key list for objects; null for arrays (we index directly). */
  readonly keys: string[] | null;
  /** Total children. */
  readonly n: number;
  /** How many children this pass will emit before the `more` row. */
  readonly shown: number;
  /** Cursor. */
  i: number;
  readonly depth: number;
  /** Row index of the container that owns this frame. */
  readonly parent: number;
}

/**
 * Walk `root`, emitting one row per visible node.
 *
 * Uses an explicit stack rather than recursion: this project's reference file is
 * only 3 deep, but arbitrary JSON can nest thousands deep and would blow the
 * call stack.
 */
export function flatten(
  root: unknown,
  state: TreeState,
  limits: FlattenLimits = DEFAULT_LIMITS,
): FlattenResult {
  const rows: Row[] = [];
  if (!isContainer(root)) {
    // A scalar document is legal JSON. Show it as a single row.
    if (root !== undefined) {
      rows.push({
        kind: 'leaf',
        key: '',
        depth: 0,
        parent: -1,
        size: 0,
        indexInParent: 0,
        siblingCount: 1,
        value: root,
      });
    }
    return { rows, truncated: false };
  }

  const makeFrame = (container: object, depth: number, parent: number): Frame => {
    const isArray = Array.isArray(container);
    const keys = isArray ? null : Object.keys(container);
    const n = isArray ? (container as unknown[]).length : keys!.length;
    const shown = Math.min(n, state.revealed.get(container) ?? limits.defaultReveal);
    return { container, isArray, keys, n, shown, i: 0, depth, parent };
  };

  const stack: Frame[] = [makeFrame(root, 0, -1)];
  let truncated = false;

  while (stack.length > 0) {
    const f = stack[stack.length - 1];

    // Frame exhausted: emit its `more` affordance, then pop.
    if (f.i >= f.shown) {
      if (f.shown < f.n) {
        if (rows.length >= limits.maxRows) {
          truncated = true;
          break;
        }
        rows.push({
          kind: 'more',
          key: '',
          depth: f.depth,
          parent: f.parent,
          size: 0,
          // The affordance sits after the last shown child, as an extra sibling.
          indexInParent: f.shown,
          siblingCount: f.shown + 1,
          more: { ref: f.container, shown: f.shown, total: f.n },
        });
      }
      stack.pop();
      continue;
    }

    if (rows.length >= limits.maxRows) {
      truncated = true;
      break;
    }

    const childIndex = f.i;
    const key = f.isArray ? f.i : f.keys![f.i];
    const value = (f.container as Record<string | number, unknown>)[key];
    f.i++;

    const container = isContainer(value);
    const index = rows.length;
    rows.push({
      kind: container ? (Array.isArray(value) ? 'array' : 'object') : 'leaf',
      key,
      depth: f.depth,
      parent: f.parent,
      size: container ? childCount(value) : 0,
      indexInParent: childIndex,
      // A "more" row will be appended as one extra sibling when some are hidden.
      siblingCount: f.shown < f.n ? f.shown + 1 : f.n,
      ref: container ? value : undefined,
      value,
    });

    if (container && isOpen(state, value, f.depth) && f.depth + 1 < limits.maxDepth) {
      stack.push(makeFrame(value, f.depth + 1, index));
    }
  }

  return { rows, truncated };
}

/** Collect every container in a value, for expand-all. */
export function allContainers(root: unknown, cap = Number.POSITIVE_INFINITY): Set<object> {
  const out = new Set<object>();
  if (!isContainer(root)) return out;
  const stack: object[] = [root];
  out.add(root);
  while (stack.length > 0 && out.size < cap) {
    const v = stack.pop()!;
    if (Array.isArray(v)) {
      for (const child of v) {
        if (isContainer(child) && !out.has(child)) {
          out.add(child);
          stack.push(child);
        }
      }
    } else {
      for (const k of Object.keys(v)) {
        const child = (v as Record<string, unknown>)[k];
        if (isContainer(child) && !out.has(child)) {
          out.add(child);
          stack.push(child);
        }
      }
    }
  }
  return out;
}

/** Total node count of a value (every key/index position, containers included). */
export function countNodes(root: unknown): number {
  if (!isContainer(root)) return root === undefined ? 0 : 1;
  let n = 0;
  const stack: object[] = [root];
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (Array.isArray(v)) {
      n += v.length;
      for (const child of v) if (isContainer(child)) stack.push(child);
    } else {
      const keys = Object.keys(v);
      n += keys.length;
      for (const k of keys) {
        const child = (v as Record<string, unknown>)[k];
        if (isContainer(child)) stack.push(child);
      }
    }
  }
  return n;
}

/**
 * Node count, abandoning the walk once `cap` is passed.
 *
 * Used to decide whether a subtree is small enough to serialise. Without this,
 * "copy subtree" on the document root would stringify the whole file -- tens of
 * megabytes and ~110ms -- only to then refuse it for being too large.
 */
export function countNodesUpTo(root: unknown, cap: number): number {
  if (!isContainer(root)) return root === undefined ? 0 : 1;
  let n = 0;
  const stack: object[] = [root];
  while (stack.length > 0) {
    if (n > cap) return n;
    const v = stack.pop()!;
    if (Array.isArray(v)) {
      n += v.length;
      for (const child of v) if (isContainer(child)) stack.push(child);
    } else {
      const keys = Object.keys(v);
      n += keys.length;
      for (const k of keys) {
        const child = (v as Record<string, unknown>)[k];
        if (isContainer(child)) stack.push(child);
      }
    }
  }
  return n;
}
