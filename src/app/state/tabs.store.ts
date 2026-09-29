import {
  EnvironmentInjector,
  Injectable,
  InjectionToken,
  afterNextRender,
  computed,
  createEnvironmentInjector,
  inject,
  signal,
} from '@angular/core';
import { JsonDocumentStore } from './json-document.store';
import { ViewerStore } from './viewer.store';
import { NodeActions } from './node-actions';
import { describeSize, needsSizeWarning } from '../core/load-json';
import { activeAfterClose } from '../core/tab-order';

/** The id of the tab an injector belongs to. Provided in each tab's scope. */
export const TAB_ID = new InjectionToken<number>('TAB_ID');

export interface DocumentTab {
  readonly id: number;
  /** The tab's own scope: its document, its view state and its actions. */
  readonly injector: EnvironmentInjector;
  readonly doc: JsonDocumentStore;
}

/**
 * The open files, one per tab.
 *
 * Each tab is a DI scope of its own: an environment injector that provides a
 * `JsonDocumentStore`, a `ViewerStore` and a `NodeActions`. Every component
 * rendered inside a tab keeps its plain `inject(ViewerStore)` and gets that
 * tab's instance without knowing tabs exist -- and closing the tab destroys the
 * scope, which takes the parsed graph and the view state's effect with it.
 *
 * There is always at least one tab. The last one is emptied rather than
 * removed, and an empty tab is what the landing screen is.
 */
@Injectable({ providedIn: 'root' })
export class TabsStore {
  private readonly parent = inject(EnvironmentInjector);

  private readonly _tabs = signal<readonly DocumentTab[]>([]);
  private readonly _activeId = signal(0);

  readonly tabs = this._tabs.asReadonly();
  readonly activeId = this._activeId.asReadonly();

  readonly active = computed(
    () => this._tabs().find((tab) => tab.id === this._activeId()) ?? this._tabs()[0],
  );

  /** The landing screen: a single tab, with nothing in it. */
  readonly isEmpty = computed(() => {
    const tabs = this._tabs();
    return tabs.length === 1 && tabs[0].doc.phase() === 'idle';
  });

  private seq = 0;

  /** Loads run one after another. See `open`. */
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    const first = this.create();
    this._tabs.set([first]);
    this._activeId.set(first.id);
  }

  activate(id: number): void {
    if (this._tabs().some((tab) => tab.id === id)) this._activeId.set(id);
  }

  /**
   * Open files: the one place a file enters the application.
   *
   * Every file gets a tab of its own, and the first of them is shown. A loaded
   * document is never replaced: only a tab with nothing to show -- the landing
   * screen, or a file that was refused -- is reused, for the first file.
   *
   * Loads are queued rather than run side by side. Each one holds the whole
   * file as a string until it is parsed, and three 100 MB strings at once is
   * how a page dies. A tab is only created when its turn comes, so no tab ever
   * sits on the landing screen while it waits.
   */
  open(files: readonly File[]): void {
    const current = this.active();
    const phase = current.doc.phase();
    const reused = phase === 'idle' || phase === 'error' ? current : null;

    this.confirmSizes(files).forEach((file, position) => {
      const target = position === 0 ? reused : null;
      this.queue = this.queue
        .then(() => this.load(file, target, position === 0))
        .catch((error: unknown) => reportError(error));
    });
  }

  /**
   * Close a tab and release its memory. The last tab is emptied instead, which
   * is what closing the only file did before there were tabs.
   */
  close(id: number): void {
    const tabs = this._tabs();
    const tab = tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    if (tabs.length === 1) {
      tab.doc.close();
      return;
    }

    const next = activeAfterClose(
      tabs.map((candidate) => candidate.id),
      this._activeId(),
      id,
    );
    this._tabs.set(tabs.filter((candidate) => candidate !== tab));
    if (next !== null) this._activeId.set(next);

    // Destroyed only once its pane has been torn down, so nothing is ever
    // rendered against a dead scope.
    afterNextRender(() => tab.injector.destroy(), { injector: this.parent });
  }

  // --- plumbing -------------------------------------------------------------

  private create(): DocumentTab {
    const id = ++this.seq;
    const injector = createEnvironmentInjector(
      [JsonDocumentStore, ViewerStore, NodeActions, { provide: TAB_ID, useValue: id }],
      this.parent,
      `Tab ${id}`,
    );
    return { id, injector, doc: injector.get(JsonDocumentStore) };
  }

  /** Load one file into `target`, or into a new tab when it has none -- or it was closed meanwhile. */
  private async load(file: File, target: DocumentTab | null, show: boolean): Promise<void> {
    let tab = target && this._tabs().includes(target) ? target : null;
    if (!tab) {
      const created = this.create();
      this._tabs.update((tabs) => [...tabs, created]);
      tab = created;
    }
    if (show) this._activeId.set(tab.id);
    await tab.doc.open(file);
  }

  /**
   * Ask before any load that would take the window past the soft limit.
   *
   * Asked up front, for every file in turn, so a batch never stops halfway to
   * wait for an answer. A reused tab counts for nothing: it holds no document.
   */
  private confirmSizes(files: readonly File[]): File[] {
    let openBytes = this._tabs().reduce((sum, tab) => sum + (tab.doc.meta()?.byteSize ?? 0), 0);
    return files.filter((file) => {
      if (needsSizeWarning(file, openBytes)) {
        const already =
          openBytes > 0 ? `, on top of the ${describeSize(openBytes)} of files already open` : '';
        const proceed = confirm(
          `${file.name} is ${describeSize(file.size)}. Opening it may use around ` +
            `${describeSize(file.size * 3)} of memory${already}. Continue?`,
        );
        if (!proceed) return false;
      }
      openBytes += file.size;
      return true;
    });
  }
}
