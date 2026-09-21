import {
  MAX_PREVIEW,
  badgeFor,
  escapeControlChars,
  formatScalar,
  previewContainer,
  truncate,
} from './preview';

describe('formatScalar', () => {
  it('quotes strings and leaves other scalars bare', () => {
    expect(formatScalar('x')).toBe('"x"');
    expect(formatScalar(1.5)).toBe('1.5');
    expect(formatScalar(true)).toBe('true');
    expect(formatScalar(null)).toBe('null');
    expect(formatScalar('')).toBe('""');
  });

  it('truncates a long string inside its quotes', () => {
    const out = formatScalar('a'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(MAX_PREVIEW);
    expect(out.startsWith('"aaa')).toBe(true);
    expect(out.endsWith('…"')).toBe(true);
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('appends an ellipsis and respects the limit', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 4).length).toBe(4);
  });

  it('never splits a surrogate pair', () => {
    // Four astral characters: cutting mid-pair would produce a lone surrogate.
    const emoji = '\u{1f600}'.repeat(4);
    for (let limit = 1; limit <= emoji.length; limit++) {
      const out = truncate(emoji, limit);
      expect([...out].every((c) => c === '\u{1f600}' || c === '…')).toBe(true);
      // No lone surrogates survive a round trip through the iterator.
      expect(out).toBe([...out].join(''));
    }
  });
});

describe('previewContainer', () => {
  it('summarises empty containers', () => {
    expect(previewContainer({})).toBe('{}');
    expect(previewContainer([])).toBe('[]');
  });

  it('summarises an object as key: value pairs', () => {
    expect(previewContainer({ id: 1, uuid: '' })).toBe('{id: 1, uuid: ""}');
  });

  it('summarises an array of scalars', () => {
    expect(previewContainer([1, 2, 3])).toBe('[1, 2, 3]');
  });

  it('shows nested containers by size rather than expanding them', () => {
    expect(previewContainer({ a: { x: 1, y: 2 }, b: [1, 2, 3] })).toBe('{a: {2}, b: [3]}');
  });

  it('stays within the length budget and marks the cut', () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 60; i++) wide[`key${i}`] = `value${i}`;
    const out = previewContainer(wide);
    expect(out.length).toBeLessThanOrEqual(MAX_PREVIEW + 4);
    expect(out).toContain('…');
    expect(out.startsWith('{key0: "value0"')).toBe(true);
  });

  it('stays within the budget for a long array', () => {
    const out = previewContainer(Array.from({ length: 5000 }, (_, i) => i));
    expect(out.length).toBeLessThanOrEqual(MAX_PREVIEW + 4);
    expect(out.endsWith('…]')).toBe(true);
  });

  it('never contains a newline, which would break the fixed row height', () => {
    expect(previewContainer({ a: 'line\nbreak' })).not.toContain('\n');
  });
});

describe('badgeFor', () => {
  it('names the type shown on a row', () => {
    expect(badgeFor({})).toBe('object');
    expect(badgeFor([])).toBe('array');
    expect(badgeFor('s')).toBe('string');
    expect(badgeFor(1)).toBe('number');
    expect(badgeFor(true)).toBe('boolean');
    expect(badgeFor(null)).toBe('null');
  });
});

describe('escapeControlChars', () => {
  it('renders newlines, tabs and carriage returns visibly', () => {
    expect(escapeControlChars('a\nb')).toBe('a\\nb');
    expect(escapeControlChars('a\tb')).toBe('a\\tb');
    expect(escapeControlChars('a\r\nb')).toBe('a\\r\\nb');
  });

  it('renders other control characters as \\uXXXX', () => {
    expect(escapeControlChars(String.fromCharCode(0x01))).toBe('\\u0001');
    expect(escapeControlChars(String.fromCharCode(0x2028))).toBe('\\u2028');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeControlChars('plain text é\u{1f600}')).toBe('plain text é\u{1f600}');
  });

  it('is not confused by repeated calls (no lastIndex leak)', () => {
    // The regex is module-level and /g, so a stale lastIndex would make the
    // second call miss. Guard against that.
    const text = 'a\nb';
    expect(escapeControlChars(text)).toBe('a\\nb');
    expect(escapeControlChars(text)).toBe('a\\nb');
    expect(escapeControlChars(text)).toBe('a\\nb');
  });

  it('keeps a formatted scalar single-line', () => {
    expect(formatScalar('line\nbreak')).toBe('"line\\nbreak"');
    expect(formatScalar('line\nbreak')).not.toContain('\n');
  });
});
