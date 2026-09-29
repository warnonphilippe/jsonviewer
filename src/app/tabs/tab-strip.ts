import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  viewChild,
} from '@angular/core';
import { AppIcon } from '../ui/icon';
import { DocumentTab, TabsStore } from '../state/tabs.store';
import { describeSize } from '../core/load-json';
import { isTabStep, stepTab } from '../core/tab-order';

/**
 * The open files, one tab each. More are opened from a tab's toolbar, or by
 * dropping them anywhere in the window.
 *
 * A tablist with a single tab stop (roving tabindex): the arrows, Home and End
 * move between files and Delete closes one. The close buttons are therefore
 * `aria-hidden` and out of the tab order -- a tablist may only own tabs, and
 * every close is also on Delete and the middle mouse button. Nothing global is
 * bound: Ctrl+W, Ctrl+Tab and Ctrl+PageUp/PageDown belong to the browser.
 */
@Component({
  selector: 'app-tab-strip',
  imports: [AppIcon],
  templateUrl: './tab-strip.html',
  styleUrl: './tab-strip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppTabStrip {
  protected readonly tabs = inject(TabsStore);

  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');

  constructor() {
    // Keep the active tab in view once the strip overflows and scrolls.
    afterRenderEffect(() => {
      this.tabElement(this.tabs.activeId())?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }

  protected nameOf(tab: DocumentTab): string {
    return tab.doc.fileName() || 'New tab';
  }

  /** "export.json — 12.3 MB · NDJSON · 5,000 records", or what went wrong. */
  protected tooltipOf(tab: DocumentTab): string {
    const name = this.nameOf(tab);
    const error = tab.doc.error();
    if (error) return `${name} — ${error.message}`;
    if (tab.doc.isLoading()) return `${name} — loading…`;
    const meta = tab.doc.meta();
    if (!meta) return name;
    const format =
      meta.format === 'ndjson'
        ? `NDJSON · ${(meta.recordCount ?? 0).toLocaleString()} records`
        : 'JSON';
    return `${name} — ${describeSize(meta.byteSize)} · ${format}`;
  }

  /** The middle button closes, as it does in a browser. */
  protected onAuxClick(event: MouseEvent, id: number): void {
    if (event.button !== 1) return;
    event.preventDefault();
    this.tabs.close(id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const current = this.tabs.activeId();
    if (event.key === 'Delete') {
      this.tabs.close(current);
    } else if (isTabStep(event.key)) {
      const ids = this.tabs.tabs().map((tab) => tab.id);
      const next = stepTab(ids, current, event.key);
      if (next !== null) this.tabs.activate(next);
    } else {
      return;
    }
    event.preventDefault();
    // Focus follows the active tab, which is what keeps the roving tabindex
    // honest. The element already exists: switching tabs mounts nothing.
    this.tabElement(this.tabs.activeId())?.focus();
  }

  private tabElement(id: number): HTMLElement | null {
    return this.list().nativeElement.querySelector<HTMLElement>(`#tab-${id}`);
  }
}
