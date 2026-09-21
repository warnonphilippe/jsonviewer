/**
 * Owns the parsed document.
 *
 * This is the only place the parsed graph lives, and the only async boundary in
 * the application. Everything downstream reads `root()` synchronously.
 *
 * If a future requirement ever justifies moving the data into a Web Worker,
 * only this file changes: `open()` becomes a postMessage round trip and the
 * readers gain a Promise. Measurements say that is not worth doing today
 * (parse is ~70ms, schema ~50ms), but the seam costs nothing to keep.
 */

import { Injectable, computed, signal } from '@angular/core';
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

@Injectable({ providedIn: 'root' })
export class JsonDocumentStore {
  private readonly _phase = signal<LoadPhase>('idle');
  private readonly _root = signal<unknown>(undefined);
  private readonly _schema = signal<SchemaNode | null>(null);
  private readonly _meta = signal<DocumentMeta | null>(null);
  private readonly _error = signal<LoadError | null>(null);

  readonly phase = this._phase.asReadonly();
  readonly root = this._root.asReadonly();
  readonly schema = this._schema.asReadonly();
  readonly meta = this._meta.asReadonly();
  readonly error = this._error.asReadonly();

  readonly isLoading = computed(() => {
    const phase = this._phase();
    return phase === 'reading' || phase === 'parsing' || phase === 'analyzing';
  });
  readonly hasDocument = computed(() => this._phase() === 'ready');
  readonly sizeLabel = computed(() => {
    const meta = this._meta();
    return meta ? describeSize(meta.byteSize) : '';
  });

  /** Read and parse a file. The source file is only ever read, never written. */
  async open(file: File): Promise<void> {
    // Drop the previous document before parsing the next one: holding two
    // graphs at once is how a tab runs out of memory unrecoverably.
    this.close();
    this._phase.set('reading');
    await nextPaint();

    const outcome = await loadJsonFile(file);
    if (!outcome.ok) {
      this._error.set(outcome.error);
      this._phase.set('error');
      return;
    }

    this._phase.set('analyzing');
    await nextPaint();

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
    this._root.set(undefined);
    this._schema.set(null);
    this._meta.set(null);
    this._error.set(null);
    this._phase.set('idle');
  }
}
