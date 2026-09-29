/**
 * Owns one tab's parsed document.
 *
 * There is one per tab (see `TabsStore`), and it is the only place that tab's
 * parsed graph lives, and the only place a file is read. Everything downstream
 * reads `root()` synchronously.
 *
 * If a future requirement ever justifies moving the data into a Web Worker,
 * only this file changes: `open()` becomes a postMessage round trip and the
 * readers gain a Promise. Measurements say that is not worth doing today
 * (parse is ~70ms, schema ~50ms), but the seam costs nothing to keep.
 */

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { SchemaNode, allSchemaNodes, buildSchema } from '../core/schema';
import {
  DocumentFormat,
  LoadError,
  describeSize,
  loadJsonFile,
  nextPaint,
} from '../core/load-json';
import { countNodes } from '../core/flatten';

export type LoadPhase = 'idle' | 'reading' | 'parsing' | 'analyzing' | 'ready' | 'error';

export interface DocumentMeta {
  readonly fileName: string;
  /** JSON, or NDJSON read as an array of its records. */
  readonly format: DocumentFormat;
  /** Number of records, for NDJSON only. */
  readonly recordCount?: number;
  readonly byteSize: number;
  readonly charSize: number;
  readonly nodeCount: number;
  readonly schemaNodeCount: number;
  readonly readMs: number;
  readonly parseMs: number;
  readonly schemaMs: number;
}

/** Provided per tab, never at the root: see `TabsStore`. */
@Injectable()
export class JsonDocumentStore {
  private readonly _phase = signal<LoadPhase>('idle');
  private readonly _fileName = signal('');
  private readonly _root = signal<unknown>(undefined);
  private readonly _schema = signal<SchemaNode | null>(null);
  private readonly _meta = signal<DocumentMeta | null>(null);
  private readonly _error = signal<LoadError | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly root = this._root.asReadonly();
  readonly schema = this._schema.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly error = this._error.asReadonly();

  /** Set as soon as a load starts, so a tab is named while it loads or fails. */
  readonly fileName = this._fileName.asReadonly();

  readonly isLoading = computed(() => {
    const phase = this._phase();
    return phase === 'reading' || phase === 'parsing' || phase === 'analyzing';
  });
  readonly hasDocument = computed(() => this._phase() === 'ready');
  readonly sizeLabel = computed(() => {
    const meta = this._meta();
    return meta ? describeSize(meta.byteSize) : '';
  });

  /**
   * Bumped by every close, so a load that was overtaken -- by a close, by the
   * next file, or by the tab being torn down -- knows to drop its result.
   */
  private generation = 0;

  constructor() {
    // Closing the tab destroys its injector; release the graph with it.
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Read and parse a file. The source file is only ever read, never written. */
  async open(file: File): Promise<void> {
    // Drop the previous document before parsing its replacement: holding both
    // graphs at once, on top of the new file's text, is how the page runs out
    // of memory unrecoverably.
    this.close();
    const generation = this.generation;
    this._fileName.set(file.name);
    this._phase.set('reading');
    await nextPaint();
    if (generation !== this.generation) return;

    const outcome = await loadJsonFile(file);
    if (generation !== this.generation) return;
    if (!outcome.ok) {
      this._error.set(outcome.error);
      this._phase.set('error');
      return;
    }

    this._phase.set('analyzing');
    await nextPaint();
    if (generation !== this.generation) return;

    const schemaStarted = performance.now();
    const schema = buildSchema(outcome.value);
    const schemaMs = performance.now() - schemaStarted;

    this._root.set(outcome.value);
    this._schema.set(schema);
    this._meta.set({
      fileName: file.name,
      format: outcome.format,
      recordCount: outcome.recordCount,
      byteSize: file.size,
      charSize: outcome.charSize,
      nodeCount: countNodes(outcome.value),
      schemaNodeCount: allSchemaNodes(schema).size,
      readMs: outcome.timings.readMs,
      parseMs: outcome.timings.parseMs,
      schemaMs,
    });
    this._phase.set('ready');
  }

  /** Release the document, so its memory can be reclaimed. */
  close(): void {
    this.generation++;
    this._fileName.set('');
    this._root.set(undefined);
    this._schema.set(null);
    this._meta.set(null);
    this._error.set(null);
    this._phase.set('idle');
  }
}
