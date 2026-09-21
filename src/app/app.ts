import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { JsonTree, RowMenuRequest } from './tree/json-tree';
import { AppToolbar } from './chrome/toolbar';
import { AppBreadcrumb } from './chrome/breadcrumb';
import { AppStatusBar } from './chrome/status-bar';
import { AppEmptyState } from './chrome/empty-state';
import { AppErrorPanel } from './chrome/error-panel';
import { ContextMenu } from './ui/context-menu';
import { AppIcon } from './ui/icon';
import { JsonDocumentStore } from './state/json-document.store';
import { ViewerStore } from './state/viewer.store';
import { ToastStore } from './state/toast.store';
import { NodeActions, NodeActionId } from './state/node-actions';
import { describeSize, needsSizeWarning } from './core/load-json';

/**
 * The shell.
 *
 * It owns what crosses the whole window -- the file itself, drag and drop, the
 * global shortcuts, and the overlays -- and nothing else. The bars, the tree
 * and the menus are their own components, which is also what keeps each
 * stylesheet inside the 4 kB `anyComponentStyle` budget.
 */
@Component({
  selector: 'app-root',
  imports: [
    JsonTree,
    AppToolbar,
    AppBreadcrumb,
    AppStatusBar,
    AppEmptyState,
    AppErrorPanel,
    ContextMenu,
    AppIcon,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly doc = inject(JsonDocumentStore);
  protected readonly store = inject(ViewerStore);
  protected readonly toasts = inject(ToastStore);
  protected readonly actions = inject(NodeActions);

  private readonly tree = viewChild(JsonTree);
  private readonly toolbar = viewChild(AppToolbar);

  protected readonly isDragging = signal(false);
  protected readonly shortcutsOpen = signal(false);

  /** The row menu: which row, and where it was opened. */
  protected readonly rowMenu = signal<RowMenuRequest | null>(null);

  protected readonly menuItems = computed(() => {
    const request = this.rowMenu();
    return request ? this.actions.menuFor(request.index) : [];
  });

  protected readonly menuHeading = computed(() => {
    const request = this.rowMenu();
    return request ? this.actions.headingFor(request.index) : null;
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

  protected async open(file: File): Promise<void> {
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
    this.rowMenu.set(null);
  }

  // --- the row menu -------------------------------------------------------

  protected openRowMenu(request: RowMenuRequest): void {
    this.rowMenu.set(request);
  }

  protected runRowAction(id: string): void {
    const request = this.rowMenu();
    this.rowMenu.set(null);
    if (request) this.actions.run(id as NodeActionId, request.index);
    this.tree()?.focus();
  }

  protected closeRowMenu(): void {
    this.rowMenu.set(null);
    this.tree()?.focus();
  }

  // --- global shortcuts ---------------------------------------------------

  @HostListener('keydown', ['$event'])
  protected onGlobalKeydown(event: KeyboardEvent): void {
    const isFind = (event.metaKey || event.ctrlKey) && event.key === 'f';
    if (isFind && this.doc.hasDocument()) {
      // The browser's own find would only see the ~40 virtualised rows in the
      // DOM, which is actively misleading -- so this shadows it deliberately.
      event.preventDefault();
      this.toolbar()?.focusSearch();
      return;
    }
    if (event.key === 'Escape' && this.shortcutsOpen()) {
      event.preventDefault();
      this.shortcutsOpen.set(false);
    }
  }
}
