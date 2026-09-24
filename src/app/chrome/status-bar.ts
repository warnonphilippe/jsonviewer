import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { JsonDocumentStore } from '../state/json-document.store';
import { ViewerStore } from '../state/viewer.store';

/**
 * The document's measurements.
 *
 * The file's identity moved up to the toolbar chip, so what is left here is
 * what the numbers say about it -- which is the point of opening a 60 MB export
 * in the first place.
 */
@Component({
  selector: 'app-status-bar',
  templateUrl: './status-bar.html',
  styleUrl: './status-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppStatusBar {
  protected readonly doc = inject(JsonDocumentStore);
  protected readonly store = inject(ViewerStore);

  protected readonly nodes = computed(() => this.doc.meta()?.nodeCount.toLocaleString() ?? '');
  protected readonly schemaNodes = computed(
    () => this.doc.meta()?.schemaNodeCount.toLocaleString() ?? '',
  );
  protected readonly rows = computed(() => this.store.rows().length.toLocaleString());

  protected readonly timings = computed(() => {
    const meta = this.doc.meta();
    if (!meta) return '';
    return (
      `read ${meta.readMs.toFixed(0)} ms · ` +
      `parse ${meta.parseMs.toFixed(0)} ms · ` +
      `analyse ${meta.schemaMs.toFixed(0)} ms`
    );
  });
}
