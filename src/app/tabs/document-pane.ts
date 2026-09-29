import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { JsonTree, RowMenuRequest } from '../tree/json-tree';
import { AppToolbar } from '../chrome/toolbar';
import { AppBreadcrumb } from '../chrome/breadcrumb';
import { AppStatusBar } from '../chrome/status-bar';
import { AppEmptyState } from '../chrome/empty-state';
import { AppErrorPanel } from '../chrome/error-panel';
import { ContextMenu } from '../ui/context-menu';
import { AppIcon } from '../ui/icon';
import { JsonDocumentStore } from '../state/json-document.store';
import { ViewerStore } from '../state/viewer.store';
import { NodeActions, NodeActionId } from '../state/node-actions';
import { ShellStore } from '../state/shell.store';
import { TAB_ID, TabsStore } from '../state/tabs.store';

/**
 * One tab's document: its toolbar, its bars, its tree and its row menu.
 *
 * Created by the shell inside the tab's own injector, so everything below it
 * -- this included -- injects that tab's stores. It is what the whole window
 * used to be before there were tabs, less what belongs to the window: the tab
 * strip, drag and drop, and the overlays drawn over every tab.
 */
@Component({
  selector: 'app-document-pane',
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
  templateUrl: './document-pane.html',
  styleUrl: './document-pane.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentPane {
  protected readonly doc = inject(JsonDocumentStore);
  protected readonly store = inject(ViewerStore);
  protected readonly actions = inject(NodeActions);
  protected readonly shell = inject(ShellStore);
  private readonly tabs = inject(TabsStore);
  private readonly id = inject(TAB_ID);

  private readonly tree = viewChild(JsonTree);
  private readonly toolbar = viewChild(AppToolbar);

  /** Inactive panes stay mounted, so each has to know whether it is the one on screen. */
  private readonly isActive = computed(() => this.tabs.activeId() === this.id);

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

  constructor() {
    // A menu belongs to the tab it was opened in: leaving the tab closes it,
    // rather than keeping it to reappear, stale, when you come back.
    effect(() => {
      if (this.isActive()) return;
      this.rowMenu.set(null);
      this.toolbar()?.dismissPopover();
    });
  }

  // --- the file -----------------------------------------------------------

  /** From the toolbar's picker: each file opens in a tab of its own. */
  protected open(files: File[]): void {
    this.tabs.open(files);
  }

  protected close(): void {
    this.rowMenu.set(null);
    this.tabs.close(this.id);
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

  // --- shortcuts ----------------------------------------------------------

  /**
   * Ctrl/Cmd+F, for the tab on screen. On the document rather than the host,
   * so it also works while the focus is on the tab strip -- every pane hears
   * it, and only the active one acts.
   */
  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    const isFind = (event.metaKey || event.ctrlKey) && event.key === 'f';
    if (!isFind || !this.isActive() || !this.doc.hasDocument()) return;
    // The browser's own find would only see the ~40 virtualised rows in the
    // DOM, which is actively misleading -- so this shadows it deliberately.
    event.preventDefault();
    this.toolbar()?.focusSearch();
  }
}
