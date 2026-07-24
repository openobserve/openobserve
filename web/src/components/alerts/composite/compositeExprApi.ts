// Copyright 2026 OpenObserve Inc.
//
// Injection contract shared between CompositeExpressionBuilder (owner of the AST)
// and the recursive ExprNode renderer, so nodes at any depth can mutate the tree
// by path without prop-drilling handlers.

import type { InjectionKey } from "vue";

export interface CompositeExprApi {
  /** Toggle the AND ⇄ OR operator of the group at `path`. */
  toggleOp: (path: number[]) => void;
  /** Remove the node at `path` (collapsing emptied groups). */
  removeAt: (path: number[]) => void;
  /** Open the "add a query / bracketed group" popover anchored to the + button. */
  requestAdd: (path: number[], ev: MouseEvent) => void;
  /** Friendly display label for an alias, e.g. "alert_1" → "Alert 1". */
  labelOf: (alias: string) => string;
}

export const COMPOSITE_EXPR_API: InjectionKey<CompositeExprApi> =
  Symbol("compositeExprApi");
