import { describeOffset, locateJsonError } from './json-locate-error';

/** Built from escapes, so no invisible characters sit in this source file. */
const CONTROL_CHAR = String.fromCharCode(0x01);
const BOM = String.fromCharCode(0xfeff);

/** Documents that must parse. */
const VALID = [
  '{}',
  '[]',
  '{ }',
  '[ ]',
  '42',
  '-0',
  '0',
  '0.5',
  '-1.5e+10',
  '1E-5',
  '"str"',
  '""',
  'true',
  'false',
  'null',
  '{"a":1}',
  '{"a":1,"b":[1,2,{"c":null}]}',
  '[[[[[]]]]]',
  '{"nested":{"deep":{"deeper":[]}}}',
  '  \t\r\n {"a" : 1}  \n ',
  '"\\u00e9\\n\\t\\\\\\"\\/"',
  '{"":""}',
  '{"a/b":1,"a~b":2,"__proto__":3}',
  '[1,2,3]',
  '["\\ud83d\\ude00"]',
  '{"e":1e1,"E":1E1}',
];

/** Documents that must be rejected, with the offset the scanner should report. */
const INVALID: Array<[string, number]> = [
  ['', 0],
  ['   ', 3],
  ['{', 1],
  ['[', 1],
  ['{"a"', 4],
  ['{"a":', 5],
  ['{"a":1', 6],
  ['[1', 2],
  ['{"a":1,}', 7], // trailing comma in object
  ['[1,]', 3], // trailing comma in array
  ['[,1]', 1],
  ['{,}', 1],
  ['{"a" 1}', 5], // missing colon
  ['{a:1}', 1], // unquoted key
  ["{'a':1}", 1], // single-quoted key
  ['{"a":tru}', 5], // the case where V8's own message carries no position
  ['{"a":TRUE}', 5],
  ['{"a":undefined}', 5],
  ['{"a":NaN}', 5],
  ['{"a":01}', 6], // leading zero
  ['{"a":.5}', 5], // no integer part
  ['{"a":1.}', 7], // no fraction digits
  ['{"a":1e}', 7], // no exponent digits
  ['{"a":-}', 6],
  ['{"a":"unterminated}', 19],
  ['{"a":"bad\\escape"}', 10],
  [`{"a":"raw${CONTROL_CHAR}control"}`, 9], // unescaped control character in a string
  ['{"a":"\\uZZZZ"}', 8],
  ['[1 2]', 3], // missing comma
  ['{"a":1 "b":2}', 7],
  ['{"a":1}}', 7], // trailing garbage
  ['[]extra', 2],
  [`${BOM}{"a":1}`, 0], // a BOM is not a value
  ['[1,2', 4],
];

/** Does the engine accept this text? */
function engineAccepts(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

describe('locateJsonError', () => {
  it('returns null for valid documents', () => {
    for (const text of VALID) {
      expect(locateJsonError(text), JSON.stringify(text)).toBeNull();
    }
  });

  it('reports the exact offset for invalid documents', () => {
    for (const [text, offset] of INVALID) {
      const err = locateJsonError(text);
      expect(err, JSON.stringify(text)).not.toBeNull();
      expect(err!.offset, JSON.stringify(text)).toBe(offset);
    }
  });

  it('agrees with JSON.parse on validity -- the invariant that matters', () => {
    for (const text of [...VALID, ...INVALID.map(([t]) => t)]) {
      expect(locateJsonError(text) === null, JSON.stringify(text)).toBe(engineAccepts(text));
    }
  });

  it('agrees with JSON.parse on every truncation of a nested document', () => {
    // A cheap fuzz: every prefix is either valid or not, and the scanner must
    // never disagree with the engine about which.
    const full = '{"a":[1,-2.5e3,{"b":"x\\n","c":[true,false,null]}],"d":{}}';
    for (let len = 0; len <= full.length; len++) {
      const text = full.slice(0, len);
      expect(locateJsonError(text) === null, `prefix of length ${len}: ${text}`).toBe(
        engineAccepts(text),
      );
    }
  });

  it('agrees with JSON.parse when each character is corrupted in turn', () => {
    const full = '{"a":[1,{"b":"x"},true,null],"c":-1.5e2}';
    for (let i = 0; i < full.length; i++) {
      for (const replacement of ['x', ',', '}', ']', '"', '0']) {
        const text = full.slice(0, i) + replacement + full.slice(i + 1);
        expect(locateJsonError(text) === null, `at ${i} -> ${replacement}: ${text}`).toBe(
          engineAccepts(text),
        );
      }
    }
  });

  it('does not recurse, so a deeply nested document is safe', () => {
    const deep = '['.repeat(50_000) + ']'.repeat(50_000);
    expect(() => locateJsonError(deep)).not.toThrow();
    expect(locateJsonError(deep)).toBeNull();
  });

  it('locates an error deep inside a large document', () => {
    const head = '{"rows":[' + '{"v":1},'.repeat(20_000);
    const text = head + '{"v":tru}]}';
    const err = locateJsonError(text)!;
    expect(err.offset).toBe(head.length + 5); // '{"v":' is 5 chars, then 'tru'
    expect(err.expected).toContain('true');
  });
});

describe('describeOffset', () => {
  const text = 'line one\nline two\nline three\nline four';

  it('reports 1-based line and column', () => {
    expect(describeOffset(text, 0)).toMatchObject({ line: 1, column: 1 });
    expect(describeOffset(text, 9)).toMatchObject({ line: 2, column: 1 });
    expect(describeOffset(text, 14)).toMatchObject({ line: 2, column: 6 });
  });

  it('builds a caret frame with preceding context', () => {
    const { frame } = describeOffset(text, 19); // line 3, column 2
    const lines = frame.split('\n');
    expect(lines[0]).toContain('line one');
    expect(lines[2]).toContain('line three');
    // The caret sits under column 2 of the gutter-prefixed offending line.
    expect(lines[3].indexOf('^')).toBe(lines[2].indexOf('line three') + 1);
  });

  it('windows a very long single line instead of dumping it', () => {
    const long = 'a'.repeat(5000) + 'X' + 'b'.repeat(5000);
    const { frame, line, column } = describeOffset(long, 5000);
    expect(line).toBe(1);
    expect(column).toBe(5001);
    expect(frame.length).toBeLessThan(600);
    expect(frame).toContain('…');
  });

  it('clamps an out-of-range offset', () => {
    expect(describeOffset('ab', 999)).toMatchObject({ line: 1, column: 3 });
    expect(describeOffset('ab', -5)).toMatchObject({ line: 1, column: 1 });
  });
});
