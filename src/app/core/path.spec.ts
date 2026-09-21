import { DEFAULT_LIMITS, allContainers, flatten } from './flatten';
import { EMPTY_STATE } from './tree-state';
import {
  ancestorRows,
  keyPath,
  keysId,
  parsePointer,
  resolvePointer,
  toJsAccessor,
  toJsonPointer,
  toSchemaDisplayPath,
} from './path';

const flattenAll = (doc: unknown) =>
  flatten(doc, { ...EMPTY_STATE, expanded: allContainers(doc) }, DEFAULT_LIMITS).rows;

describe('keyPath / ancestorRows', () => {
  it('reconstructs a path by walking the parent chain', () => {
    const rows = flattenAll({ a: { b: [{ c: 1 }] } });
    const target = rows.findIndex((r) => r.key === 'c');
    expect(keyPath(rows, target)).toEqual(['a', 'b', 0, 'c']);
    expect(ancestorRows(rows, target).map((i) => rows[i].key)).toEqual(['a', 'b', 0]);
  });

  it('gives a single-element path and no ancestors at the top level', () => {
    const rows = flattenAll({ a: 1 });
    expect(keyPath(rows, 0)).toEqual(['a']);
    expect(ancestorRows(rows, 0)).toEqual([]);
  });
});

describe('toJsonPointer', () => {
  it('renders the root as the empty string', () => {
    expect(toJsonPointer([])).toBe('');
  });

  it('escapes ~ and / per RFC 6901', () => {
    expect(toJsonPointer(['a/b'])).toBe('/a~1b');
    expect(toJsonPointer(['a~b'])).toBe('/a~0b');
    expect(toJsonPointer(['t', 0, 'x'])).toBe('/t/0/x');
    expect(toJsonPointer([''])).toBe('/');
  });
});

describe('toJsAccessor', () => {
  it('uses dot notation only for safe identifiers', () => {
    expect(toJsAccessor(['table', 0, 'id'])).toBe('root.table[0].id');
    expect(toJsAccessor(['$x', '_y'])).toBe('root.$x._y');
  });

  it('brackets and quotes anything else', () => {
    expect(toJsAccessor(['a.b'])).toBe('root["a.b"]');
    expect(toJsAccessor(['a b'])).toBe('root["a b"]');
    expect(toJsAccessor([''])).toBe('root[""]');
    expect(toJsAccessor(['a"b'])).toBe('root["a\\"b"]');
    expect(toJsAccessor(['0start'])).toBe('root["0start"]');
  });

  it('accepts a custom root name', () => {
    expect(toJsAccessor(['a'], 'doc')).toBe('doc.a');
  });
});

describe('parsePointer', () => {
  it('round-trips hostile keys through toJsonPointer', () => {
    const hostile = ['a.b', 'a[0]', 'a/b', 'a~b', 'a"b', '', 'line\nbreak', '__proto__', '~01'];
    for (const key of hostile) {
      expect(parsePointer(toJsonPointer([key]))).toEqual([key]);
    }
    // ...and as a whole multi-segment path.
    expect(parsePointer(toJsonPointer(hostile))).toEqual(hostile);
  });

  it('undoes ~1 before ~0, so ~01 is not mistaken for a slash', () => {
    expect(parsePointer('/~01')).toEqual(['~1']);
    expect(parsePointer('/~10')).toEqual(['/0']);
  });

  it('treats the empty pointer as the root', () => {
    expect(parsePointer('')).toEqual([]);
  });

  it('rejects a string that is not a pointer', () => {
    expect(() => parsePointer('a/b')).toThrow();
  });
});

describe('resolvePointer', () => {
  const doc = JSON.parse('{"t":[{"id":7,"odd/key":"v"}],"n":null}');

  it('returns the value, the typed key path and the ancestor containers', () => {
    const r = resolvePointer(doc, '/t/0/odd~1key')!;
    expect(r.value).toBe('v');
    expect(r.keys).toEqual(['t', 0, 'odd/key']);
    expect(r.chain).toEqual([doc, doc.t, doc.t[0]]);
  });

  it('types array segments as numbers and object segments as strings', () => {
    expect(resolvePointer(doc, '/t/0')!.keys).toEqual(['t', 0]);
    expect(typeof resolvePointer(doc, '/t/0')!.keys[1]).toBe('number');
  });

  it('resolves the root to the document itself', () => {
    const r = resolvePointer(doc, '')!;
    expect(r.value).toBe(doc);
    expect(r.chain).toEqual([]);
    expect(r.keys).toEqual([]);
  });

  it('resolves a null leaf, which is a value and not a miss', () => {
    expect(resolvePointer(doc, '/n')).toEqual({ chain: [doc], keys: ['n'], value: null });
  });

  it('returns undefined for paths that do not exist', () => {
    expect(resolvePointer(doc, '/missing')).toBeUndefined();
    expect(resolvePointer(doc, '/t/1')).toBeUndefined();
    expect(resolvePointer(doc, '/t/notanindex')).toBeUndefined();
    expect(resolvePointer(doc, '/t/-1')).toBeUndefined();
    expect(resolvePointer(doc, '/t/01')).toBeUndefined(); // not canonical
    expect(resolvePointer(doc, '/n/deeper')).toBeUndefined();
  });

  it('does not walk into inherited properties', () => {
    expect(resolvePointer({ a: 1 }, '/toString')).toBeUndefined();
    expect(resolvePointer({ a: 1 }, '/constructor')).toBeUndefined();
  });

  it('resolves __proto__ when JSON.parse made it a real own property', () => {
    const withProto = JSON.parse('{"__proto__":5}');
    expect(resolvePointer(withProto, '/__proto__')!.value).toBe(5);
  });
});

describe('every flattened row has a resolvable pointer', () => {
  it('holds for a document full of hostile keys', () => {
    const doc = JSON.parse(
      '{"a.b":{"a/b":[{"a~b":1},{"":2}]},"line\\nbreak":[null,true],"__proto__":{"x":1}}',
    );
    const rows = flattenAll(doc);
    expect(rows.length).toBeGreaterThan(5);
    for (let i = 0; i < rows.length; i++) {
      const keys = keyPath(rows, i);
      const pointer = toJsonPointer(keys);
      const resolved = resolvePointer(doc, pointer);
      expect(resolved, `pointer ${pointer}`).toBeDefined();
      expect(resolved!.keys).toEqual(keys);
      expect(resolved!.value).toEqual(rows[i].value);
    }
  });
});

describe('keysId', () => {
  it('is equal for equal paths and different for different ones', () => {
    expect(keysId(['a', 0, 'b'])).toBe(keysId(['a', 0, 'b']));
    expect(keysId(['a', 'b'])).not.toBe(keysId(['a', 'c']));
  });

  it('treats an array index and its string form as the same position', () => {
    // A data row types an index as a number; a schema path types it as a string.
    expect(keysId(['t', 0])).toBe(keysId(['t', '0']));
  });

  it('cannot be confused by keys containing separator-like characters', () => {
    // The bug a join(separator) would have: these are genuinely different paths.
    expect(keysId(['a.b'])).not.toBe(keysId(['a', 'b']));
    expect(keysId(['a/b'])).not.toBe(keysId(['a', 'b']));
    expect(keysId(['a"b'])).not.toBe(keysId(['a', 'b']));
    expect(keysId(['a', 'b"c'])).not.toBe(keysId(['a"b', 'c']));
    expect(keysId([''])).not.toBe(keysId([]));
  });

  it('distinguishes paths of different lengths that share a prefix', () => {
    expect(keysId(['a'])).not.toBe(keysId(['a', 'b']));
  });
});

describe('toSchemaDisplayPath', () => {
  it('renders the array wildcard as a position, not a key', () => {
    expect(toSchemaDisplayPath(['table', '[]', 'field'])).toBe('root.table[].field');
  });

  it('quotes keys that are not safe identifiers', () => {
    expect(toSchemaDisplayPath(['odd key', '[]'])).toBe('root["odd key"][]');
  });

  it('accepts a custom wildcard and root name', () => {
    expect(toSchemaDisplayPath(['a', '*'], 'doc', '*')).toBe('doc.a[]');
  });
});
