/**
 * Structure inference: the "shape without the data" view.
 *
 * One full scan of the document collapses it into a tree of ~230 nodes for the
 * reference file. All positions at the same place in the shape are unified:
 * every element of an array merges into a single `items` schema, and objects
 * take the union of their keys.
 *
 * The one distinction that makes this view worth having is "key absent" versus
 * "key present but null" -- a bare key outline teaches you nothing.
 *
 * Performance note: this scan touches all 1.87M nodes, so it must allocate
 * almost nothing per node. An earlier version built a JSON Pointer string for
 * every node to record a first example; that alone cost 197ms versus 42ms. Paths
 * are therefore never built here -- schema-link.ts derives them on demand from
 * the ~230-node tree instead.
 */

import { FieldStats, Row, ScalarType, isContainer, scalarType } from './flatten';
import { TreeState, isOpen } from './tree-state';

/** The synthetic key standing for "any element of this array". */
export const ITEM = '[]';

export interface SchemaNode {
  /** A position can be several of these at once (e.g. sometimes array, sometimes null). */
  readonly kinds: Set<'object' | 'array' | 'scalar'>;
  /** Scalar types observed at this position. */
  readonly types: Set<ScalarType>;
  /** How many values were observed at this position. */
  count: number;
  /** Observed nulls. Counted separately from an absent key. */
  nulls: number;
  /** Observed empty strings. */
  empties: number;
  /** Object positions: union of keys, in first-seen order. */
  readonly fields: Map<string, SchemaNode>;
  /** Array positions: unified schema of all elements. */
  items?: SchemaNode;
  /** Array positions: observed length range. */
  minLength?: number;
  maxLength?: number;
  /**
   * Total elements across every array seen at this position. This -- not the
   * number of arrays -- is the parent count for the `items` node, or a 56,865
   * element array would report a presence ratio of 56,865.
   */
  totalElements?: number;
}

function emptyNode(): SchemaNode {
  return {
    kinds: new Set(),
    types: new Set(),
    count: 0,
    nulls: 0,
    empties: 0,
    fields: new Map(),
  };
}

/** Escape one path segment for an RFC 6901 JSON Pointer. */
export function escapePointerSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Infer the structure of `root`.
 *
 * Iterative, like flatten(), so a deeply nested document cannot blow the stack.
 * Allocates nothing per scalar node.
 */
export function buildSchema(root: unknown): SchemaNode {
  const schema = emptyNode();
  // Flat parallel stacks: one entry per pending (value, schema node) pair.
  const values: unknown[] = [root];
  const nodes: SchemaNode[] = [schema];

  while (values.length > 0) {
    const value = values.pop();
    const node = nodes.pop()!;
    node.count++;

    if (!isContainer(value)) {
      node.kinds.add('scalar');
      node.types.add(scalarType(value));
      if (value === null) node.nulls++;
      else if (value === '') node.empties++;
      continue;
    }

    if (Array.isArray(value)) {
      node.kinds.add('array');
      const len = value.length;
      node.minLength = node.minLength === undefined ? len : Math.min(node.minLength, len);
      node.maxLength = node.maxLength === undefined ? len : Math.max(node.maxLength, len);
      node.totalElements = (node.totalElements ?? 0) + len;
      if (len > 0) {
        const items = node.items ?? (node.items = emptyNode());
        // Every element unifies into the single `items` node.
        for (let i = 0; i < len; i++) {
          values.push(value[i]);
          nodes.push(items);
        }
      }
      continue;
    }

    node.kinds.add('object');
    for (const key of Object.keys(value)) {
      let field = node.fields.get(key);
      if (!field) {
        field = emptyNode();
        node.fields.set(key, field);
      }
      values.push((value as Record<string, unknown>)[key]);
      nodes.push(field);
    }
  }

  return schema;
}

/** How a schema node's type is rendered: `string | null`, `object`, `array`... */
export function describeType(node: SchemaNode): string {
  const parts: string[] = [];
  if (node.kinds.has('object')) parts.push('object');
  if (node.kinds.has('array')) parts.push('array');
  // 'null' reads better last in a union.
  const scalars = [...node.types].sort((a, b) =>
    a === 'null' ? 1 : b === 'null' ? -1 : a.localeCompare(b),
  );
  parts.push(...scalars);
  return parts.length > 0 ? parts.join(' | ') : 'unknown';
}

function statsFor(node: SchemaNode, parentCount: number): FieldStats {
  return {
    types: [...node.types],
    count: node.count,
    parentCount,
    nulls: node.nulls,
    empties: node.empties,
    lengths:
      node.minLength === undefined ? undefined : { min: node.minLength, max: node.maxLength! },
  };
}

/** True when this schema position has children to expand. */
export function schemaHasChildren(node: SchemaNode): boolean {
  return node.fields.size > 0 || node.items !== undefined;
}

/**
 * The count a child's `count` should be compared against to get a presence
 * ratio. For array elements that is the total number of elements seen, not the
 * number of arrays.
 */
function parentCountFor(node: SchemaNode, key: string | number): number {
  return key === ITEM ? (node.totalElements ?? node.count) : node.count;
}

interface SchemaFrame {
  readonly node: SchemaNode;
  readonly children: Array<{ key: string; child: SchemaNode }>;
  i: number;
  readonly depth: number;
  readonly parent: number;
}

function childrenOf(node: SchemaNode): Array<{ key: string; child: SchemaNode }> {
  const out: Array<{ key: string; child: SchemaNode }> = [];
  for (const [key, child] of node.fields) out.push({ key, child });
  if (node.items) out.push({ key: ITEM, child: node.items });
  return out;
}

/**
 * Flatten a schema into the same Row shape the data view uses, so a single
 * renderer serves both views.
 *
 * The schema is ~230 nodes for the reference file, but that is a property of
 * that file and not of JSON, so this shares the data view's row cap.
 */
export function flattenSchema(
  schema: SchemaNode,
  state: TreeState,
  maxRows = Number.POSITIVE_INFINITY,
): Row[] {
  const rows: Row[] = [];
  if (!schemaHasChildren(schema) && schema.count === 0) return rows;

  const stack: SchemaFrame[] = [
    { node: schema, children: childrenOf(schema), i: 0, depth: 0, parent: -1 },
  ];

  while (stack.length > 0 && rows.length < maxRows) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.children.length) {
      stack.pop();
      continue;
    }

    const { key, child } = frame.children[frame.i];
    frame.i++;

    const expandable = schemaHasChildren(child);
    const index = rows.length;
    rows.push({
      kind: expandable ? (child.kinds.has('array') ? 'array' : 'object') : 'leaf',
      key,
      depth: frame.depth,
      parent: frame.parent,
      size: child.fields.size + (child.items ? 1 : 0),
      indexInParent: frame.i - 1,
      siblingCount: frame.children.length,
      ref: expandable ? child : undefined,
      meta: statsFor(child, parentCountFor(frame.node, key)),
    });

    if (expandable && isOpen(state, child, frame.depth)) {
      stack.push({
        node: child,
        children: childrenOf(child),
        i: 0,
        depth: frame.depth + 1,
        parent: index,
      });
    }
  }

  return rows;
}

/** Every node of a schema, for expand-all in the structure view. */
export function allSchemaNodes(schema: SchemaNode): Set<object> {
  const out = new Set<object>([schema]);
  const stack: SchemaNode[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const child of node.fields.values()) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
    if (node.items && !out.has(node.items)) {
      out.add(node.items);
      stack.push(node.items);
    }
  }
  return out;
}

/**
 * Walk a schema down a path of schema keys (array positions use ITEM).
 */
export function schemaNodeAt(
  schema: SchemaNode,
  keys: readonly string[],
): SchemaNode | undefined {
  let node: SchemaNode | undefined = schema;
  for (const key of keys) {
    if (!node) return undefined;
    node = key === ITEM ? node.items : node.fields.get(key);
  }
  return node;
}

/** The chain of schema nodes along a schema key path, for revealing ancestors. */
export function schemaChain(schema: SchemaNode, keys: readonly string[]): SchemaNode[] {
  const chain: SchemaNode[] = [];
  let node: SchemaNode | undefined = schema;
  for (const key of keys) {
    if (!node) break;
    chain.push(node);
    node = key === ITEM ? node.items : node.fields.get(key);
  }
  return chain;
}
