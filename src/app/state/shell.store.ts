import { Injectable, signal } from '@angular/core';

/**
 * State that belongs to the window rather than to any one document.
 *
 * Every tab has its own `ViewerStore`, so whatever must read the same in all of
 * them -- a preference, or an overlay drawn over every tab -- lives here.
 */
@Injectable({ providedIn: 'root' })
export class ShellStore {
  /** Whether the pinned-ancestor stack is shown. Toggled from the overflow menu. */
  readonly stickyEnabled = signal(true);

  /** The keyboard sheet: opened from a tab's toolbar, drawn by the shell. */
  readonly shortcutsOpen = signal(false);
}
