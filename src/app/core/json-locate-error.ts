/**
 * Locates the first syntax error in a JSON document.
 *
 * This exists because V8's own `SyntaxError` message cannot be relied on. Only
 * some error classes carry a position:
 *
 *   JSON.parse('{"a": 1,}')  -> 'Expected double-quoted property name in JSON
 *                                at position 8 (line 1 column 9)'     <- has one
 *   JSON.parse('{"a": tru}') -> `Unexpected token '}', ... is not valid JSON`
 *                                                                     <- has none
 *
 * The second form is the common one and never carries a position, at any input
 * length. So when `JSON.parse` throws we re-scan the text ourselves to find out
 * where. This runs only on the error path, so the happy path never pays for it.
 *
 * The scanner allocates nothing per character: it dispatches on `charCodeAt` and
 * never takes a substring, so it can walk a 56MB document cheaply. It is
 * iterative for the same reason `flatten` is -- a deeply nested document must
 * not blow the call stack.
 */

export interface JsonErrorLocation {
  /** Character offset of the offending character. */
  readonly offset: number;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
  /** What the scanner expected to find there. */
  readonly expected: string;
  /** A few lines of context with a caret under the column. */
  readonly frame: string;
}

const enum C {
  Tab = 9,
  LF = 10,
  CR = 13,
  Space = 32,
  Quote = 34,
  Plus = 43,
  Comma = 44,
  Minus = 45,
  Dot = 46,
  Zero = 48,
  Nine = 57,
  Colon = 58,
  UpperE = 69,
  LowerE = 101,
  BracketOpen = 91,
  Backslash = 92,
  BracketClose = 93,
  BraceOpen = 123,
  BraceClose = 125,
}

/** Structural context we are inside. */
const enum In {
  Array,
  Object,
}

/** What the scanner is looking for next. */
const enum Mode {
  Value,
  AfterValue,
  Key,
}

function isWhitespace(c: number): boolean {
  return c === C.Space || c === C.Tab || c === C.LF || c === C.CR;
}

function isDigit(c: number): boolean {
  return c >= C.Zero && c <= C.Nine;
}

/** Line and column of an offset, plus a caret frame of surrounding lines. */
export function describeOffset(text: string, offset: number, context = 2): {
  line: number;
  column: number;
  frame: string;
} {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === C.LF) {
      line++;
      lineStart = i + 1;
    }
  }
  const column = clamped - lineStart + 1;

  // Gather `context` lines before the offending one, plus the offending line.
  const starts: number[] = [lineStart];
  for (let back = 0; back < context && starts[0] > 0; back++) {
    const prevEnd = starts[0] - 1;
    let prevStart = prevEnd;
    while (prevStart > 0 && text.charCodeAt(prevStart - 1) !== C.LF) prevStart--;
    starts.unshift(prevStart);
  }
  let lineEnd = text.indexOf('\n', lineStart);
  if (lineEnd === -1) lineEnd = text.length;

  const gutter = String(line).length;
  const frameLines: string[] = [];
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k];
    let end = text.indexOf('\n', start);
    if (end === -1 || end > lineEnd) end = lineEnd;
    const lineNo = line - (starts.length - 1 - k);
    // Long lines (a 56MB single-line document is common) are windowed.
    const raw = text.slice(start, end).replace(/\r$/, '').replace(/\t/g, ' ');
    frameLines.push(`${String(lineNo).padStart(gutter)} | ${clip(raw, column)}`);
  }
  frameLines.push(`${' '.repeat(gutter)} | ${' '.repeat(caretColumn(column) - 1)}^`);
  return { line, column, frame: frameLines.join('\n') };
}

const WINDOW = 100;

/** Keep at most WINDOW characters either side of the column. */
function clip(lineText: string, column: number): string {
  if (lineText.length <= WINDOW * 2) return lineText;
  const start = Math.max(0, column - 1 - WINDOW);
  const end = Math.min(lineText.length, column - 1 + WINDOW);
  return (start > 0 ? '…' : '') + lineText.slice(start, end) + (end < lineText.length ? '…' : '');
}

function caretColumn(column: number): number {
  return column <= WINDOW * 2 ? column : WINDOW + 2;
}

/**
 * Scan `text` and return the location of the first syntax error, or null if the
 * document is valid JSON.
 */
export function locateJsonError(text: string): JsonErrorLocation | null {
  const n = text.length;
  let i = 0;
  const stack: In[] = [];
  let mode: Mode = Mode.Value;

  const fail = (offset: number, expected: string): JsonErrorLocation => {
    const at = Math.min(offset, n);
    const { line, column, frame } = describeOffset(text, at);
    return { offset: at, line, column, expected, frame };
  };

  const skipWs = () => {
    while (i < n && isWhitespace(text.charCodeAt(i))) i++;
  };

  /** Consume a string starting at the opening quote. Returns null, or an error. */
  const scanString = (): JsonErrorLocation | null => {
    i++; // opening quote
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === C.Quote) {
        i++;
        return null;
      }
      if (c === C.Backslash) {
        i++;
        if (i >= n) return fail(i, 'an escape sequence, but the document ended');
        const esc = text[i];
        if (esc === 'u') {
          for (let k = 1; k <= 4; k++) {
            const h = text.charCodeAt(i + k);
            const hex =
              isDigit(h) || (h >= 97 && h <= 102) || (h >= 65 && h <= 70);
            if (!hex) return fail(i + k, 'four hexadecimal digits after \\u');
          }
          i += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(esc)) {
          return fail(i, 'a valid escape: one of " \\ / b f n r t u');
        }
        i++;
        continue;
      }
      if (c < 0x20) {
        return fail(i, 'an escaped control character inside a string');
      }
      i++;
    }
    return fail(n, 'a closing double quote');
  };

  /** Consume a number. Returns null, or an error. */
  const scanNumber = (): JsonErrorLocation | null => {
    const start = i;
    if (text.charCodeAt(i) === C.Minus) i++;
    if (i >= n || !isDigit(text.charCodeAt(i))) return fail(i, 'a digit');
    if (text.charCodeAt(i) === C.Zero) {
      i++;
      if (i < n && isDigit(text.charCodeAt(i))) {
        return fail(i, 'no extra digits after a leading zero');
      }
    } else {
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    if (i < n && text.charCodeAt(i) === C.Dot) {
      i++;
      if (i >= n || !isDigit(text.charCodeAt(i))) return fail(i, 'a digit after the decimal point');
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    if (i < n && (text.charCodeAt(i) === C.LowerE || text.charCodeAt(i) === C.UpperE)) {
      i++;
      if (i < n && (text.charCodeAt(i) === C.Plus || text.charCodeAt(i) === C.Minus)) i++;
      if (i >= n || !isDigit(text.charCodeAt(i))) return fail(i, 'a digit in the exponent');
      while (i < n && isDigit(text.charCodeAt(i))) i++;
    }
    return i > start ? null : fail(start, 'a number');
  };

  /** Consume a bare literal like `true`. */
  const scanLiteral = (word: string): JsonErrorLocation | null => {
    if (text.startsWith(word, i)) {
      i += word.length;
      return null;
    }
    return fail(i, `the literal "${word}"`);
  };

  skipWs();
  // Report the end of input, so a whitespace-only document points past the
  // whitespace rather than at offset 0.
  if (i >= n) return fail(i, 'a JSON value, but the document is empty');

  for (;;) {
    if (mode === Mode.Value) {
      skipWs();
      if (i >= n) return fail(n, 'a value, but the document ended');
      const c = text.charCodeAt(i);
      let err: JsonErrorLocation | null = null;

      if (c === C.BraceOpen) {
        i++;
        skipWs();
        if (i < n && text.charCodeAt(i) === C.BraceClose) {
          i++;
          mode = Mode.AfterValue;
        } else {
          stack.push(In.Object);
          mode = Mode.Key;
        }
        continue;
      }
      if (c === C.BracketOpen) {
        i++;
        skipWs();
        if (i < n && text.charCodeAt(i) === C.BracketClose) {
          i++;
          mode = Mode.AfterValue;
        } else {
          stack.push(In.Array);
          mode = Mode.Value;
        }
        continue;
      }
      if (c === C.Quote) err = scanString();
      else if (c === C.Minus || isDigit(c)) err = scanNumber();
      else if (c === 116) err = scanLiteral('true');
      else if (c === 102) err = scanLiteral('false');
      else if (c === 110) err = scanLiteral('null');
      else return fail(i, 'a value: an object, array, string, number, true, false or null');

      if (err) return err;
      mode = Mode.AfterValue;
      continue;
    }

    if (mode === Mode.Key) {
      skipWs();
      if (i >= n) return fail(n, 'a property name, but the document ended');
      if (text.charCodeAt(i) !== C.Quote) return fail(i, 'a double-quoted property name');
      const err = scanString();
      if (err) return err;
      skipWs();
      if (i >= n) return fail(n, "':', but the document ended");
      if (text.charCodeAt(i) !== C.Colon) return fail(i, "':' after the property name");
      i++;
      mode = Mode.Value;
      continue;
    }

    // Mode.AfterValue
    if (stack.length === 0) {
      skipWs();
      if (i < n) return fail(i, 'the end of the document');
      return null;
    }
    skipWs();
    const container = stack[stack.length - 1];
    if (i >= n) {
      return fail(n, container === In.Array ? "',' or ']'" : "',' or '}'");
    }
    const c = text.charCodeAt(i);
    if (c === C.Comma) {
      i++;
      mode = container === In.Array ? Mode.Value : Mode.Key;
      continue;
    }
    if (container === In.Array) {
      if (c === C.BracketClose) {
        i++;
        stack.pop();
        continue;
      }
      return fail(i, "',' or ']'");
    }
    if (c === C.BraceClose) {
      i++;
      stack.pop();
      continue;
    }
    return fail(i, "',' or '}'");
  }
}
