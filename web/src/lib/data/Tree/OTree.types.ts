// Copyright 2026 OpenObserve Inc.

export type TreeNodeKey = string | number;

export interface TreeNode {
  /** Display text — also the default `node-key` field */
  label: string;
  /** Child nodes; absence or empty array means this is a leaf */
  children?: TreeNode[];
  /** Whether this node is disabled */
  disabled?: boolean;
  /** Arbitrary extra fields callers may attach */
  [key: string]: unknown;
}

export type TickStrategy = "leaf";

export interface TreeProps {
  /** Array of root nodes */
  nodes: TreeNode[];
  /** Field on each node used as the unique key. Default: `"label"` */
  nodeKey?: string;
  /**
   * Which nodes get tick checkboxes.
   * Currently only `"leaf"` is supported: only leaf nodes are tickable;
   * parent nodes show an indeterminate checkbox when partially selected.
   */
  tickStrategy?: TickStrategy;
  /** Array of currently ticked node-key values */
  ticked?: TreeNodeKey[];
  /** Array of currently expanded node-key values */
  expanded?: TreeNodeKey[];
  /** Filter string — nodes not matching are hidden */
  filter?: string;
  /**
   * Custom filter predicate.
   * `(node: TreeNode, filter: string) => boolean`
   * When omitted, a case-insensitive label substring match is used.
   */
  filterMethod?: (node: TreeNode, filter: string) => boolean;
  /** Expand all nodes on first render */
  defaultExpandAll?: boolean;
}

export interface TreeEmits {
  (_e: "update:ticked", _value: TreeNodeKey[]): void;
  (_e: "update:expanded", _value: TreeNodeKey[]): void;
}
