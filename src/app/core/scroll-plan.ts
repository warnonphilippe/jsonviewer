/**
 * Where to scroll so a row lands somewhere useful.
 *
 * This replaces arithmetic that used to sit inline in the tree component, and
 * fixes a bug it had: the "already visible, don't scroll" shortcut compared
 * against `CdkVirtualScrollViewport.getRenderedRange().start`, which is the
 * start of the *buffered* range, not the first *visible* row. The buffer
 * extends above the viewport, so the shortcut fired for rows that were in the
 * DOM but off-screen, and navigation silently did nothing.
 *
 * The first visible index now comes from the viewport's own
 * `scrolledIndexChange`, which reports exactly `floor(scrollOffset / itemSize)`.
 */

import { Row } from './flatten';
import { stickyPlan } from './sticky';

/** Rows of context kept above a row we scroll to. */
export const SCROLL_CONTEXT_ROWS = 3;

/**
 * The index to scroll to the top of the viewport so that `index` is visible
 * with some context above it and clear of the pinned ancestors, or `null` when
 * it is already comfortably on screen and scrolling would only be jarring.
 *
 * `maxSticky` is how many ancestors the viewport is currently willing to pin;
 * pass 0 when nothing is pinned.
 */
export function scrollTargetFor(
  rows: readonly Row[],
  index: number,
  topIndex: number,
  perScreen: number,
  maxSticky: number,
  context: number = SCROLL_CONTEXT_ROWS,
): number | null {
  if (index < 0 || index >= rows.length) return null;

  // Rows hidden under the pinned stack do not count as visible.
  const firstFree = topIndex + stickyPlan(rows, topIndex, maxSticky).length;
  const lastVisible = topIndex + perScreen - 1;
  if (index >= firstFree + 1 && index <= lastVisible - 1) return null;

  // The stack shown at the destination depends on the destination, so solve it:
  // two passes are enough, because the pinned count only ever shrinks as the
  // target moves up, and it is bounded by `maxSticky`.
  let target = Math.max(0, index - context);
  for (let pass = 0; pass < 2; pass++) {
    const levels = stickyPlan(rows, target, maxSticky).length;
    target = Math.max(0, index - context - levels);
  }
  return target;
}
