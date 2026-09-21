import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { JsonTree } from './tree/json-tree';
import { JsonDocumentStore } from './state/json-document.store';
import { ViewKind, ViewerStore } from './state/viewer.store';
import { describeSize, needsSizeWarning } from './core/load-json';
import { keyPath } from './core/path';
import { countNodesUpTo } from './core/flatten';

type Theme = 'system' | 'light' | 'dark';

/** Refuse to put more than this on the clipboard; the API chokes on more. */
const COPY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Refuse a subtree above this many nodes before serialising it. Checking the
 * serialised length alone would mean building a 59 MB string just to reject it.
 */
const COPY_MAX_NODES = 200_000;

@Component({
  selector: 'app-root',
  imports: [JsonTree],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly doc = inject(JsonDocumentStore);
  protected readonly store = inject(ViewerStore);

  private readonly tree = viewChild(JsonTree);

  protected readonly isDragging = signal(false);
  protected readonly toast = signal('');
  protected readonly searchOpen = signal(false);
  protected readonly theme = signal<Theme>('system');

  protected readonly searchSummary = computed(() => {
    const result = this.store.searchResult();
    if (this.store.searchOptions().query === '') return '';
    if (result.total === 0) return 'no matches';
    const position = this.store.currentHit() + 1;
    const shown = result.capped
      ? `${position} of ${result.hits.length.toLocaleString()} shown, ${result.total.toLocaleString()} total`
      : `${position} of ${result.total.toLocaleString()}`;
    return `${shown} · ${result.elapsedMs.toFixed(0)} ms`;
  });

  protected readonly statusText = computed(() => {
    const meta = this.doc.meta();
    if (!meta) return '';
    const parts = [
      meta.fileName,
      describeSize(meta.byteSize),
      // Only NDJSON announces its format: it is what explains the array at the
      // root, which the file itself does not show.
      ...(meta.format === 'ndjson'
        ? [`NDJSON · ${(meta.recordCount ?? 0).toLocaleString()} records`]
        : []),
      `${meta.nodeCount.toLocaleString()} nodes`,
      `${meta.schemaNodeCount.toLocaleString()} structure nodes`,
      `read ${meta.readMs.toFixed(0)} ms · parse ${meta.parseMs.toFixed(0)} ms · analyse ${meta.schemaMs.toFixed(0)} ms`,
      `${this.store.rows().length.toLocaleString()} rows`,
    ];
    return parts.join('  ·  ');
  });

  protected readonly phaseLabel = computed(() => {
    switch (this.doc.phase()) {
      case 'reading':
        return 'Reading file…';
      case 'parsing':
        return 'Parsing JSON…';
      case 'analyzing':
        return 'Analysing structure…';
      default:
        return '';
    }
  });

  // --- opening a file -----------------------------------------------------

  protected async onFileInput(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear the input so choosing the same file again still fires a change.
    input.value = '';
    if (file) await this.open(file);
  }

  @HostListener('dragover', ['$event'])
  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  @HostListener('dragleave', ['$event'])
  protected onDragLeave(event: DragEvent): void {
    if (event.relatedTarget === null) this.isDragging.set(false);
  }

  @HostListener('drop', ['$event'])
  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.open(file);
  }

  private async open(file: File): Promise<void> {
    if (needsSizeWarning(file)) {
      const proceed = confirm(
        `${file.name} is ${describeSize(file.size)}. Opening it may use around ` +
          `${describeSize(file.size * 3)} of memory. Continue?`,
      );
      if (!proceed) return;
    }
    await this.doc.open(file);
  }

  protected close(): void {
    this.doc.close();
    this.searchOpen.set(false);
  }

  // --- views --------------------------------------------------------------

  protected setView(view: ViewKind): void {
    this.store.view.set(view);
  }

  protected jump(): void {
    const index = this.store.focusIndex();
    if (index < 0) return;
    const landed =
      this.store.view() === 'data'
        ? this.store.showInStructureView(index)
        : this.store.showInDataView(index);
    if (landed < 0) this.showToast('No matching position in the other view');
  }

  // --- search -------------------------------------------------------------

  protected openSearch(): void {
    this.searchOpen.set(true);
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
    this.store.clearSearch();
    this.tree()?.focus();
  }

  protected onQuery(event: Event): void {
    this.store.setQuery((event.target as HTMLInputElement).value);
  }

  protected toggleSearchOption(key: 'inKeys' | 'inValues' | 'caseSensitive'): void {
    this.store.setSearchOption(key, !this.store.searchOptions()[key]);
  }

  protected nextHit(): void {
    this.store.nextHit();
  }

  protected previousHit(): void {
    this.store.previousHit();
  }

  @HostListener('keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    const isFind = (event.metaKey || event.ctrlKey) && event.key === 'f';
    if (isFind && this.doc.hasDocument()) {
      // The browser's own find would only see the ~40 virtualised rows in the
      // DOM, which is actively misleading -- so this shadows it deliberately.
      event.preventDefault();
      this.openSearch();
      return;
    }
    if (event.key === 'Escape' && this.searchOpen()) {
      event.preventDefault();
      this.closeSearch();
    }
  }

  // --- copying ------------------------------------------------------------

  protected copyPointer(): void {
    const path = this.store.focusPath();
    if (path) void this.write(path.pointer, 'JSON Pointer copied');
  }

  protected copyAccessor(): void {
    const path = this.store.focusPath();
    if (path) void this.write(path.accessor, 'Path copied');
  }

  protected copySubtree(): void {
    const index = this.store.focusIndex();
    const rows = this.store.rows();
    const row = rows[index];
    if (!row) return;

    if (this.store.view() === 'structure') {
      this.showToast('Switch to the data view to copy a value');
      return;
    }

    const subtree = row.ref ?? row.value;
    // Check the size BEFORE serialising: stringifying the root would build a
    // string the size of the whole file just to discover it is too big.
    const nodes = countNodesUpTo(subtree, COPY_MAX_NODES);
    if (nodes > COPY_MAX_NODES) {
      this.showToast(
        `That subtree has over ${COPY_MAX_NODES.toLocaleString()} nodes — too large for ` +
          `the clipboard. Pick a node further down.`,
      );
      return;
    }

    let text: string;
    try {
      text = JSON.stringify(subtree, null, 2) ?? 'undefined';
    } catch {
      this.showToast('This value could not be serialised');
      return;
    }
    if (text.length > COPY_MAX_BYTES) {
      this.showToast(
        `That subtree is ${describeSize(text.length)} — too large for the clipboard. ` +
          `Pick a node further down.`,
      );
      return;
    }
    const label = keyPath(rows, index).slice(-1)[0];
    void this.write(text, `Copied ${describeSize(text.length)} from "${label}"`);
  }

  private async write(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.showToast(message);
    } catch {
      this.showToast('The clipboard is not available in this context');
    }
  }

  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  private showToast(message: string): void {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(''), 2600);
  }

  // --- theme --------------------------------------------------------------

  protected cycleTheme(): void {
    const next: Theme =
      this.theme() === 'system' ? 'light' : this.theme() === 'light' ? 'dark' : 'system';
    this.theme.set(next);
    const root = document.documentElement;
    if (next === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
  }
}
