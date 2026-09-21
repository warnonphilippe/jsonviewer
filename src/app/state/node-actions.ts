import { Injectable, inject } from '@angular/core';
import { ViewerStore } from './viewer.store';
import { ToastStore } from './toast.store';
import { MenuItem } from '../ui/context-menu';
import { countNodesUpTo } from '../core/flatten';
import { describeSize } from '../core/load-json';
import { keyPath, toJsAccessor } from '../core/path';

/** Refuse to put more than this on the clipboard; the API chokes on more. */
const COPY_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Refuse a subtree above this many nodes before serialising it. Checking the
 * serialised length alone would mean building a 59 MB string just to reject it.
 */
const COPY_MAX_NODES = 200_000;

export type NodeActionId =
  | 'copy-path'
  | 'copy-pointer'
  | 'copy-subtree'
  | 'expand-subtree'
  | 'collapse'
  | 'jump'
  | 'find-key';

/**
 * Everything you can do to one node.
 *
 * A service rather than methods on the shell, because the same catalogue is
 * offered from three places -- the breadcrumb bar, the row's hover cluster and
 * its context menu -- and they must not drift apart. Each surface decides what
 * to show; none of them decides what an action *means*.
 */
@Injectable({ providedIn: 'root' })
export class NodeActions {
  private readonly store = inject(ViewerStore);
  private readonly toast = inject(ToastStore);

  /** The action list for a row, with the ones that cannot apply disabled. */
  menuFor(index: number): MenuItem[] {
    const row = this.store.rows()[index];
    const isStructure = this.store.view() === 'structure';
    const isContainer = !!row?.ref;
    const expanded = this.store.isExpanded(index);

    return [
      { id: 'copy-path', label: 'Copy path', icon: 'copy' },
      { id: 'copy-pointer', label: 'Copy JSON Pointer', icon: 'link' },
      {
        id: 'copy-subtree',
        label: 'Copy subtree',
        icon: 'braces',
        // The structure view has no values to copy.
        disabled: isStructure || !row,
      },
      {
        id: 'expand-subtree',
        label: 'Expand subtree',
        icon: 'expand',
        keyHint: '*',
        disabled: !isContainer,
        separatorBefore: true,
      },
      {
        id: 'collapse',
        label: 'Collapse',
        icon: 'collapse',
        keyHint: '←',
        disabled: !isContainer || !expanded,
      },
      {
        id: 'jump',
        label: isStructure ? 'Show in data view' : 'Show in structure view',
        icon: 'swap',
        keyHint: 'j',
        separatorBefore: true,
      },
      {
        id: 'find-key',
        label: 'Find this key',
        icon: 'search',
        disabled: !row || row.kind === 'more',
      },
    ];
  }

  /** The accessor path of a row, for a menu heading. */
  headingFor(index: number): string | null {
    const rows = this.store.rows();
    if (index < 0 || index >= rows.length) return null;
    return toJsAccessor(keyPath(rows, index));
  }

  run(id: NodeActionId, index: number): void {
    switch (id) {
      case 'copy-path':
        this.copyPath(index);
        break;
      case 'copy-pointer':
        this.copyPointer(index);
        break;
      case 'copy-subtree':
        this.copySubtree(index);
        break;
      case 'expand-subtree':
        this.expandSubtree(index);
        break;
      case 'collapse':
        this.store.setExpanded(index, false);
        break;
      case 'jump':
        this.jump(index);
        break;
      case 'find-key':
        this.findKey(index);
        break;
    }
  }

  // --- copying --------------------------------------------------------------

  copyPath(index: number): void {
    const path = this.pathAt(index);
    if (path) void this.write(path.accessor, 'Path copied');
  }

  copyPointer(index: number): void {
    const path = this.pathAt(index);
    if (path) void this.write(path.pointer, 'JSON Pointer copied');
  }

  copySubtree(index: number): void {
    const rows = this.store.rows();
    const row = rows[index];
    if (!row) return;

    if (this.store.view() === 'structure') {
      this.toast.show('Switch to the data view to copy a value');
      return;
    }

    const subtree = row.ref ?? row.value;
    // Check the size BEFORE serialising: stringifying the root would build a
    // string the size of the whole file just to discover it is too big.
    const nodes = countNodesUpTo(subtree, COPY_MAX_NODES);
    if (nodes > COPY_MAX_NODES) {
      this.toast.show(
        `That subtree has over ${COPY_MAX_NODES.toLocaleString()} nodes — too large for ` +
          `the clipboard. Pick a node further down.`,
      );
      return;
    }

    let text: string;
    try {
      text = JSON.stringify(subtree, null, 2) ?? 'undefined';
    } catch {
      this.toast.show('This value could not be serialised');
      return;
    }
    if (text.length > COPY_MAX_BYTES) {
      this.toast.show(
        `That subtree is ${describeSize(text.length)} — too large for the clipboard. ` +
          `Pick a node further down.`,
      );
      return;
    }
    const label = keyPath(rows, index).slice(-1)[0];
    void this.write(text, `Copied ${describeSize(text.length)} from "${label}"`);
  }

  // --- navigating -----------------------------------------------------------

  expandSubtree(index: number): void {
    if (!this.store.expandSubtree(index)) {
      this.toast.show('That branch is too large to open in one go — opened what fits.');
    }
  }

  jump(index: number): void {
    if (index < 0) return;
    const landed =
      this.store.view() === 'data'
        ? this.store.showInStructureView(index)
        : this.store.showInDataView(index);
    if (landed < 0) this.toast.show('No matching position in the other view');
  }

  /** Search for this row's key, in keys only -- "where else does this appear?". */
  findKey(index: number): void {
    const row = this.store.rows()[index];
    if (!row || row.kind === 'more') return;
    this.store.setSearchOption('inKeys', true);
    this.store.setSearchOption('inValues', false);
    this.store.setQuery(String(row.key));
  }

  // --- plumbing -------------------------------------------------------------

  private pathAt(index: number) {
    // focusPath already derives both display forms for the focused row; for any
    // other row, focus it first so the two stay consistent.
    if (this.store.focusIndex() !== index) this.store.focusIndex.set(index);
    return this.store.focusPath();
  }

  private async write(text: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show(message);
    } catch {
      this.toast.show('The clipboard is not available in this context');
    }
  }
}
