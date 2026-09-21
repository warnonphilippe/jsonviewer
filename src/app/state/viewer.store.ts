/**
 * View state: which view is showing, what is expanded in each, where the
 * keyboard cursor is, and the current search.
 *
 * Each view keeps its own expansion state, so switching tabs does not lose your
 * place, and jumping between the two lands you somewhere related rather than
 * back at the top.
 */

import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { DEFAULT_LIMITS, FlattenLimits, FlattenResult, flatten } from '../core/flatten';
import {
  EMPTY_STATE,
  TreeState,
  collapseAll,
  expandToDepth,
  reveal,
  revealChain,
  toggle,
} from '../core/tree-state';
import { ITEM, flattenSchema, schemaChain } from '../core/schema';
import { firstDataPath, toSchemaKeys } from '../core/schema-link';
import {
  findRowByKeys,
  keyPath,
  keysId,
  toJsAccessor,
  toJsonPointer,
  toSchemaDisplayPath,
} from '../core/path';
import { DEFAULT_SEARCH, NO_RESULT, SearchOptions, SearchResult, searchJson } from '../core/search';
import { maxRowsFor } from '../core/scroll-limits';
import { JsonDocumentStore } from './json-document.store';

export type ViewKind = 'data' | 'structure';

/**
 * Row height in px. Must match --row-height in the stylesheet exactly: the
 * fixed-size scroll strategy trusts this number, and any drift between it and
 * what is painted desynchronises the scrollbar progressively.
 */
export const ROW_HEIGHT = 24;

/** How many more children a "show more" row reveals per click. */
export const REVEAL_STEP = 10_000;

@Injectable({ providedIn: 'root' })
export class ViewerStore {
  private readonly doc = inject(JsonDocumentStore);

  readonly view = signal<ViewKind>('data');

  private readonly dataState = signal<TreeState>(EMPTY_STATE);
  private readonly structureState = signal<TreeState>(EMPTY_STATE);

  /** Keyboard cursor, as an index into the current rows. -1 when unset. */
  readonly focusIndex = signal(-1);

  /**
   * A request to bring a row into view. The store cannot scroll -- only the
   * tree component owns the viewport -- so navigation publishes the target here
   * and the tree reacts once the new rows have been rendered. The counter makes
   * repeat requests for the same index distinguishable.
   */
  readonly scrollTarget = signal<{ index: number; seq: number }>({ index: -1, seq: 0 });

  private scrollSeq = 0;

  /** Ask the tree to scroll a row into view. */
  requestScroll(index: number): void {
    if (index < 0) return;
    this.scrollTarget.set({ index, seq: ++this.scrollSeq });
  }

  /** The search box contents, applied at once; the scan itself is debounced. */
  readonly searchOptions = signal<SearchOptions>(DEFAULT_SEARCH);
  private readonly activeQuery = signal('');
  readonly currentHit = signal(-1);

  readonly limits = computed<FlattenLimits>(() => ({
    ...DEFAULT_LIMITS,
    maxRows: maxRowsFor(ROW_HEIGHT),
  }));

  private readonly state = computed(() =>
    this.view() === 'data' ? this.dataState() : this.structureState(),
  );

  readonly result = computed<FlattenResult>(() => {
    const limits = this.limits();
    if (this.view() === 'structure') {
      const schema = this.doc.schema();
      if (!schema) return { rows: [], truncated: false };
      const rows = flattenSchema(schema, this.structureState(), limits.maxRows);
      return { rows, truncated: rows.length >= limits.maxRows };
    }
    const root = this.doc.root();
    if (root === undefined) return { rows: [], truncated: false };
    return flatten(root, this.dataState(), limits);
  });

  readonly rows = computed(() => this.result().rows);
  readonly truncated = computed(() => this.result().truncated);

  /** The search scan. Runs over the data document only. */
  readonly searchResult = computed<SearchResult>(() => {
    const query = this.activeQuery();
    const root = this.doc.root();
    if (query === '' || root === undefined) return NO_RESULT;
    return searchJson(root, { ...this.searchOptions(), query });
  });

  /**
   * Row indices a search matched, for highlighting.
   *
   * O(hits + rows), not O(hits x rows): hit paths go into a Set keyed by a
   * collision-free identity, then each visible row is tested once. The naive
   * nested comparison was 285 million string compares with 5,000 hits over
   * 57,000 rows, which is why this is worth doing properly.
   */
  readonly matchedRows = computed<ReadonlySet<number>>(() => {
    const result = this.searchResult();
    const rows = this.rows();
    const matched = new Set<number>();
    if (result.total === 0 || this.view() !== 'data') return matched;

    const wanted = new Set(result.hits.map((hit) => keysId(hit.keys)));
    for (let i = 0; i < rows.length; i++) {
      if (wanted.has(keysId(keyPath(rows, i)))) matched.add(i);
    }
    return matched;
  });

  /** The path of the focused row, in both display forms. */
  readonly focusPath = computed(() => {
    const index = this.focusIndex();
    const rows = this.rows();
    if (index < 0 || index >= rows.length) return null;
    const keys = keyPath(rows, index);
    return {
      keys,
      pointer: toJsonPointer(keys),
      // A structure path's `[]` is a wildcard, not a key literally named "[]".
      accessor:
        this.view() === 'structure'
          ? toSchemaDisplayPath(keys.map(String), 'root', ITEM)
          : toJsAccessor(keys),
    };
  });

  private debounce: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Reset per-document view state whenever a different document is opened.
    effect(() => {
      this.doc.root();
      this.dataState.set(EMPTY_STATE);
      this.structureState.set(EMPTY_STATE);
      this.focusIndex.set(-1);
      this.currentHit.set(-1);
      this.activeQuery.set('');
      this.searchOptions.set(DEFAULT_SEARCH);
    });
  }

  // --- expansion ----------------------------------------------------------

  private setState(next: TreeState): void {
    if (this.view() === 'data') this.dataState.set(next);
    else this.structureState.set(next);
  }

  /** Open or close the container on this row. */
  toggleRow(index: number): void {
    const row = this.rows()[index];
    if (!row?.ref) return;
    this.setState(toggle(this.state(), row.ref, row.depth));
  }

  /**
   * Whether this row is open, read from the flattened output rather than the
   * state: a row is open exactly when the next row is one of its children.
   */
  isExpanded(index: number): boolean {
    const rows = this.rows();
    if (!rows[index]?.ref) return false;
    return rows[index + 1]?.parent === index;
  }

  setExpanded(index: number, open: boolean): void {
    if (this.rows()[index]?.ref && this.isExpanded(index) !== open) this.toggleRow(index);
  }

  /** Act on a "show more" row. */
  revealMore(index: number): void {
    const row = this.rows()[index];
    if (!row?.more) return;
    this.setState(reveal(this.state(), row.more.ref, row.more.shown + REVEAL_STEP));
  }

  revealAll(index: number): void {
    const row = this.rows()[index];
    if (!row?.more) return;
    this.setState(reveal(this.state(), row.more.ref, row.more.total));
  }

  expandToDepth(depth: number): void {
    this.setState(expandToDepth(this.state(), depth));
  }

  expandAll(): void {
    this.setState(expandToDepth(this.state(), Number.POSITIVE_INFINITY));
  }

  collapseAll(): void {
    this.setState(collapseAll(this.state()));
    this.focusIndex.set(-1);
  }

  // --- search -------------------------------------------------------------

  setQuery(query: string): void {
    this.searchOptions.update((options) => ({ ...options, query }));
    clearTimeout(this.debounce);
    // A full scan is ~70ms on the reference file, so a debounce keeps typing
    // responsive without needing chunking or a worker.
    this.debounce = setTimeout(() => {
      this.activeQuery.set(query);
      if (query === '') this.currentHit.set(-1);
      else this.goToHit(0);
    }, 150);
  }

  setSearchOption<K extends keyof SearchOptions>(key: K, value: SearchOptions[K]): void {
    this.searchOptions.update((options) => ({ ...options, [key]: value }));
    this.activeQuery.set(this.searchOptions().query);
  }

  clearSearch(): void {
    clearTimeout(this.debounce);
    this.searchOptions.set(DEFAULT_SEARCH);
    this.activeQuery.set('');
    this.currentHit.set(-1);
  }

  /** Move to a hit, opening its ancestors. Returns the row index, or -1. */
  goToHit(position: number): number {
    const hits = this.searchResult().hits;
    if (hits.length === 0) return -1;
    const wrapped = ((position % hits.length) + hits.length) % hits.length;
    const hit = hits[wrapped];
    this.view.set('data');
    this.dataState.set(revealChain(this.dataState(), hit.chain));
    this.currentHit.set(wrapped);
    const index = this.locateByKeys(hit.keys);
    this.requestScroll(index);
    return index;
  }

  nextHit(): number {
    return this.goToHit(this.currentHit() + 1);
  }

  previousHit(): number {
    return this.goToHit(this.currentHit() - 1);
  }

  // --- linking the two views ---------------------------------------------

  /** From a structure row, reveal and focus the first matching data row. */
  showInDataView(index: number): number {
    const rows = this.rows();
    const root = this.doc.root();
    if (this.view() !== 'structure' || !rows[index] || root === undefined) return -1;

    const schemaKeys = keyPath(rows, index).map(String);
    const target = firstDataPath(root, schemaKeys);
    if (target.keys.length === 0) return -1;

    this.view.set('data');
    this.dataState.set(revealChain(this.dataState(), target.chain));
    const landed = this.locateByKeys(target.keys);
    this.requestScroll(landed);
    return landed;
  }

  /** From a data row, reveal and focus the matching structure row. */
  showInStructureView(index: number): number {
    const rows = this.rows();
    const schema = this.doc.schema();
    if (this.view() !== 'data' || !rows[index] || !schema) return -1;

    const schemaKeys = toSchemaKeys(keyPath(rows, index));
    this.view.set('structure');
    this.structureState.set(revealChain(this.structureState(), schemaChain(schema, schemaKeys)));
    const landed = this.locateByKeys(schemaKeys);
    this.requestScroll(landed);
    return landed;
  }

  /** Find the row with this key path in the freshly flattened rows, and focus it. */
  private locateByKeys(keys: readonly (string | number)[]): number {
    const index = findRowByKeys(this.rows(), keys);
    if (index >= 0) this.focusIndex.set(index);
    return index;
  }
}
