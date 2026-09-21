/**
 * One-line summaries for collapsed containers and long scalars.
 *
 * Rows are a fixed height with `white-space: nowrap`, so anything produced here
 * must be short: a preview that wrapped would desynchronise the virtual
 * scroller's fixed `itemSize` from reality.
 */

import { ScalarType, isContainer, scalarType } from './flatten';

export const MAX_PREVIEW = 120;

/**
 * Control characters must never reach a row: rows are a fixed height with
 * `white-space: nowrap`, and a raw newline in a value would make the rendered
 * row taller than the `itemSize` the virtual scroller assumes, progressively
 * desynchronising the scrollbar.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

const NAMED_ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\b': '\\b',
  '\f': '\\f',
};

/** Render control characters visibly, the way a JSON string literal would. */
export function escapeControlChars(text: string): string {
  if (!CONTROL_CHARS.test(text)) return text;
  CONTROL_CHARS.lastIndex = 0;
  return text.replace(
    CONTROL_CHARS,
    (c) => NAMED_ESCAPES[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** How a scalar is displayed in its own row. Strings keep their quotes. */
export function formatScalar(value: unknown, maxLength = MAX_PREVIEW): string {
  if (value === null) return 'null';
  // Escape before truncating, so an escape sequence is never cut in half.
  if (typeof value === 'string') {
    return `"${truncate(escapeControlChars(value), maxLength - 2)}"`;
  }
  return truncate(escapeControlChars(String(value)), maxLength);
}

/**
 * Truncate without splitting a surrogate pair, which would render as a
 * replacement character.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let end = Math.max(0, maxLength - 1);
  const code = text.charCodeAt(end - 1);
  // If we would cut between a high and low surrogate, step back one.
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return text.slice(0, end) + '…';
}

/** A compact summary of a collapsed container, e.g. `{id: 1, uuid: "", …}`. */
export function previewContainer(value: object, maxLength = MAX_PREVIEW): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const parts: string[] = [];
    let used = 2;
    for (const item of value) {
      const part = previewInline(item);
      if (used + part.length + 2 > maxLength) {
        parts.push('…');
        break;
      }
      parts.push(part);
      used += part.length + 2;
    }
    return `[${parts.join(', ')}]`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const parts: string[] = [];
  let used = 2;
  for (const key of keys) {
    const part = `${escapeControlChars(key)}: ${previewInline(
      (value as Record<string, unknown>)[key],
    )}`;
    if (used + part.length + 2 > maxLength) {
      parts.push('…');
      break;
    }
    parts.push(part);
    used += part.length + 2;
  }
  return `{${parts.join(', ')}}`;
}

/** A nested value inside a preview: never expanded, just shaped. */
function previewInline(value: unknown): string {
  if (!isContainer(value)) return formatScalar(value, 24);
  return Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
}

/** The type badge shown on a row. */
export function badgeFor(value: unknown): ScalarType | 'object' | 'array' {
  if (!isContainer(value)) return scalarType(value);
  return Array.isArray(value) ? 'array' : 'object';
}
