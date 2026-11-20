// Copyright 2026 OpenObserve Inc.
// A read-only JSON tree with per-row actions; editing JSON is the code editor's job.

import type { InjectionKey } from "vue";

export interface JsonViewerProps {
  value: unknown;
  /** Levels open on first render; deeper objects start collapsed. */
  expandDepth?: number;
  /** Provided by the `@include` listener; the row then offers "filter for this value". */
  onInclude?: (path: string, value: unknown) => void;
  /** Provided by the `@exclude` listener; the row then offers "filter out this value". */
  onExclude?: (path: string, value: unknown) => void;
  /** data-test prefix for the rows ("<prefix>-row-<path>"). */
  dataTest?: string;
}

export interface JsonViewerEmits {
  (e: "copy", path: string, value: unknown): void;
}

export interface JsonViewerContext {
  expandDepth: number;
  dataTest: string;
  include?: (path: string, value: unknown) => void;
  exclude?: (path: string, value: unknown) => void;
  copied: (path: string, value: unknown) => void;
}

export const JSON_VIEWER_CONTEXT: InjectionKey<JsonViewerContext> = Symbol("jsonViewerContext");

export interface JsonViewerNodeProps {
  /** Key in the parent object, index in the parent array, or null for the root. */
  name: string | number | null;
  value: unknown;
  path: string;
  depth: number;
  /** Prints a trailing comma, as JSON reads. */
  last?: boolean;
}
