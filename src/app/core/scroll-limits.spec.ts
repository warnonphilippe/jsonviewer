import {
  ABSOLUTE_MAX_ROWS,
  CONSERVATIVE_MAX_HEIGHT_PX,
  maxRowsFor,
  probeMaxElementHeight,
  resetProbeCache,
} from './scroll-limits';

describe('probeMaxElementHeight', () => {
  beforeEach(resetProbeCache);

  it('falls back to the most conservative engine limit when it cannot measure', () => {
    // jsdom reports offsetHeight 0, so the probe must not invent a number.
    expect(probeMaxElementHeight()).toBe(CONSERVATIVE_MAX_HEIGHT_PX);
  });

  it('caches its result', () => {
    const createElement = vi.spyOn(document, 'createElement');
    probeMaxElementHeight();
    probeMaxElementHeight();
    probeMaxElementHeight();
    expect(createElement).toHaveBeenCalledTimes(1);
    createElement.mockRestore();
  });

  it('cleans up its probe element', () => {
    const before = document.body.childElementCount;
    probeMaxElementHeight();
    expect(document.body.childElementCount).toBe(before);
  });
});

describe('maxRowsFor', () => {
  it('derives a row cap from the engine clamp with headroom', () => {
    // 1,000,000px of clamp at 20px rows, minus 10% safety.
    expect(maxRowsFor(20, 1_000_000)).toBe(45_000);
  });

  it('never exceeds the absolute cap', () => {
    expect(maxRowsFor(1, 1_000_000_000)).toBe(ABSOLUTE_MAX_ROWS);
  });

  it('never drops below a usable floor', () => {
    expect(maxRowsFor(1000, 1000)).toBe(1000);
  });

  it('keeps the whole fully-expanded reference document out of reach of the clamp', () => {
    // 1,867,217 nodes at 24px would need 44.8M px of spacer, which exceeds
    // every engine's clamp -- so the cap MUST come in below that.
    const cap = maxRowsFor(24, CONSERVATIVE_MAX_HEIGHT_PX);
    expect(cap).toBeLessThan(1_867_217);
    expect(cap * 24).toBeLessThan(CONSERVATIVE_MAX_HEIGHT_PX);
  });
});
