import { DEFAULT_LIMITS, allContainers, flatten } from './flatten';
import { EMPTY_STATE } from './tree-state';
import { SCROLL_CONTEXT_ROWS, scrollTargetFor } from './scroll-plan';
import { stickyPlan } from './sticky';

const flattenAll = (doc: unknown) =>
  flatten(doc, { ...EMPTY_STATE, expanded: allContainers(doc) }, DEFAULT_LIMITS).rows;

/** One container holding `n` leaves, then a sibling that closes it. */
const wide = (n: number) => ({
  a: Object.fromEntries([...Array(n)].map((_, i) => ['k' + i, i])),
  z: 0,
});

describe('scrollTargetFor', () => {
  const PER_SCREEN = 30;

  it('refuses an index outside the rows', () => {
    const rows = flattenAll(wide(50));
    expect(scrollTargetFor(rows, -1, 0, PER_SCREEN, 5)).toBeNull();
    expect(scrollTargetFor(rows, rows.length, 0, PER_SCREEN, 5)).toBeNull();
  });

  it('does not scroll for a row sitting comfortably mid-viewport', () => {
    const rows = flattenAll(wide(100));
    expect(scrollTargetFor(rows, 20, 10, PER_SCREEN, 0)).toBeNull();
  });

  it('DOES scroll for a row hidden under the pinned stack', () => {
    // This is the regression this module exists for: row 11 is the first row
    // below the top edge, but with one ancestor pinned it is covered.
    const rows = flattenAll(wide(100));
    expect(scrollTargetFor(rows, 11, 10, PER_SCREEN, 0)).toBeNull();
    expect(scrollTargetFor(rows, 11, 10, PER_SCREEN, 5)).not.toBeNull();
  });

  it('scrolls for a row below the fold', () => {
    const rows = flattenAll(wide(100));
    expect(scrollTargetFor(rows, 80, 10, PER_SCREEN, 0)).not.toBeNull();
  });

  it('leaves room for both the context rows and the pinned stack', () => {
    const rows = flattenAll(wide(200));
    const index = 150;
    const target = scrollTargetFor(rows, index, 0, PER_SCREEN, 5);

    expect(target).not.toBeNull();
    const levels = stickyPlan(rows, target!, 5).length;
    expect(index - target!).toBeGreaterThanOrEqual(levels + SCROLL_CONTEXT_ROWS);
  });

  it('clamps at the top of the list', () => {
    const rows = flattenAll(wide(100));
    expect(scrollTargetFor(rows, 1, 60, PER_SCREEN, 5)).toBe(0);
    expect(scrollTargetFor(rows, 0, 60, PER_SCREEN, 5)).toBe(0);
  });

  it('is stable -- a third pass would change nothing', () => {
    const rows = flattenAll({
      a: { b: { c: Object.fromEntries([...Array(80)].map((_, i) => ['k' + i, i])) } },
    });
    // Below the fold, so a target is always computed rather than short-circuited.
    for (const index of [40, 50, 60, 70, 80]) {
      const target = scrollTargetFor(rows, index, 0, PER_SCREEN, 5)!;
      const levels = stickyPlan(rows, target, 5).length;
      // Re-running the fixed point on the settled target reproduces it.
      expect(Math.max(0, index - SCROLL_CONTEXT_ROWS - levels)).toBe(target);
    }
  });

  it('never returns a negative index', () => {
    const rows = flattenAll(wide(40));
    for (let i = 0; i < rows.length; i++) {
      const target = scrollTargetFor(rows, i, 30, PER_SCREEN, 5);
      if (target !== null) expect(target).toBeGreaterThanOrEqual(0);
    }
  });
});
