import {
  ITEM,
  allSchemaNodes,
  buildSchema,
  describeType,
  escapePointerSegment,
  flattenSchema,
  schemaHasChildren,
  schemaNodeAt,
} from './schema';
import { EMPTY_STATE, TreeState } from './tree-state';

function open(refs: Iterable<object>): TreeState {
  return { ...EMPTY_STATE, expanded: new Set(refs) };
}

describe('buildSchema', () => {
  it('describes a flat object', () => {
    const s = buildSchema({ a: 1, b: 'x' });
    expect(s.kinds).toEqual(new Set(['object']));
    expect(s.count).toBe(1);
    expect([...s.fields.keys()]).toEqual(['a', 'b']);
    expect(describeType(s.fields.get('a')!)).toBe('number');
    expect(describeType(s.fields.get('b')!)).toBe('string');
  });

  it('unifies all elements of an array into a single items schema', () => {
    const s = buildSchema([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(s.kinds).toEqual(new Set(['array']));
    expect(s.minLength).toBe(3);
    expect(s.maxLength).toBe(3);
    const items = s.items!;
    expect(items.count).toBe(3);
    expect(items.fields.get('a')!.count).toBe(3);
  });

  it('distinguishes an absent key from a key present with null', () => {
    // `a` appears in all 3 records; `b` only in 2; `a` is null once.
    const s = buildSchema([{ a: null, b: 1 }, { a: 2, b: 2 }, { a: 3 }]);
    const items = s.items!;
    expect(items.count).toBe(3);

    const a = items.fields.get('a')!;
    expect(a.count).toBe(3); // always present
    expect(a.nulls).toBe(1); // ...but null once
    expect(describeType(a)).toBe('number | null');

    const b = items.fields.get('b')!;
    expect(b.count).toBe(2); // absent from the third record
    expect(b.nulls).toBe(0);
  });

  it('counts empty strings separately from nulls', () => {
    const s = buildSchema([{ v: '' }, { v: '' }, { v: null }, { v: 'x' }]);
    const v = s.items!.fields.get('v')!;
    expect(v.count).toBe(4);
    expect(v.empties).toBe(2);
    expect(v.nulls).toBe(1);
    expect(describeType(v)).toBe('string | null');
  });

  it('merges mixed types into a union, with null read last', () => {
    const s = buildSchema([{ v: 1 }, { v: 'a' }, { v: null }, { v: true }]);
    expect(describeType(s.items!.fields.get('v')!)).toBe('boolean | number | string | null');
  });

  it('records array length ranges', () => {
    const s = buildSchema({ lists: [[1], [1, 2, 3], []] });
    const lists = s.fields.get('lists')!;
    expect(lists.minLength).toBe(3);
    const items = lists.items!;
    expect(items.minLength).toBe(0);
    expect(items.maxLength).toBe(3);
  });

  it('handles a position that is sometimes a container and sometimes a scalar', () => {
    const s = buildSchema([{ v: { a: 1 } }, { v: 'plain' }]);
    const v = s.items!.fields.get('v')!;
    expect(v.kinds).toEqual(new Set(['object', 'scalar']));
    expect(describeType(v)).toBe('object | string');
  });

  it('handles arrays of arrays', () => {
    const s = buildSchema([[[1, 2]], [[3]]]);
    expect(s.items!.items!.items!.types).toEqual(new Set(['number']));
  });

  it('leaves an empty array without an items node', () => {
    const s = buildSchema({ empty: [] });
    const empty = s.fields.get('empty')!;
    expect(empty.items).toBeUndefined();
    expect(empty.maxLength).toBe(0);
    expect(schemaHasChildren(empty)).toBe(false);
  });

  it('counts total elements so array items get a sane presence ratio', () => {
    const s = buildSchema({ t: [{ a: 1 }, { a: 2 }, { a: 3 }] });
    const t = s.fields.get('t')!;
    expect(t.count).toBe(1); // one array seen...
    expect(t.totalElements).toBe(3); // ...holding three elements
    const rows = flattenSchema(s, open([t]));
    const item = rows.find((r) => r.key === ITEM)!;
    // Presence is against the element count, not the number of arrays.
    expect(item.meta).toMatchObject({ count: 3, parentCount: 3 });
  });

  it('escapePointerSegment escapes ~ before /', () => {
    expect(escapePointerSegment('~/')).toBe('~0~1');
    expect(escapePointerSegment(3)).toBe('3');
    expect(escapePointerSegment('plain')).toBe('plain');
  });

  it('does not recurse, so deep documents are safe', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 20000; i++) deep = { next: deep };
    expect(() => buildSchema(deep)).not.toThrow();
  });

  it('reflects the real export shape', () => {
    // A miniature of the reference export: a root object of tables.
    const doc = {
      t_one: [{ id: 1, uuid: '' }, { id: 2, uuid: '' }],
      t_two: [{ id: 1, modele_id: null }],
    };
    const s = buildSchema(doc);
    expect([...s.fields.keys()]).toEqual(['t_one', 't_two']);
    const one = s.fields.get('t_one')!;
    expect(one.maxLength).toBe(2);
    expect(one.items!.fields.get('uuid')!.empties).toBe(2);
    expect(describeType(s.fields.get('t_two')!.items!.fields.get('modele_id')!)).toBe('null');
  });
});

describe('flattenSchema', () => {
  const doc = { t: [{ id: 1, name: 'a' }] };

  it('emits top-level fields when nothing is expanded', () => {
    const s = buildSchema(doc);
    const rows = flattenSchema(s, EMPTY_STATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 't', kind: 'array', depth: 0, parent: -1 });
  });

  it('uses a synthetic `[]` child for array element schemas', () => {
    const s = buildSchema(doc);
    const t = s.fields.get('t')!;
    const rows = flattenSchema(s, open([t]));
    expect(rows.map((r) => r.key)).toEqual(['t', '[]']);
    expect(rows[1].parent).toBe(0);
    expect(rows[1].depth).toBe(1);
  });

  it('carries the stats the structure view renders', () => {
    const s = buildSchema({ t: [{ a: 1 }, { a: null }, { b: 2 }] });
    const t = s.fields.get('t')!;
    const items = t.items!;
    const rows = flattenSchema(s, open([t, items]));
    const a = rows.find((r) => r.key === 'a')!;
    expect(a.meta).toMatchObject({ count: 2, parentCount: 3, nulls: 1 });
    const b = rows.find((r) => r.key === 'b')!;
    expect(b.meta).toMatchObject({ count: 1, parentCount: 3 });
  });

  it('keeps parent/depth invariants', () => {
    const s = buildSchema({ a: { b: { c: [{ d: 1 }] } } });
    const rows = flattenSchema(s, open(allSchemaNodes(s)));
    rows.forEach((row, i) => {
      if (row.parent === -1) {
        expect(row.depth).toBe(0);
        return;
      }
      expect(row.parent).toBeLessThan(i);
      expect(row.depth).toBe(rows[row.parent].depth + 1);
    });
    expect(rows.map((r) => r.key)).toEqual(['a', 'b', 'c', '[]', 'd']);
  });

  it('marks leaf positions as non-expandable', () => {
    const s = buildSchema({ n: 1 });
    const rows = flattenSchema(s, EMPTY_STATE);
    expect(rows[0].kind).toBe('leaf');
    expect(rows[0].ref).toBeUndefined();
  });
});

describe('schemaNodeAt', () => {
  it('walks object keys and resolves ITEM onto the array element schema', () => {
    const s = buildSchema({ t: [{ id: 1 }] });
    expect(schemaNodeAt(s, ['t'])).toBe(s.fields.get('t'));
    expect(schemaNodeAt(s, ['t', ITEM])).toBe(s.fields.get('t')!.items);
    expect(schemaNodeAt(s, ['t', ITEM, 'id'])).toBe(s.fields.get('t')!.items!.fields.get('id'));
  });

  it('returns undefined for a path that is not in the shape', () => {
    const s = buildSchema({ t: 1 });
    expect(schemaNodeAt(s, ['nope'])).toBeUndefined();
    expect(schemaNodeAt(s, ['t', 'deeper'])).toBeUndefined();
  });
});
