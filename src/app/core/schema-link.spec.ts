import { ITEM, buildSchema, schemaNodeAt } from './schema';
import { firstDataPath, toSchemaKeys } from './schema-link';

describe('toSchemaKeys', () => {
  it('collapses numeric segments to the ITEM wildcard', () => {
    expect(toSchemaKeys(['t', 0, 'id'])).toEqual(['t', ITEM, 'id']);
    expect(toSchemaKeys(['a', 5, 9, 'b'])).toEqual(['a', ITEM, ITEM, 'b']);
  });

  it('leaves numeric-looking string keys alone', () => {
    // An object key "0" is not an array index and must not become ITEM.
    expect(toSchemaKeys(['0'])).toEqual(['0']);
  });
});

describe('firstDataPath', () => {
  it('lands on index 0 when the field is present everywhere', () => {
    const root = { t: [{ id: 1 }, { id: 2 }] };
    const r = firstDataPath(root, ['t', ITEM, 'id']);
    expect(r.complete).toBe(true);
    expect(r.keys).toEqual(['t', 0, 'id']);
    expect(r.chain).toEqual([root, root.t, root.t[0]]);
  });

  it('scans forward to an element that actually has an optional field', () => {
    // `rare` exists only in the third record -- index 0 would be wrong.
    const root = { t: [{ id: 1 }, { id: 2 }, { id: 3, rare: 'here' }] };
    const r = firstDataPath(root, ['t', ITEM, 'rare']);
    expect(r.complete).toBe(true);
    expect(r.keys).toEqual(['t', 2, 'rare']);
  });

  it('resolves a nested wildcard path', () => {
    const root = { a: [{ b: [{ c: 1 }] }] };
    const r = firstDataPath(root, ['a', ITEM, 'b', ITEM, 'c']);
    expect(r.complete).toBe(true);
    expect(r.keys).toEqual(['a', 0, 'b', 0, 'c']);
  });

  it('skips array elements whose nested path is a dead end', () => {
    const root = { a: [{ b: [] }, { b: [{ c: 1 }] }] };
    const r = firstDataPath(root, ['a', ITEM, 'b', ITEM, 'c']);
    expect(r.keys).toEqual(['a', 1, 'b', 0, 'c']);
  });

  it('resolves a path to a container, not just a leaf', () => {
    const root = { t: [{ id: 1 }] };
    const r = firstDataPath(root, ['t', ITEM]);
    expect(r.complete).toBe(true);
    expect(r.keys).toEqual(['t', 0]);
  });

  it('resolves the empty path to the root', () => {
    const root = { a: 1 };
    expect(firstDataPath(root, [])).toEqual({ keys: [], chain: [], complete: true });
  });

  it('reports the deepest partial path it reached rather than failing outright', () => {
    const root = { t: [{ id: 1 }] };
    const r = firstDataPath(root, ['t', ITEM, 'missing']);
    expect(r.complete).toBe(false);
    expect(r.keys).toEqual(['t']); // got into `t`, then no element matched
  });

  it('fails cleanly on an empty array', () => {
    const r = firstDataPath({ t: [] }, ['t', ITEM, 'id']);
    expect(r.complete).toBe(false);
  });

  it('does not treat ITEM as an object key or vice versa', () => {
    expect(firstDataPath({ t: { '0': 'x' } }, ['t', ITEM]).complete).toBe(false);
    expect(firstDataPath({ t: [1] }, ['t', 'nope']).complete).toBe(false);
  });

  it('does not walk into inherited properties', () => {
    expect(firstDataPath({ a: 1 }, ['toString']).complete).toBe(false);
  });

  it('round-trips with the schema for every shape in a document', () => {
    const root = {
      t_one: [{ id: 1, uuid: '' }, { id: 2, uuid: '', extra: true }],
      t_two: [{ nested: [{ deep: null }] }],
    };
    const schema = buildSchema(root);
    const paths = [
      ['t_one', ITEM, 'id'],
      ['t_one', ITEM, 'extra'],
      ['t_two', ITEM, 'nested', ITEM, 'deep'],
    ];
    for (const schemaKeys of paths) {
      // The schema knows the shape...
      expect(schemaNodeAt(schema, schemaKeys), schemaKeys.join('/')).toBeDefined();
      // ...and the link finds a concrete instance of it.
      const r = firstDataPath(root, schemaKeys);
      expect(r.complete, schemaKeys.join('/')).toBe(true);
      expect(toSchemaKeys(r.keys)).toEqual(schemaKeys);
    }
  });
});
