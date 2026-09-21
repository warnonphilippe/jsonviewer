import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AppIcon } from '../ui/icon';
import { ViewerStore } from '../state/viewer.store';
import { NodeActions } from '../state/node-actions';
import { Row } from '../core/flatten';
import { ITEM } from '../core/schema';

/** One clickable step of the trail. */
interface Crumb {
  readonly index: number;
  readonly label: string;
  readonly isIndex: boolean;
  readonly isLast: boolean;
}

/** Beyond this many steps the middle is elided rather than scrolled. */
const MAX_CRUMBS = 7;

/**
 * Where you are, as a clickable trail, plus the controls that act on the
 * position rather than on the document.
 *
 * The trail follows the cursor when there is one and the top of the viewport
 * otherwise, so it says something useful whether you are navigating by keyboard
 * or just scrolling.
 */
@Component({
  selector: 'app-breadcrumb',
  imports: [AppIcon],
  templateUrl: './breadcrumb.html',
  styleUrl: './breadcrumb.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppBreadcrumb {
  protected readonly store = inject(ViewerStore);
  protected readonly actions = inject(NodeActions);

  protected readonly isStructure = computed(() => this.store.view() === 'structure');

  /** True once a row is actually focused, which is what the actions act on. */
  protected readonly hasFocus = computed(() => this.store.focusIndex() >= 0);

  protected readonly crumbs = computed<readonly Crumb[]>(() => {
    const rows = this.store.rows();
    const trail = this.store.breadcrumbTrail();
    return trail.map((index, position) => ({
      index,
      label: labelOf(rows[index]),
      isIndex: isIndexKey(rows[index]),
      isLast: position === trail.length - 1,
    }));
  });

  /**
   * The trail with its middle replaced by a gap when it is too long.
   *
   * Eliding beats scrolling here: the two ends are what locate you, and a bar
   * that scrolls sideways as you move the cursor is unreadable.
   */
  protected readonly shown = computed<readonly Crumb[]>(() => {
    const crumbs = this.crumbs();
    if (crumbs.length <= MAX_CRUMBS) return crumbs;
    return [...crumbs.slice(0, 2), ...crumbs.slice(crumbs.length - (MAX_CRUMBS - 2))];
  });

  protected readonly elided = computed(() => this.crumbs().length > MAX_CRUMBS);

  protected goTo(index: number): void {
    this.store.goToRow(index);
  }
}

function labelOf(row: Row | undefined): string {
  if (!row) return '';
  if (row.key === '') return '""';
  return typeof row.key === 'number' ? `[${row.key}]` : String(row.key);
}

function isIndexKey(row: Row | undefined): boolean {
  if (!row) return false;
  // A structure row's `[]` is a wildcard, not a key literally named "[]".
  return typeof row.key === 'number' || (!!row.meta && row.key === ITEM);
}
