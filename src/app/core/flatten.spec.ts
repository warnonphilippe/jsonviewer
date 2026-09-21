import {
  DEFAULT_LIMITS,
  FlattenLimits,
  Row,
  allContainers,
  childCount,
  countNodes,
  countNodesUpTo,
  flatten,
  isContainer,
} from './flatten';
import { EMPTY_STATE, TreeState } from './tree-state';

/** A state with exactly these containers open. */
function open(refs: Iterable<object>): TreeState {
  return { ...EMPTY_STATE, expanded: new Set(refs) };
}

/** A state that reveals `count` children of `ref`. */
function revealing(refs: Iterable<object>, ref: object, count: number): TreeState {
  return { ...open(refs), revealed: new Map([[ref, count]]) };
}

/** Flatten with everything expanded -- the common case in these tests. */
function flattenAll(root: unknown, limits: Partial<FlattenLimits> = {}) {
  return flatten(root, open(allContainers(root)), { ...DEFAULT_LIMITS, ...limits });
}

function keysOf(rows: readonly Row[]): (string | number)[] {
  return rows.map((r) => r.key);
}

describe('flatten', () => {
  it('emits nothing for undefined and one row for a scalar document', () => {
    expect(flattenAll(undefined).rows).toEqual([]);
    const { rows } = flattenAll(42);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'leaf', depth: 0, parent: -1, value: 42 });
  });

  it('emits only top-level children when nothing is expanded', () => {
    const doc = { a: { b: 1 }, c: [1, 2] };
    const { rows } = flatten(doc, EMPTY_STATE);
    expect(keysOf(rows)).toEqual(['a', 'c']);
    expect(rows[0]).toMatchObject({ kind: 'object', size: 1, ref: doc.a });
    expect(rows[1]).toMatchObject({ kind: 'array', size: 2, ref: doc.c });
  });

  it('row count equals node count under full expansion', () => {
    const docs: unknown[] = [
      { a: 1 },
      [1, 2, 3],
      { a: { b: { c: [1, { d: 2 }] } } },
      { x: [], y: {}, z: null },
      [[[[1]]]],
    ];
    for (const doc of docs) {
      expect(flattenAll(doc).rows.length).toBe(countNodes(doc));
    }
  });

  it('nests children directly after their parent, in document order', () => {
    const { rows } = flattenAll({ a: { b: 1, c: 2 }, d: 3 });
    expect(keysOf(rows)).toEqual(['a', 'b', 'c', 'd']);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 0]);
  });

  it('every parent points to an earlier container row, and depth increases by exactly one', () => {
    const { rows } = flattenAll({ a: { b: { c: [1, 2] } }, d: [{ e: 1 }] });
    rows.forEach((row, i) => {
      if (row.parent === -1) {
        expect(row.depth).toBe(0);
        return;
      }
      expect(row.parent).toBeLessThan(i);
      const parent = rows[row.parent];
      expect(parent.kind === 'object' || parent.kind === 'array').toBe(true);
      expect(row.depth).toBe(parent.depth + 1);
    });
  });

  it('uses array indices as keys', () => {
    const { rows } = flattenAll(['x', 'y']);
    expect(keysOf(rows)).toEqual([0, 1]);
  });

  it('renders empty containers as childless expandable rows', () => {
    const { rows } = flattenAll({ e: {}, f: [] });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'object', size: 0 });
    expect(rows[1]).toMatchObject({ kind: 'array', size: 0 });
  });

  it('treats null as a leaf, not a container', () => {
    const { rows } = flattenAll({ n: null });
    expect(rows[0]).toMatchObject({ kind: 'leaf', size: 0, value: null });
    expect(rows[0].ref).toBeUndefined();
  });

  it('holds references into the graph rather than copies', () => {
    const inner = { b: 1 };
    const doc = { a: inner };
    const { rows } = flattenAll(doc);
    expect(rows[0].value).toBe(inner);
    expect(rows[0].ref).toBe(inner);
  });

  it('keys expansion by object identity, so equal-looking siblings expand independently', () => {
    const doc = { a: { v: 1 }, b: { v: 1 } };
    const { rows } = flatten(doc, open([doc.a]));
    expect(keysOf(rows)).toEqual(['a', 'v', 'b']);
  });

  it('survives keys that would break any string-path scheme', () => {
    // Built via JSON.parse, exactly as the app obtains its data. This matters for
    // `__proto__`: in an object literal it would set the prototype, but JSON.parse
    // defines it as a real own property, so it must appear as an ordinary row.
    const hostile = JSON.parse(
      '{"a.b":1,"a[0]":2,"a/b":3,"a~b":4,"a\\"b":5,"":6,"line\\nbreak":7,"__proto__":8}',
    );
    const { rows } = flattenAll(hostile);
    expect(keysOf(rows)).toEqual(['a.b', 'a[0]', 'a/b', 'a~b', 'a"b', '', 'line\nbreak', '__proto__']);
    expect(rows).toHaveLength(8);
    expect(rows[7]).toMatchObject({ kind: 'leaf', value: 8 });
  });

  describe('the `more` affordance', () => {
    const doc = { list: Array.from({ length: 10 }, (_, i) => i) };

    it('appears exactly when some children are hidden', () => {
      const under = flatten(doc, open(allContainers(doc)), { ...DEFAULT_LIMITS, defaultReveal: 10 });
      expect(under.rows.some((r) => r.kind === 'more')).toBe(false);

      const over = flatten(doc, open(allContainers(doc)), { ...DEFAULT_LIMITS, defaultReveal: 4 });
      const more = over.rows.filter((r) => r.kind === 'more');
      expect(more).toHaveLength(1);
      expect(more[0].more).toEqual({ ref: doc.list, shown: 4, total: 10 });
    });

    it('trails its container at child depth, and is not a document node', () => {
      const { rows } = flatten(doc, open(allContainers(doc)), { ...DEFAULT_LIMITS, defaultReveal: 2 });
      // list, 0, 1, more
      expect(rows).toHaveLength(4);
      const last = rows[rows.length - 1];
      expect(last.kind).toBe('more');
      expect(last.depth).toBe(rows[1].depth);
      expect(last.value).toBeUndefined();
      expect(last.ref).toBeUndefined();
    });

    it('honours a per-container reveal override', () => {
      const { rows } = flatten(doc, revealing(allContainers(doc), doc.list, 10), {
        ...DEFAULT_LIMITS,
        defaultReveal: 2,
      });
      expect(rows.some((r) => r.kind === 'more')).toBe(false);
      expect(rows).toHaveLength(11);
    });
  });

  describe('truncation', () => {
    it('flags truncation and never emits an orphan child', () => {
      const doc = { a: { b: { c: 1 } }, d: 2 };
      const { rows, truncated } = flattenAll(doc, { maxRows: 2 });
      expect(truncated).toBe(true);
      expect(rows).toHaveLength(2);
      rows.forEach((row, i) => {
        if (row.parent !== -1) expect(row.parent).toBeLessThan(i);
      });
    });

    it('does not flag truncation when everything fits', () => {
      expect(flattenAll({ a: 1 }, { maxRows: 1 }).truncated).toBe(false);
    });
  });

  it('stops descending at maxDepth instead of overflowing the stack', () => {
    // 5000 deep -- a recursive walk would throw here.
    let deep: unknown = 'bottom';
    for (let i = 0; i < 5000; i++) deep = { next: deep };
    const { rows } = flattenAll(deep, { maxDepth: 10 });
    expect(rows).toHaveLength(10);
    expect(rows[9].depth).toBe(9);
  });
});

describe('helpers', () => {
  it('isContainer distinguishes containers from leaves', () => {
    expect(isContainer({})).toBe(true);
    expect(isContainer([])).toBe(true);
    expect(isContainer(null)).toBe(false);
    expect(isContainer('s')).toBe(false);
    expect(isContainer(0)).toBe(false);
  });

  it('childCount counts keys and elements', () => {
    expect(childCount({ a: 1, b: 2 })).toBe(2);
    expect(childCount([1, 2, 3])).toBe(3);
    expect(childCount({})).toBe(0);
  });

  it('allContainers finds every container including the root', () => {
    const doc = { a: { b: [{ c: 1 }] } };
    const found = allContainers(doc);
    expect(found.has(doc)).toBe(true);
    expect(found.size).toBe(4); // doc, a, b, {c}
  });
});

describe('property: flatten is consistent with countNodes', () => {
  /** Small deterministic PRNG so failures reproduce. */
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }

  function randomJson(rand: () => number, depth = 0): unknown {
    const roll = rand();
    if (depth > 4 || roll < 0.4) {
      const leaf = rand();
      if (leaf < 0.25) return null;
      if (leaf < 0.5) return Math.floor(rand() * 1000);
      if (leaf < 0.75) return rand() < 0.5;
      return `s${Math.floor(rand() * 1000)}`;
    }
    const n = Math.floor(rand() * 5);
    if (roll < 0.7) return Array.from({ length: n }, () => randomJson(rand, depth + 1));
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) obj[`k${i}`] = randomJson(rand, depth + 1);
    return obj;
  }

  it('emits exactly one row per node for 200 random documents', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const doc = randomJson(rng(seed));
      const { rows, truncated } = flattenAll(doc);
      expect(truncated).toBe(false);
      expect(rows.length).toBe(countNodes(doc));
      // Structural invariant on every row.
      rows.forEach((row, i) => {
        if (row.parent === -1) return;
        expect(row.parent).toBeLessThan(i);
        expect(row.depth).toBe(rows[row.parent].depth + 1);
      });
    }
  });
});

describe('sibling positions for accessibility', () => {
  it('numbers children within their parent', () => {
    const { rows } = flattenAll({ a: 1, b: { x: 1, y: 2 }, c: 3 });
    expect(rows.map((r) => [r.key, r.indexInParent, r.siblingCount])).toEqual([
      ['a', 0, 3],
      ['b', 1, 3],
      ['x', 0, 2],
      ['y', 1, 2],
      ['c', 2, 3],
    ]);
  });

  it('numbers array elements by index', () => {
    const { rows } = flattenAll(['p', 'q']);
    expect(rows.map((r) => r.indexInParent)).toEqual([0, 1]);
    expect(rows.every((r) => r.siblingCount === 2)).toBe(true);
  });

  it('counts a `more` row as one extra sibling', () => {
    const doc = { list: [1, 2, 3, 4, 5] };
    const { rows } = flatten(doc, open(allContainers(doc)), {
      ...DEFAULT_LIMITS,
      defaultReveal: 2,
    });
    // list, 0, 1, more
    expect(rows.map((r) => [r.kind, r.indexInParent, r.siblingCount])).toEqual([
      ['array', 0, 1],
      ['leaf', 0, 3],
      ['leaf', 1, 3],
      ['more', 2, 3],
    ]);
  });

  it('keeps posinset within setsize for every row', () => {
    const { rows } = flattenAll({ a: [{ b: 1 }, { c: [1, 2] }], d: {} });
    for (const row of rows) {
      expect(row.indexInParent).toBeGreaterThanOrEqual(0);
      expect(row.indexInParent).toBeLessThan(row.siblingCount);
    }
  });
});

describe('countNodesUpTo', () => {
  it('agrees with countNodes below the cap', () => {
    const doc = { a: [1, 2], b: { c: 3 } };
    expect(countNodesUpTo(doc, 1000)).toBe(countNodes(doc));
  });

  it('abandons the walk once the cap is passed', () => {
    const big = { rows: Array.from({ length: 5000 }, (_, i) => ({ i })) };
    const counted = countNodesUpTo(big, 100);
    expect(counted).toBeGreaterThan(100);
    // Crucially, far below the real total -- it stopped early.
    expect(counted).toBeLessThan(countNodes(big));
  });

  it('handles scalars and empty containers', () => {
    expect(countNodesUpTo(5, 10)).toBe(1);
    expect(countNodesUpTo(undefined, 10)).toBe(0);
    expect(countNodesUpTo({}, 10)).toBe(0);
  });
});
