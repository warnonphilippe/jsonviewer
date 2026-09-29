import { activeAfterClose, isTabStep, stepTab } from './tab-order';

describe('activeAfterClose', () => {
  it('leaves the active tab alone when a background tab closes', () => {
    expect(activeAfterClose([1, 2, 3], 1, 3)).toBe(1);
    expect(activeAfterClose([1, 2, 3], 3, 1)).toBe(3);
  });

  it('lands on the right-hand neighbour when the active tab closes', () => {
    expect(activeAfterClose([1, 2, 3], 2, 2)).toBe(3);
    expect(activeAfterClose([1, 2, 3], 1, 1)).toBe(2);
  });

  it('falls back to the left-hand neighbour when the last tab closes', () => {
    expect(activeAfterClose([1, 2, 3], 3, 3)).toBe(2);
  });

  it('returns null when nothing is left', () => {
    expect(activeAfterClose([4], 4, 4)).toBeNull();
    expect(activeAfterClose([], 4, 4)).toBeNull();
  });

  it('does not depend on ids being consecutive or ordered', () => {
    expect(activeAfterClose([9, 4, 12], 4, 4)).toBe(12);
  });

  it('recovers when the active id is not in the list', () => {
    expect(activeAfterClose([1, 2, 3], 7, 2)).toBe(3);
  });
});

describe('stepTab', () => {
  const ids = [5, 6, 7];

  it('moves one tab either way', () => {
    expect(stepTab(ids, 6, 'ArrowRight')).toBe(7);
    expect(stepTab(ids, 6, 'ArrowLeft')).toBe(5);
  });

  it('wraps around at both ends', () => {
    expect(stepTab(ids, 7, 'ArrowRight')).toBe(5);
    expect(stepTab(ids, 5, 'ArrowLeft')).toBe(7);
  });

  it('jumps to the first and last tab', () => {
    expect(stepTab(ids, 6, 'Home')).toBe(5);
    expect(stepTab(ids, 6, 'End')).toBe(7);
  });

  it('stays put with a single tab', () => {
    expect(stepTab([3], 3, 'ArrowRight')).toBe(3);
    expect(stepTab([3], 3, 'ArrowLeft')).toBe(3);
  });

  it('returns null when there are no tabs', () => {
    expect(stepTab([], 1, 'Home')).toBeNull();
  });
});

describe('isTabStep', () => {
  it('accepts only the navigation keys', () => {
    expect(isTabStep('ArrowLeft')).toBe(true);
    expect(isTabStep('End')).toBe(true);
    expect(isTabStep('ArrowDown')).toBe(false);
    expect(isTabStep('Delete')).toBe(false);
  });
});
