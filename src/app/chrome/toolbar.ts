import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AppIcon } from '../ui/icon';
import { ContextMenu, MenuItem } from '../ui/context-menu';
import { JsonDocumentStore } from '../state/json-document.store';
import { ViewKind, ViewerStore } from '../state/viewer.store';
import { ThemeStore } from '../state/theme.store';
import { describeSize } from '../core/load-json';

/** The file types the picker offers. Content, not extension, decides the rest. */
const ACCEPT = '.json,.ndjson,.jsonl,.jsonlines,application/json,text/json,application/x-ndjson';

/**
 * The application bar: what is open, which view, and what you are searching for.
 *
 * Search is a permanent field rather than a drawer. On a two-million-line
 * export it is the primary tool, and a drawer that has to be summoned before
 * you can see whether anything matched is the wrong shape for that. Ctrl/Cmd+F
 * focuses it instead of opening it.
 *
 * Actions that act on the *focused row* are deliberately not here -- they live
 * on the row, in its context menu and in the breadcrumb bar, so this bar has no
 * buttons that spend most of their life disabled.
 */
@Component({
  selector: 'app-toolbar',
  imports: [AppIcon, ContextMenu],
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppToolbar {
  protected readonly doc = inject(JsonDocumentStore);
  protected readonly store = inject(ViewerStore);
  protected readonly themes = inject(ThemeStore);

  readonly openFile = output<File>();
  readonly closeFile = output<void>();
  readonly showShortcuts = output<void>();

  protected readonly accept = ACCEPT;

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('search');

  /** Which popover is open, and where. Null when none is. */
  protected readonly popover = signal<{
    kind: 'options' | 'overflow';
    x: number;
    y: number;
  } | null>(null);

  protected readonly fileSize = computed(() => {
    const meta = this.doc.meta();
    return meta ? describeSize(meta.byteSize) : '';
  });

  protected readonly formatLabel = computed(() => {
    const meta = this.doc.meta();
    if (!meta) return '';
    return meta.format === 'ndjson'
      ? `NDJSON · ${(meta.recordCount ?? 0).toLocaleString()} records`
      : 'JSON';
  });

  /** "3 of 1,284 · 67 ms", or the empty string when nothing is being searched. */
  protected readonly searchSummary = computed(() => {
    const result = this.store.searchResult();
    if (this.store.searchOptions().query === '') return '';
    if (result.total === 0) return 'no matches';
    const position = this.store.currentHit() + 1;
    return result.capped
      ? `${position} / ${result.hits.length.toLocaleString()} of ${result.total.toLocaleString()}`
      : `${position} / ${result.total.toLocaleString()}`;
  });

  protected readonly hasHits = computed(() => this.store.searchResult().total > 0);

  protected readonly themeIcon = computed(() => {
    const theme = this.themes.theme();
    return theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor';
  });

  protected readonly optionItems = computed<MenuItem[]>(() => {
    const options = this.store.searchOptions();
    return [
      { id: 'inKeys', label: 'Search keys', checked: options.inKeys },
      { id: 'inValues', label: 'Search values', checked: options.inValues },
      { id: 'caseSensitive', label: 'Match case', checked: options.caseSensitive },
    ];
  });

  protected readonly overflowItems = computed<MenuItem[]>(() => {
    const theme = this.themes.theme();
    return [
      { id: 'theme-system', label: 'Theme: system', checked: theme === 'system' },
      { id: 'theme-light', label: 'Theme: light', checked: theme === 'light' },
      { id: 'theme-dark', label: 'Theme: dark', checked: theme === 'dark' },
      {
        id: 'sticky',
        label: 'Pin ancestors while scrolling',
        checked: this.store.stickyEnabled(),
        separatorBefore: true,
      },
      { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', separatorBefore: true },
      ...(this.doc.hasDocument()
        ? [{ id: 'close', label: 'Close file', icon: 'close' as const }]
        : []),
    ];
  });

  // --- the file ------------------------------------------------------------

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear it so choosing the same file again still fires a change.
    input.value = '';
    if (file) this.openFile.emit(file);
  }

  // --- the views -----------------------------------------------------------

  protected setView(view: ViewKind): void {
    this.store.view.set(view);
  }

  // --- search --------------------------------------------------------------

  /** Called by the shell for Ctrl/Cmd+F. */
  focusSearch(): void {
    const input = this.searchInput()?.nativeElement;
    input?.focus();
    input?.select();
  }

  protected onQuery(event: Event): void {
    this.store.setQuery((event.target as HTMLInputElement).value);
  }

  protected onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) this.store.previousHit();
      else this.store.nextHit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.store.clearSearch();
      (event.target as HTMLInputElement).blur();
    }
  }

  protected clearSearch(): void {
    this.store.clearSearch();
    this.focusSearch();
  }

  // --- popovers ------------------------------------------------------------

  protected togglePopover(kind: 'options' | 'overflow', event: MouseEvent): void {
    if (this.popover()?.kind === kind) {
      this.popover.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.popover.set({ kind, x: rect.left, y: rect.bottom + 4 });
  }

  protected onPopoverAction(id: string): void {
    switch (id) {
      case 'inKeys':
      case 'inValues':
      case 'caseSensitive':
        this.store.setSearchOption(id, !this.store.searchOptions()[id]);
        // Toggling an option keeps the menu open: they are usually set together.
        return;
      case 'theme-system':
        this.themes.set('system');
        break;
      case 'theme-light':
        this.themes.set('light');
        break;
      case 'theme-dark':
        this.themes.set('dark');
        break;
      case 'sticky':
        this.store.stickyEnabled.update((on) => !on);
        return;
      case 'shortcuts':
        this.showShortcuts.emit();
        break;
      case 'close':
        this.closeFile.emit();
        break;
    }
    this.popover.set(null);
  }
}
