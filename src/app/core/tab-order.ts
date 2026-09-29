/**
 * Which tab to land on when the tab strip changes under you.
 *
 * Two small decisions, kept here as arithmetic for the same reason as the menu
 * placement and the scroll plan: they are interface behaviour, and this way
 * they are tested without a DOM.
 */

/** The keys the tab strip moves with, per the ARIA tabs pattern. */
export type TabStep = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export function isTabStep(key: string): key is TabStep {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End';
}

/**
 * The tab to show once `closedId` is gone, or null when nothing is left.
 *
 * Closing a background tab leaves the active one alone. Closing the active one
 * lands on its right-hand neighbour -- the tab that slides into the place you
 * were looking at, as in a browser -- or on its left one when it was last.
 */
export function activeAfterClose(
  ids: readonly number[],
  activeId: number,
  closedId: number,
): number | null {
  const remaining = ids.filter((id) => id !== closedId);
  if (remaining.length === 0) return null;
  if (activeId !== closedId && remaining.includes(activeId)) return activeId;
  const at = Math.max(0, ids.indexOf(closedId));
  return remaining[Math.min(at, remaining.length - 1)];
}

/** The tab a key moves to. The arrows wrap around; Home and End do not need to. */
export function stepTab(ids: readonly number[], activeId: number, key: TabStep): number | null {
  if (ids.length === 0) return null;
  const at = Math.max(0, ids.indexOf(activeId));
  switch (key) {
    case 'ArrowLeft':
      return ids[(at - 1 + ids.length) % ids.length];
    case 'ArrowRight':
      return ids[(at + 1) % ids.length];
    case 'Home':
      return ids[0];
    case 'End':
      return ids[ids.length - 1];
  }
}
