/**
 * Pinned ancestors -- the rows kept stuck to the top of the viewport so the
 * branch you are inside stays readable while you scroll through its children.
 *
 * All of it is arithmetic over the flat rows, so it lives here rather than in
 * the tree component and is testable without a browser.
 *
 * The rule is one sentence: **pin the ancestors of the first row that will be
 * visible below the stack.** A stack of k rows covers the k rows under the top
 * edge, so the first row you can actually read is `topIndex + k`, and those are
 * the ancestors worth showing. Solving that -- k appears on both sides -- is
 * what the loop does, shrinking until it is consistent.
 *
 * That invariant is what makes a pixel-level "shove" unnecessary. The earlier
 * design translated the whole stack as a branch ended; with more than one level
 * pinned it degenerated into a jump of the full stack height, because the row
 * that closes a branch is always one row below the top edge and never the four
 * or five rows down that a gradual slide would need. Choosing the right rows
 * instead of sliding the wrong ones costs no DOM writes and no scroll listener.
 */

import { Row } from './flatten';
import { ancestorRows } from './path';

/**
 * How many ancestors may be pinned at once.
 *
 * A document may nest up to `DEFAULT_LIMITS.maxDepth` (512) deep; pinning all
 * of it would bury the viewport under its own breadcrumbs. Five is deep enough
 * for the shapes this viewer is built for -- the reference export is three --
 * and costs at most 120px of a 24px-row viewport.
 */
export const MAX_STICKY_LEVELS = 5;

/**
 * Which rows to pin when `topIndex` is the first row under the top edge,
 * root-first.
 *
 * When the chain is longer than the stack, the *deepest* levels are kept: the
 * immediate parents say where you are, the root says nothing you did not
 * already know.
 *
 * Cost is O(maxLevels x depth) and independent of the number of rows -- three
 * or four steps in practice, since it only shrinks when a branch ends right
 * under the top edge.
 */
export function stickyPlan(
  rows: readonly Row[],
  topIndex: number,
  maxLevels: number = MAX_STICKY_LEVELS,
): number[] {
  if (maxLevels <= 0 || topIndex <= 0 || topIndex >= rows.length) return [];

  let levels = Math.min(maxLevels, ancestorRows(rows, topIndex).length);
  while (levels > 0) {
    const firstVisible = topIndex + levels;
    if (firstVisible < rows.length) {
      const chain = ancestorRows(rows, firstVisible);
      // Deep enough to fill the stack: those are the rows to pin.
      if (chain.length >= levels) return chain.slice(chain.length - levels);
    }
    // The branch ends inside the stack, so a shorter stack describes more.
    levels--;
  }
  return [];
}
