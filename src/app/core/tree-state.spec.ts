import {
  EMPTY_STATE,
  TreeState,
  collapseAll,
  expandAll,
  expandToDepth,
  isOpen,
  reveal,
  revealChain,
  toggle,
} from './tree-state';

const a = { tag: 'a' };
const b = { tag: 'b' };

describe('isOpen', () => {
  it('is closed by default', () => {
    expect(isOpen(EMPTY_STATE, a, 0)).toBe(false);
  });

  it('opens what is explicitly expanded', () => {
    const s: TreeState = { ...EMPTY_STATE, expanded: new Set([a]) };
    expect(isOpen(s, a, 0)).toBe(true);
    expect(isOpen(s, b, 0)).toBe(false);
  });

  it('opens everything shallower than autoExpandDepth', () => {
    const s = expandToDepth(EMPTY_STATE, 2);
    expect(isOpen(s, a, 0)).toBe(true);
    expect(isOpen(s, a, 1)).toBe(true);
    expect(isOpen(s, a, 2)).toBe(false);
  });

  it('lets an explicit collapse beat autoExpandDepth', () => {
    const s: TreeState = { ...expandAll(EMPTY_STATE), collapsed: new Set([a]) };
    expect(isOpen(s, a, 0)).toBe(false);
    expect(isOpen(s, b, 0)).toBe(true);
  });

  it('lets an explicit collapse beat an explicit expand', () => {
    const s: TreeState = { ...EMPTY_STATE, expanded: new Set([a]), collapsed: new Set([a]) };
    expect(isOpen(s, a, 0)).toBe(false);
  });
});

describe('toggle', () => {
  it('opens a closed container and closes it again', () => {
    const opened = toggle(EMPTY_STATE, a, 0);
    expect(isOpen(opened, a, 0)).toBe(true);
    const closed = toggle(opened, a, 0);
    expect(isOpen(closed, a, 0)).toBe(false);
  });

  it('closes a container that is only open because of autoExpandDepth', () => {
    // The regression this guards: toggling against the raw `expanded` set would
    // add the container and appear to do nothing.
    const s = expandAll(EMPTY_STATE);
    expect(isOpen(s, a, 0)).toBe(true);
    const after = toggle(s, a, 0);
    expect(isOpen(after, a, 0)).toBe(false);
    expect(after.collapsed.has(a)).toBe(true);
  });

  it('reopens a container that was explicitly collapsed under expand-all', () => {
    const s = toggle(expandAll(EMPTY_STATE), a, 0);
    const reopened = toggle(s, a, 0);
    expect(isOpen(reopened, a, 0)).toBe(true);
    expect(reopened.collapsed.has(a)).toBe(false);
  });

  it('does not mutate the state it is given', () => {
    const before = EMPTY_STATE;
    toggle(before, a, 0);
    expect(before.expanded.size).toBe(0);
    expect(before.collapsed.size).toBe(0);
  });

  it('leaves other containers alone', () => {
    const s = toggle(toggle(EMPTY_STATE, a, 0), b, 0);
    expect(isOpen(s, a, 0)).toBe(true);
    expect(isOpen(s, b, 0)).toBe(true);
  });
});

describe('bulk operations', () => {
  it('expandAll is a rule, not an enumeration', () => {
    // The point: no set of containers is materialised, so this is O(1) even for
    // the 93,758 containers of the reference file.
    const s = expandAll(EMPTY_STATE);
    expect(s.expanded.size).toBe(0);
    expect(s.autoExpandDepth).toBe(Number.POSITIVE_INFINITY);
    expect(isOpen(s, a, 10_000)).toBe(true);
  });

  it('expandToDepth discards manual overrides', () => {
    const s = expandToDepth({ ...EMPTY_STATE, expanded: new Set([a]), collapsed: new Set([b]) }, 3);
    expect(s.expanded.size).toBe(0);
    expect(s.collapsed.size).toBe(0);
    expect(s.autoExpandDepth).toBe(3);
  });

  it('collapseAll clears everything including reveals', () => {
    const s = collapseAll(reveal(expandAll(EMPTY_STATE), a, 500));
    expect(s.autoExpandDepth).toBe(0);
    expect(s.expanded.size).toBe(0);
    expect(s.collapsed.size).toBe(0);
    expect(s.revealed.size).toBe(0);
    expect(isOpen(s, a, 0)).toBe(false);
  });
});

describe('revealChain', () => {
  it('opens every ancestor and clears their collapses', () => {
    const s = revealChain({ ...EMPTY_STATE, collapsed: new Set([a]) }, [a, b]);
    expect(isOpen(s, a, 0)).toBe(true);
    expect(isOpen(s, b, 0)).toBe(true);
    expect(s.collapsed.has(a)).toBe(false);
  });

  it('accepts an empty chain', () => {
    expect(revealChain(EMPTY_STATE, []).expanded.size).toBe(0);
  });
});

describe('reveal', () => {
  it('records a per-container child budget', () => {
    const s = reveal(EMPTY_STATE, a, 20_000);
    expect(s.revealed.get(a)).toBe(20_000);
  });

  it('overwrites a previous budget for the same container', () => {
    const s = reveal(reveal(EMPTY_STATE, a, 10), a, 20);
    expect(s.revealed.get(a)).toBe(20);
    expect(s.revealed.size).toBe(1);
  });
});
