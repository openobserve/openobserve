// Copyright 2026 OpenObserve Inc.
// Shared injection key and context shape for OTree ↔ OTreeNode communication.

import type { InjectionKey } from "vue";
import type { TreeNodeKey } from "./OTree.types";
import type { TreeNode } from "./OTree.types";

export interface TreeContext {
  /** Field name used as the unique node key */
  nodeKey: string;
  /** Currently ticked leaf-node keys */
  ticked: TreeNodeKey[];
  /** Set of currently expanded node keys */
  expanded: Set<TreeNodeKey>;
  /** Current filter string */
  filter: string;
  /** Filter predicate */
  filterMethod: (node: TreeNode, filter: string) => boolean;
  /** Toggle a single leaf tick on/off */
  setLeafTicked(key: TreeNodeKey, ticked: boolean): void;
  /** Tick or untick an array of leaf keys at once */
  setLeavesTicked(keys: TreeNodeKey[], ticked: boolean): void;
  /** Toggle a node's expanded state */
  toggleExpanded(key: TreeNodeKey): void;
}

export const TREE_CONTEXT_KEY: InjectionKey<TreeContext> =
  Symbol("OTreeContext");
