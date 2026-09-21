/**
 * Expansion state, shared by both views.
 *
 * Everything is keyed by object identity -- containers from the parsed graph in
 * the data view, SchemaNodes in the structure view. No string paths.
 *
 * `autoExpandDepth` is what makes "expand all" and "expand to depth N" O(1)
 * instead of materialising a set of all 93,758 containers: it is a rule, not an
 * enumeration. `collapsed` holds the explicit exceptions to that rule, so a user
 * can close one branch of an expand-all without discarding it.
 */

export interface TreeState {
  /** Explicitly opened. */
  readonly expanded: ReadonlySet<object>;
  /** Explicitly closed. Beats `autoExpandDepth`. */
  readonly collapsed: ReadonlySet<object>;
  /** Open everything shallower than this. 0 = nothing, Infinity = expand all. */
  readonly autoExpandDepth: number;
  /** Per-container override of how many children to reveal. */
  readonly revealed: ReadonlyMap<object, number>;
}

export const EMPTY_STATE: TreeState = {
  expanded: new Set(),
  collapsed: new Set(),
  autoExpandDepth: 0,
  revealed: new Map(),
};

/** Is this container open, taking the auto-expand rule and its exceptions into account? */
export function isOpen(state: TreeState, ref: object, depth: number): boolean {
  if (state.collapsed.has(ref)) return false;
  if (state.expanded.has(ref)) return true;
  return depth < state.autoExpandDepth;
}

function withItem<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  next.add(item);
  return next;
}

function withoutItem<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set);
  next.delete(item);
  return next;
}

/**
 * Flip one container. Toggles against the *effective* state, so a click behaves
 * correctly even when the row is only open because of `autoExpandDepth`.
 */
export function toggle(state: TreeState, ref: object, depth: number): TreeState {
  return isOpen(state, ref, depth)
    ? {
        ...state,
        expanded: withoutItem(state.expanded, ref),
        collapsed: withItem(state.collapsed, ref),
      }
    : {
        ...state,
        expanded: withItem(state.expanded, ref),
        collapsed: withoutItem(state.collapsed, ref),
      };
}

/** Open every container shallower than `depth`, discarding manual overrides. */
export function expandToDepth(state: TreeState, depth: number): TreeState {
  return { ...state, expanded: new Set(), collapsed: new Set(), autoExpandDepth: depth };
}

export function expandAll(state: TreeState): TreeState {
  return expandToDepth(state, Number.POSITIVE_INFINITY);
}

export function collapseAll(state: TreeState): TreeState {
  return { ...state, expanded: new Set(), collapsed: new Set(), autoExpandDepth: 0, revealed: new Map() };
}

/**
 * Open every container in `refs`, clearing any explicit collapse on them.
 *
 * Serves both callers that have a chain (revealing a search hit) and callers
 * that have a whole subtree ("expand this branch"), which are the same
 * operation over a different set.
 */
export function expandContainers(state: TreeState, refs: Iterable<object>): TreeState {
  const expanded = new Set(state.expanded);
  const collapsed = new Set(state.collapsed);
  for (const ref of refs) {
    expanded.add(ref);
    collapsed.delete(ref);
  }
  return { ...state, expanded, collapsed };
}

/** Open a chain of ancestors, e.g. to reveal a search hit. */
export function revealChain(state: TreeState, chain: readonly object[]): TreeState {
  return expandContainers(state, chain);
}

/** Show `count` children of one container. */
export function reveal(state: TreeState, ref: object, count: number): TreeState {
  const revealed = new Map(state.revealed);
  revealed.set(ref, count);
  return { ...state, revealed };
}
