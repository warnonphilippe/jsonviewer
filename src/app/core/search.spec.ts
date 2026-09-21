import { DEFAULT_SEARCH, SearchOptions, searchJson } from './search';

const opts = (over: Partial<SearchOptions> = {}): SearchOptions => ({ ...DEFAULT_SEARCH, ...over });

/** Hits rendered as readable paths, for terse assertions. */
const paths = (root: unknown, o: Partial<SearchOptions>) =>
  searchJson(root, opts(o)).hits.map((h) => `${h.keys.join('.')}:${h.where}`);

describe('searchJson', () => {
  const doc = {
    alpha: 'find me',
    beta: { gamma: 'nothing', findable: 1 },
    list: ['find', 'other', { deep: 'findit' }],
  };

  it('returns nothing for an empty query', () => {
    expect(searchJson(doc, opts({ query: '' })).total).toBe(0);
  });

  it('returns nothing when neither keys nor values are searched', () => {
    expect(searchJson(doc, opts({ query: 'find', inKeys: false, inValues: false })).total).toBe(0);
  });

  it('matches values', () => {
    expect(paths(doc, { query: 'find me', inKeys: false })).toEqual(['alpha:value']);
  });

  it('matches keys', () => {
    expect(paths(doc, { query: 'findable', inValues: false })).toEqual(['beta.findable:key']);
  });

  it('matches keys and values together, in document order', () => {
    expect(paths(doc, { query: 'find' })).toEqual([
      'alpha:value',
      'beta.findable:key',
      'list.0:value',
      'list.2.deep:value',
    ]);
  });

  it('is case-insensitive by default and case-sensitive on request', () => {
    expect(searchJson(doc, opts({ query: 'FIND' })).total).toBe(4);
    expect(searchJson(doc, opts({ query: 'FIND', caseSensitive: true })).total).toBe(0);
    expect(searchJson(doc, opts({ query: 'find', caseSensitive: true })).total).toBe(4);
  });

  it('does not treat array indices as keys', () => {
    // '0' is a position, not a name, so a key search must not match it.
    expect(searchJson({ list: ['a', 'b'] }, opts({ query: '0', inValues: false })).total).toBe(0);
    expect(searchJson({ '0': 'a' }, opts({ query: '0', inValues: false })).total).toBe(1);
  });

  it('matches numbers, booleans and null by their text', () => {
    const d = { n: 1234, t: true, f: false, z: null };
    expect(paths(d, { query: '23', inKeys: false })).toEqual(['n:value']);
    expect(paths(d, { query: 'true', inKeys: false })).toEqual(['t:value']);
    expect(paths(d, { query: 'null', inKeys: false })).toEqual(['z:value']);
    // 'false' must not also match the boolean true.
    expect(paths(d, { query: 'false', inKeys: false })).toEqual(['f:value']);
  });

  it('gives the ancestor chain so a hit can be revealed', () => {
    const { hits } = searchJson(doc, opts({ query: 'findit' }));
    expect(hits).toHaveLength(1);
    expect(hits[0].chain).toEqual([doc, doc.list, doc.list[2]]);
    expect(hits[0].keys).toEqual(['list', 2, 'deep']);
  });

  it('typed keys distinguish array indices from object keys', () => {
    const { hits } = searchJson(doc, opts({ query: 'find', inKeys: false }));
    const listHit = hits.find((h) => h.keys[0] === 'list')!;
    expect(typeof listHit.keys[1]).toBe('number');
  });

  it('handles a scalar document', () => {
    expect(searchJson('findable', opts({ query: 'find' })).total).toBe(1);
    expect(searchJson(42, opts({ query: '4' })).hits[0]).toEqual({
      chain: [],
      keys: [],
      where: 'value',
    });
    expect(searchJson(null, opts({ query: 'null' })).total).toBe(1);
  });

  it('finds matches in an empty-string key', () => {
    const d = JSON.parse('{"":"hit"}');
    expect(paths(d, { query: 'hit', inKeys: false })).toEqual([':value']);
  });

  describe('capping', () => {
    // 100 records that each match twice: once on the key, once on the value.
    const many = { rows: Array.from({ length: 100 }, () => ({ match: 'match' })) };

    it('caps the hit list but keeps the total exact', () => {
      const r = searchJson(many, opts({ query: 'match' }), 10);
      expect(r.hits).toHaveLength(10);
      expect(r.total).toBe(200);
      expect(r.capped).toBe(true);
    });

    it('does not report capping when everything fits', () => {
      const r = searchJson(many, opts({ query: 'match' }), 1000);
      expect(r.hits).toHaveLength(200);
      expect(r.total).toBe(200);
      expect(r.capped).toBe(false);
    });

    it('keeps the first hits, in document order', () => {
      const r = searchJson(many, opts({ query: 'match' }), 3);
      // rows.0 twice: once for the key `match`, once for its value.
      expect(r.hits.map((h) => h.keys.join('.'))).toEqual([
        'rows.0.match',
        'rows.0.match',
        'rows.1.match',
      ]);
    });
  });

  it('does not recurse, so a deeply nested document is safe', () => {
    let deep: unknown = 'needle';
    for (let i = 0; i < 20_000; i++) deep = { next: deep };
    const r = searchJson(deep, opts({ query: 'needle', inKeys: false }));
    expect(r.total).toBe(1);
    expect(r.hits[0].keys).toHaveLength(20_000);
  });

  it('does not leak key-stack state between sibling branches', () => {
    // A regression guard: the mutable key stack is reused across branches, so a
    // stale deeper key must never end up in a shallower hit's path.
    const d = { a: { b: { c: { d: 'x' } } }, hit: 'x' };
    const r = searchJson(d, opts({ query: 'x', inKeys: false }));
    expect(r.hits.map((h) => h.keys.join('.'))).toEqual(['a.b.c.d', 'hit']);
  });

  it('reports elapsed time', () => {
    expect(searchJson(doc, opts({ query: 'find' })).elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
