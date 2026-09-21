import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { Row } from '../core/flatten';
import { badgeFor, formatScalar, previewContainer } from '../core/preview';
import { ROW_HEIGHT, ViewerStore } from '../state/viewer.store';
import { JsonDocumentStore } from '../state/json-document.store';

/**
 * The virtual-scrolled tree, shared by the data and structure views.
 *
 * Both views produce the same `Row` shape, so one renderer serves both and the
 * fiddly parts -- fixed row geometry, keyboard navigation, focus management and
 * accessibility -- exist once.
 *
 * The viewport is a single tab stop using active-descendant semantics. Making
 * every row focusable would be unusable at this scale, and only ~40 rows exist
 * in the DOM at any time anyway, which is also why each rendered row must carry
 * `aria-setsize`/`aria-posinset`: without them a screen reader would be told the
 * tree is 40 items long.
 */
@Component({
  selector: 'app-json-tree',
  imports: [ScrollingModule],
  templateUrl: './json-tree.html',
  styleUrl: './json-tree.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonTree {
  protected readonly store = inject(ViewerStore);
  protected readonly doc = inject(JsonDocumentStore);

  private readonly viewport = viewChild<CdkVirtualScrollViewport>('viewport');
  private readonly treeElement = viewChild<ElementRef<HTMLElement>>('tree');

  protected readonly rowHeight = ROW_HEIGHT;
  protected readonly rows = this.store.rows;
  protected readonly focusIndex = this.store.focusIndex;
  protected readonly matched = this.store.matchedRows;

  /** The row the current search hit sits on, for a stronger highlight. */
  protected readonly currentHitRow = computed(() => {
    const position = this.store.currentHit();
    const hits = this.store.searchResult().hits;
    if (position < 0 || position >= hits.length) return -1;
    return this.focusIndex();
  });

  protected readonly activeId = computed(() => {
    const index = this.focusIndex();
    return index >= 0 ? `tree-row-${index}` : null;
  });

  protected readonly ariaLabel = computed(() =>
    this.store.view() === 'data' ? 'JSON data tree' : 'JSON structure tree',
  );

  private lastScrollSeq = 0;

  constructor() {
    // Navigation (search, view jumps) publishes a target on the store; act on it
    // only once the newly expanded rows have actually been rendered, otherwise
    // scrollToIndex would work against stale geometry.
    afterRenderEffect(() => {
      const target = this.store.scrollTarget();
      if (target.index < 0 || target.seq === this.lastScrollSeq) return;
      this.lastScrollSeq = target.seq;
      this.scrollTo(target.index);
    });
  }

  /** cdkVirtualFor tracking. Positional, which maximises DOM reuse for a list
   * whose identity genuinely is its position. */
  protected readonly trackByIndex = (index: number): number => index;

  /** Glyphs live here rather than in the template, where escapes are literal. */
  private static readonly OPEN = '\u25be'; // down-pointing triangle
  private static readonly CLOSED = '\u25b8'; // right-pointing triangle

  protected twisty(row: Row, index: number): string {
    if (!row.ref) return '';
    return this.isExpanded(index) ? JsonTree.OPEN : JsonTree.CLOSED;
  }

  /** An empty-string key would otherwise render as nothing at all. */
  protected keyLabel(row: Row): string {
    return row.key === '' ? '""' : String(row.key);
  }

  /** Array indices are positions, not names, and are styled differently. */
  protected isIndexKey(row: Row): boolean {
    return !row.meta && typeof row.key === 'number';
  }

  protected sizeLabel(row: Row): string {
    return row.size.toLocaleString();
  }

  protected hiddenCount(row: Row): string {
    return row.more ? (row.more.total - row.more.shown).toLocaleString() : '';
  }

  protected totalCount(row: Row): string {
    return row.more ? row.more.total.toLocaleString() : '';
  }

  protected badge(row: Row): string {
    if (row.meta) {
      // Structure rows already carry their type union.
      return this.typeOf(row);
    }
    return badgeFor(row.value);
  }

  protected typeOf(row: Row): string {
    if (!row.meta) return badgeFor(row.value);
    const parts: string[] = [];
    if (row.kind === 'array') parts.push('array');
    else if (row.kind === 'object') parts.push('object');
    const scalars = [...row.meta.types].sort((a, b) =>
      a === 'null' ? 1 : b === 'null' ? -1 : a.localeCompare(b),
    );
    parts.push(...scalars);
    return parts.length > 0 ? parts.join(' | ') : 'unknown';
  }

  /** The value column of a data row. */
  protected valueText(row: Row): string {
    if (row.ref) return previewContainer(row.ref);
    return formatScalar(row.value);
  }

  /** The stats column of a structure row. */
  protected statsText(row: Row): string {
    const meta = row.meta;
    if (!meta) return '';
    const parts: string[] = [];
    parts.push(`${meta.count.toLocaleString()}/${meta.parentCount.toLocaleString()}`);
    if (meta.count < meta.parentCount) {
      const percent = meta.parentCount === 0 ? 0 : (meta.count / meta.parentCount) * 100;
      parts.push(`optional ${percent.toFixed(percent < 10 ? 1 : 0)}%`);
    }
    if (meta.nulls > 0) {
      parts.push(
        meta.nulls === meta.count
          ? 'always null'
          : `${meta.nulls.toLocaleString()} null`,
      );
    }
    if (meta.empties > 0) {
      parts.push(
        meta.empties === meta.count
          ? 'always empty'
          : `${meta.empties.toLocaleString()} empty`,
      );
    }
    if (meta.lengths) {
      parts.push(
        meta.lengths.min === meta.lengths.max
          ? `len ${meta.lengths.min.toLocaleString()}`
          : `len ${meta.lengths.min.toLocaleString()}..${meta.lengths.max.toLocaleString()}`,
      );
    }
    return parts.join(' · ');
  }

  protected isExpanded(index: number): boolean {
    return this.store.isExpanded(index);
  }

  protected onRowClick(index: number, row: Row): void {
    this.focusIndex.set(index);
    if (row.ref) this.store.toggleRow(index);
  }

  protected onMore(index: number, all: boolean, event: Event): void {
    event.stopPropagation();
    if (all) this.store.revealAll(index);
    else this.store.revealMore(index);
  }

  /** Move the cursor and bring it into view. */
  private focusRow(index: number): void {
    const rows = this.rows();
    if (rows.length === 0) return;
    const clamped = Math.max(0, Math.min(index, rows.length - 1));
    this.focusIndex.set(clamped);
    this.scrollTo(clamped);
  }

  /** Scroll a row into view, keeping a little context above it. */
  scrollTo(index: number): void {
    const viewport = this.viewport();
    if (!viewport) return;
    const range = viewport.getRenderedRange();
    const perScreen = Math.max(1, Math.floor(viewport.getViewportSize() / this.rowHeight));
    if (index >= range.start + 2 && index < range.start + perScreen - 2) return;
    viewport.scrollToIndex(Math.max(0, index - 3));
  }

  focus(): void {
    this.treeElement()?.nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    if (rows.length === 0) return;
    const current = this.focusIndex();
    const index = current < 0 ? 0 : current;
    const row = rows[index];
    const viewport = this.viewport();
    const perScreen = viewport
      ? Math.max(1, Math.floor(viewport.getViewportSize() / this.rowHeight) - 1)
      : 10;

    switch (event.key) {
      case 'ArrowDown':
        this.focusRow(current < 0 ? 0 : index + 1);
        break;
      case 'ArrowUp':
        this.focusRow(current < 0 ? 0 : index - 1);
        break;
      case 'ArrowRight':
        if (row?.ref && !this.isExpanded(index)) this.store.setExpanded(index, true);
        else if (rows[index + 1]?.parent === index) this.focusRow(index + 1);
        else return; // nothing to do; let the key through
        break;
      case 'ArrowLeft':
        if (row?.ref && this.isExpanded(index)) this.store.setExpanded(index, false);
        else if (row && row.parent >= 0) this.focusRow(row.parent);
        else return;
        break;
      case 'Enter':
      case ' ':
        if (row?.more) this.store.revealMore(index);
        else if (row?.ref) this.store.toggleRow(index);
        else return;
        break;
      case 'Home':
        this.focusRow(0);
        break;
      case 'End':
        this.focusRow(rows.length - 1);
        break;
      case 'PageDown':
        this.focusRow(index + perScreen);
        break;
      case 'PageUp':
        this.focusRow(index - perScreen);
        break;
      case '*':
        this.store.expandAll();
        break;
      case 'j':
        // The store publishes a scroll target; afterRenderEffect acts on it.
        if (this.store.view() === 'data') this.store.showInStructureView(index);
        else this.store.showInDataView(index);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}
