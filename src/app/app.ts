import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { AppTabStrip } from './tabs/tab-strip';
import { DocumentPane } from './tabs/document-pane';
import { AppIcon } from './ui/icon';
import { TabsStore } from './state/tabs.store';
import { ShellStore } from './state/shell.store';
import { ToastStore } from './state/toast.store';

/**
 * The shell.
 *
 * It owns what crosses the whole window -- the tabs, drag and drop, and the
 * overlays -- and nothing else. Each tab's document is a `DocumentPane`, made
 * inside that tab's own injector so it and everything below it get that tab's
 * stores; see `TabsStore`.
 *
 * Every pane stays mounted, the inactive ones hidden with `visibility` rather
 * than `display`: they keep their layout, so a tab you come back to still has
 * its scroll position and its measured viewport, and the virtual scroller has
 * nothing to re-measure. At ~40 rendered rows a tab, that costs next to
 * nothing.
 */
@Component({
  selector: 'app-root',
  imports: [NgComponentOutlet, AppTabStrip, AppIcon],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly tabs = inject(TabsStore);
  protected readonly shell = inject(ShellStore);
  protected readonly toasts = inject(ToastStore);

  protected readonly pane = DocumentPane;

  /** Whether files are being dragged over the window. */
  protected readonly dragging = signal(false);

  protected readonly dropLabel = computed(() =>
    this.tabs.isEmpty() ? 'Drop the file to open it' : 'Drop to open in a new tab',
  );

  // --- drag and drop ------------------------------------------------------

  /** A drop anywhere in the window opens its files in new tabs; see `TabsStore.open`. */
  @HostListener('dragover', ['$event'])
  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  @HostListener('dragleave', ['$event'])
  protected onDragLeave(event: DragEvent): void {
    if (event.relatedTarget === null) this.dragging.set(false);
  }

  @HostListener('drop', ['$event'])
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) this.tabs.open(files);
  }

  // --- global shortcuts ---------------------------------------------------

  @HostListener('keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.shell.shortcutsOpen()) {
      event.preventDefault();
      this.shell.shortcutsOpen.set(false);
    }
  }
}
