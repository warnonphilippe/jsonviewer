/**
 * Where to put a menu that was opened at a point.
 *
 * A right-click menu is anchored to a *point*, not to an element, which is why
 * this is a dozen lines of arithmetic rather than a reason to pull in CDK
 * Overlay: its positioning strategies solve the element-anchored problem, and
 * bringing in `OverlayModule`, `ScrollDispatcher`, `ViewportRuler` and `Portal`
 * -- plus a global prebuilt stylesheet -- to place a nine-item menu would cost
 * more than this file by a wide margin.
 */

export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Clamp a menu of `menuW` x `menuH` opened at (`x`, `y`) into a `viewW` x
 * `viewH` viewport, keeping `margin` px of breathing room at the edges.
 *
 * Preference order: open down-and-right from the point; flip to the other side
 * when that would overflow; clamp when flipping is not enough. The result is
 * never negative, so a menu taller than the viewport starts at the top edge and
 * scrolls rather than hanging off the top.
 */
export function placeMenu(
  x: number,
  y: number,
  menuW: number,
  menuH: number,
  viewW: number,
  viewH: number,
  margin = 8,
): MenuPosition {
  return {
    x: place(x, menuW, viewW, margin),
    y: place(y, menuH, viewH, margin),
  };
}

function place(at: number, size: number, view: number, margin: number): number {
  // The largest start that still leaves a margin at the far edge.
  const last = view - margin - size;
  // Larger than the viewport: pin it to the near edge and let it scroll.
  if (last < margin) return margin;
  // Fits going forward from the point: leave it there.
  if (at <= last) return Math.max(margin, at);
  // Flip to the other side. Clamping matters: flipping puts the far edge at
  // `at`, which is past the margin precisely when we got here.
  return Math.max(margin, Math.min(at - size, last));
}
