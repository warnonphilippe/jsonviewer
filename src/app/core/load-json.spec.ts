import {
  MAX_TEXT_LENGTH,
  SOFT_WARN_BYTES,
  describeSize,
  isNdjsonName,
  looksLikeNdjson,
  needsSizeWarning,
  parseDocumentText,
  parseJsonText,
  parseNdjsonText,
  preflight,
} from './load-json';

const BOM = String.fromCharCode(0xfeff);

/** A File stand-in; only `size` and `text()` are used by the module. */
function fakeFile(size: number, text = ''): File {
  return { size, text: async () => text, name: 'x.json' } as unknown as File;
}

describe('parseJsonText', () => {
  it('parses a document', () => {
    const r = parseJsonText('{"a":[1,2]}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ a: [1, 2] });
      expect(r.parseMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('strips a UTF-8 BOM, which JSON.parse itself rejects', () => {
    // The reference export begins with EF BB BF, so this is the likeliest
    // day-one failure if it were not handled.
    expect(() => JSON.parse(`${BOM}{"a":1}`)).toThrow();
    const r = parseJsonText(`${BOM}{"a":1}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('reports an empty or whitespace-only document', () => {
    for (const text of ['', '   ', '\n\t ', BOM]) {
      const r = parseJsonText(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('empty');
    }
  });

  it('reports a syntax error with a located line and column', () => {
    const r = parseJsonText('{\n  "a": 1,\n  "b": tru\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('syntax');
      expect(r.error.location).toBeDefined();
      expect(r.error.location!.line).toBe(3);
      expect(r.error.location!.column).toBe(8);
      expect(r.error.message).toContain('line 3');
      expect(r.error.message).toContain('column 8');
      expect(r.error.location!.frame).toContain('^');
      // The engine's own message is kept for a copy-details action.
      expect(r.error.detail).toBeTruthy();
    }
  });

  it('locates errors the engine message does not position', () => {
    // JSON.parse's message for this form carries no position at all.
    let engineMessage = '';
    try {
      JSON.parse('{"a": tru}');
    } catch (e) {
      engineMessage = (e as Error).message;
    }
    expect(engineMessage).not.toContain('position');

    const r = parseJsonText('{"a": tru}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.location!.column).toBe(7);
  });

  it('accepts a scalar document', () => {
    for (const [text, value] of [['42', 42], ['"s"', 's'], ['null', null], ['true', true]] as const) {
      const r = parseJsonText(text);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBe(value);
    }
  });

  it('does not retain the text it was given', () => {
    // A weak but meaningful guard: the outcome must not carry the source back
    // out, or the caller would pin ~107MB for the reference file.
    const r = parseJsonText('{"a":1}') as Record<string, unknown>;
    expect(Object.values(r).some((v) => typeof v === 'string' && v.includes('"a"'))).toBe(false);
  });
});

describe('parseNdjsonText', () => {
  it('reads one record per line, into an array', () => {
    const r = parseNdjsonText('{"a":1}\n{"a":2}\n{"a":3}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      expect(r.format).toBe('ndjson');
      expect(r.recordCount).toBe(3);
    }
  });

  it('ignores blank lines, a trailing newline and indentation', () => {
    const r = parseNdjsonText('\n{"a":1}\n\n   \n  {"a":2}  \n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('reads a CRLF file, which is how the exports arrive', () => {
    const r = parseNdjsonText('{"a":1}\r\n{"a":2}\r\n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('strips a UTF-8 BOM', () => {
    const r = parseNdjsonText(`${BOM}{"a":1}\n{"a":2}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('accepts scalars and arrays as records', () => {
    const r = parseNdjsonText('1\n"s"\nnull\n[1,2]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 's', null, [1, 2]]);
  });

  it('reports the failing line NUMBERED IN THE FILE, not in the record', () => {
    // The point of rebasing the offset: the user scrolls to line 3 of their
    // file, not to column 6 of a record they cannot see on its own.
    const r = parseNdjsonText('{"a":1}\n{"a":2}\n{"a":}\n{"a":4}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('syntax');
      expect(r.error.location?.line).toBe(3);
      expect(r.error.message).toContain('line 3');
      expect(r.error.location?.frame).toContain('3 | {"a":}');
    }
  });

  it('reports an empty or whitespace-only document', () => {
    for (const text of ['', '   ', '\n\n', '\r\n']) {
      const r = parseNdjsonText(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('empty');
    }
  });

  it('does not retain the text it was given', () => {
    const r = parseNdjsonText('{"a":1}\n{"a":2}') as Record<string, unknown>;
    expect(Object.values(r).some((v) => typeof v === 'string' && v.includes('"a"'))).toBe(false);
  });
});

describe('isNdjsonName', () => {
  it('recognises the three names the format goes by', () => {
    for (const name of ['x.ndjson', 'x.jsonl', 'x.jsonlines', 'X.NDJSON', 'a.b.jsonl']) {
      expect(isNdjsonName(name)).toBe(true);
    }
    for (const name of ['x.json', 'ndjson.txt', 'x.json.gz', 'x']) {
      expect(isNdjsonName(name)).toBe(false);
    }
  });
});

describe('looksLikeNdjson', () => {
  it('recognises two or more records, one per line', () => {
    expect(looksLikeNdjson('{"a":1}\n{"a":2}')).toBe(true);
    expect(looksLikeNdjson('1\n2\n3')).toBe(true);
  });

  it('rejects a pretty-printed document, whose first line is just a brace', () => {
    expect(looksLikeNdjson('{\n  "a": 1,\n  "b": 2\n}')).toBe(false);
  });

  it('rejects a single record, which is plain JSON and would have parsed', () => {
    expect(looksLikeNdjson('{"a":1}')).toBe(false);
    expect(looksLikeNdjson('{"a":1}\n\n')).toBe(false);
  });

  it('rejects text whose first line is not a complete value', () => {
    expect(looksLikeNdjson('{"a":\n1}')).toBe(false);
  });
});

describe('parseDocumentText', () => {
  it('reads a JSON document as JSON', () => {
    const r = parseDocumentText('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.format).toBe('json');
  });

  it('reads NDJSON saved as .json, once JSON.parse has failed', () => {
    const r = parseDocumentText('{"a":1}\n{"a":2}');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.format).toBe('ndjson');
      expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
    }
  });

  it('reads a single JSON document named .ndjson', () => {
    const r = parseDocumentText('{\n  "a": 1\n}', true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.format).toBe('json');
      expect(r.value).toEqual({ a: 1 });
    }
  });

  it('keeps the JSON error for a document that is simply broken', () => {
    // The fallback must not turn "your JSON is invalid at line 1" into a
    // confusing complaint about a format the user never used.
    const r = parseDocumentText('{"a": tru}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('Invalid JSON');
  });

  it('keeps the NDJSON error when the name announced NDJSON', () => {
    const r = parseDocumentText('{"a":1}\n{"a":}', true);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('Invalid NDJSON');
      expect(r.error.location?.line).toBe(2);
    }
  });
});

describe('preflight', () => {
  it('passes an ordinary file', () => {
    expect(preflight(fakeFile(1024))).toBeNull();
  });

  it('rejects an empty file', () => {
    expect(preflight(fakeFile(0))?.kind).toBe('empty');
  });

  it('rejects a file past the engine string limit, before reading it', () => {
    const err = preflight(fakeFile(MAX_TEXT_LENGTH + 1));
    expect(err?.kind).toBe('too-large');
    expect(err?.message).toContain('512 MB');
  });

  it('accepts a file exactly at the limit', () => {
    expect(preflight(fakeFile(MAX_TEXT_LENGTH))).toBeNull();
  });

  it('accepts the reference file size', () => {
    expect(preflight(fakeFile(56_002_277))).toBeNull();
    expect(needsSizeWarning(fakeFile(56_002_277))).toBe(false);
  });
});

describe('needsSizeWarning', () => {
  it('warns only above the soft threshold', () => {
    expect(needsSizeWarning(fakeFile(SOFT_WARN_BYTES))).toBe(false);
    expect(needsSizeWarning(fakeFile(SOFT_WARN_BYTES + 1))).toBe(true);
  });
});

describe('describeSize', () => {
  it('formats byte counts readably', () => {
    expect(describeSize(512)).toBe('512 B');
    expect(describeSize(1024)).toBe('1.0 kB');
    expect(describeSize(56_002_277)).toBe('53.4 MB');
    expect(describeSize(2 * 1024 ** 3)).toBe('2.0 GB');
  });
});
