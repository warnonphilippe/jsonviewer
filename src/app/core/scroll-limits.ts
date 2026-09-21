/**
 * Browsers clamp how tall a single element may be, and a fixed-size virtual
 * scroller's spacer is exactly that: one very tall element. Past the clamp the
 * viewport silently cannot reach its own bottom -- rows exist but are
 * unreachable, and nothing throws.
 *
 * The limit differs per engine (roughly 33.5M px in Chromium and WebKit, 17.9M
 * in Gecko), so it is measured at runtime rather than hard-coded to a number
 * that would rot.
 */

/** Gecko's limit -- the lowest of the mainstream engines. Used when probing fails. */
export const CONSERVATIVE_MAX_HEIGHT_PX = 17_895_697;

/** Never emit more rows than this, however tall the browser would allow. */
export const ABSOLUTE_MAX_ROWS = 400_000;

/** Leave headroom below the measured clamp. */
const SAFETY = 0.9;

let cached: number | null = null;

/**
 * Binary-search the tallest height the layout engine actually honours.
 *
 * Runs on a detached element, so it costs no layout of the real page. The result
 * is cached; it cannot change for the lifetime of the document.
 */
export function probeMaxElementHeight(doc: Document = document): number {
  if (cached !== null) return cached;

  const probe = doc.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.width = '1px';
  doc.body.appendChild(probe);

  try {
    probe.style.height = '1000px';
    if (probe.offsetHeight !== 1000) {
      // No real layout engine here (jsdom, or a hidden document). Do not guess.
      return (cached = CONSERVATIVE_MAX_HEIGHT_PX);
    }

    let low = 1_000_000;
    let high = 1_000_000_000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      probe.style.height = `${mid}px`;
      if (probe.offsetHeight === mid) low = mid;
      else high = mid;
    }
    return (cached = low);
  } finally {
    probe.remove();
  }
}

/** The row cap implied by a row height, given the engine's clamp. */
export function maxRowsFor(rowHeight: number, maxHeightPx?: number): number {
  const limit = maxHeightPx ?? probeMaxElementHeight();
  const byHeight = Math.floor((limit * SAFETY) / rowHeight);
  return Math.max(1000, Math.min(ABSOLUTE_MAX_ROWS, byHeight));
}

/** Testing seam. */
export function resetProbeCache(): void {
  cached = null;
}
