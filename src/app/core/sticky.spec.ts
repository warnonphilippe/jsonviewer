import { DEFAULT_LIMITS, allContainers, flatten } from './flatten';
import { EMPTY_STATE } from './tree-state';
import { MAX_STICKY_LEVELS, stickyPlan } from './sticky';

const flattenAll = (doc: unknown) =>
  flatten(doc, { ...EMPTY_STATE, expanded: allContainers(doc) }, DEFAULT_LIMITS).rows;

/** Nest `depth` objects, the innermost holding `leaves` leaves. */
function nest(depth: number, leaves = 2): unknown {
  const inner: Record<string, number> = {};
  for (let i = 0; i < leaves; i++) inner['leaf' + i] = i;
  let value: unknown = inner;
  for (let i = depth; i > 0; i--) value = { ['level' + i]: value };
  return value;
}

describe('stickyPlan', () => {
  it('pins nothing at the very top, or out of range', () => {
    const rows = flattenAll({ a: { b: 1 } });
    expect(stickyPlan(rows, 0)).toEqual([]);
    expect(stickyPlan(rows, -1)).toEqual([]);
    expect(stickyPlan(rows, rows.length)).toEqual([]);
    expect(stickyPlan(rows, 999)).toEqual([]);
  });

  it('pins nothing for a cap of 0 -- the setting being off', () => {
    const rows = flattenAll(nest(4, 20));
    const target = rows.findIndex((r) => r.key === 'leaf0');
    expect(stickyPlan(rows, target, 0)).toEqual([]);
  });

  it('pins the ancestor chain, root-first, inside a long branch', () => {
    // 20 leaves, so the branch runs well past the bottom of any stack.
    const rows = flattenAll({
      a: { b: { c: Object.fromEntries([...Array(20)].map((_, i) => ['k' + i, i])) } },
    });
    const target = rows.findIndex((r) => r.key === 'k0');
    expect(stickyPlan(rows, target).map((i) => rows[i].key)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the DEEPEST levels when the chain is longer than the cap', () => {
    const rows = flattenAll(nest(9, 20));
    const target = rows.findIndex((r) => r.key === 'leaf0');
    const pinned = stickyPlan(rows, target);

    expect(pinned.length).toBe(MAX_STICKY_LEVELS);
    expect(pinned.map((i) => rows[i].key)).toEqual([
      'level5',
      'level6',
      'level7',
      'level8',
      'level9',
    ]);
  });

  it('honours a custom cap', () => {
    const rows = flattenAll(nest(9, 20));
    const target = rows.findIndex((r) => r.key === 'leaf0');
    expect(stickyPlan(rows, target, 2).map((i) => rows[i].key)).toEqual(['level8', 'level9']);
  });

  it('shrinks the stack rather than hiding rows the branch does not contain', () => {
    // `d` holds exactly one row, then `sibling` closes it. A four-deep stack
    // would cover `sibling`, which `d` does not describe.
    const rows = flattenAll({ a: { b: { c: { d: { only: 1 }, sibling: 2 } } } });
    const top = rows.findIndex((r) => r.key === 'only');

    const pinned = stickyPlan(rows, top);
    const deepest = rows[pinned[pinned.length - 1]].depth;

    // Whatever it pins, every row the stack covers is inside the deepest pin.
    for (let j = top; j < top + pinned.length; j++) {
      expect(rows[j].depth).toBeGreaterThan(deepest);
    }
  });

  /**
   * Note on what is NOT promised: like every sticky-scroll implementation, the
   * stack occludes the rows immediately under the top edge, so a sibling of a
   * pinned node can be hidden until you scroll a row or two further. That is
   * the trade-off of the mechanism, not a defect -- what must hold is that
   * everything pinned genuinely describes the first row you can read.
   */
  it('pins only true ancestors of the first readable row, root-first and capped', () => {
    // Swept over a realistic shape: records of uneven depth, some empty arrays.
    const rows = flattenAll({
      meta: { a: 1, b: 2 },
      tables: [...Array(6)].map((_, t) => ({
        name: 'T' + t,
        rows: [...Array(4)].map((_, r) => ({
          ID: r,
          address: { street: 's', city: 'c' },
          tags: r % 2 ? [] : ['x', 'y'],
        })),
      })),
      stats: { nodes: 1 },
    });

    for (let top = 0; top < rows.length; top++) {
      const pinned = stickyPlan(rows, top);
      expect(pinned.length).toBeLessThanOrEqual(MAX_STICKY_LEVELS);
      expect(pinned).toEqual([...pinned].sort((x, y) => x - y));
      if (pinned.length === 0) continue;

      const firstReadable = top + pinned.length;
      if (firstReadable >= rows.length) continue;

      const ancestors = new Set<number>();
      let walk = rows[firstReadable].parent;
      while (walk >= 0) {
        ancestors.add(walk);
        walk = rows[walk].parent;
      }
      for (const index of pinned) expect(ancestors.has(index)).toBe(true);
    }
  });
});
