// Copyright 2026 OpenObserve Inc.

import type { AnyRow } from "./kubernetesModel";
import type { DetailsRef } from "./kubernetesUrlState";

export type DockKind = "logs" | "yaml";

export interface DockTab {
  id: string;
  kind: DockKind;
  ref: DetailsRef;
  // The row as it was when opened, so a tab outlives the page view that listed it.
  snapshot?: AnyRow | null;
}

export interface DockState {
  tabs: DockTab[];
  active: string | null;
  // False while minimized: the tabs stay, only the panel hides.
  open: boolean;
  maximized: boolean;
}

export const emptyDock = (): DockState => ({
  tabs: [],
  active: null,
  open: false,
  maximized: false,
});

export const tabId = (kind: DockKind, ref: DetailsRef) =>
  [kind, ref.kind, ref.cluster, ref.namespace, ref.name].join("|");

// Opening what is already open focuses it instead of adding a duplicate tab.
export function openTab(
  state: DockState,
  kind: DockKind,
  ref: DetailsRef,
  snapshot?: AnyRow | null,
): DockState {
  const id = tabId(kind, ref);
  const tabs = state.tabs.some((t) => t.id === id)
    ? state.tabs.map((t) => (t.id === id && snapshot ? { ...t, snapshot } : t))
    : [...state.tabs, { id, kind, ref, snapshot }];
  return { ...state, tabs, active: id, open: true };
}

export function closeTab(state: DockState, id: string): DockState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) return emptyDock();
  const active = state.active === id ? tabs[Math.min(index, tabs.length - 1)].id : state.active;
  return { ...state, tabs, active };
}

export const selectTab = (state: DockState, id: string): DockState =>
  state.tabs.some((t) => t.id === id) ? { ...state, active: id, open: true } : state;

export const toggleMinimized = (state: DockState): DockState => ({
  ...state,
  open: !state.open,
});

// Maximizing implies the panel is showing.
export const toggleMaximized = (state: DockState): DockState => ({
  ...state,
  maximized: !state.maximized,
  open: true,
});
