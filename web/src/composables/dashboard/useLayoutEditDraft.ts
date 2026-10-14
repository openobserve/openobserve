// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { computed, ref } from "vue";

export interface PanelLayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSnapshot {
  tabOrder: string[];
  layouts: Record<string, Record<string, PanelLayoutBox>>;
}

interface DraftPanel {
  id: string;
  layout?: Partial<PanelLayoutBox> & Record<string, unknown>;
}

interface DraftTab {
  tabId: string;
  panels?: DraftPanel[];
}

export interface DraftDashboard {
  tabs?: DraftTab[];
}

export interface LayoutEditDraftOptions {
  /** Called after a snapshot was written back to the dashboard, so the grid can move to it. */
  onApply?: (snapshot: LayoutSnapshot) => void;
}

export const takeLayoutSnapshot = (
  dashboard: DraftDashboard | null | undefined,
): LayoutSnapshot => {
  const tabs = dashboard?.tabs ?? [];
  const layouts: LayoutSnapshot["layouts"] = {};
  for (const tab of tabs) {
    const panels: Record<string, PanelLayoutBox> = {};
    for (const panel of tab.panels ?? []) {
      if (!panel?.id || !panel.layout) continue;
      const { x = 0, y = 0, w = 0, h = 0 } = panel.layout;
      panels[panel.id] = { x, y, w, h };
    }
    layouts[tab.tabId] = panels;
  }
  return { tabOrder: tabs.map((tab) => tab.tabId), layouts };
};

export const applyLayoutSnapshot = (
  dashboard: DraftDashboard | null | undefined,
  snapshot: LayoutSnapshot,
): void => {
  if (!dashboard?.tabs) return;
  const byId = new Map(dashboard.tabs.map((tab) => [tab.tabId, tab]));
  // Tabs added since the snapshot keep their place at the end rather than vanishing.
  const ordered = [
    ...snapshot.tabOrder.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    ...dashboard.tabs.filter((tab) => !snapshot.tabOrder.includes(tab.tabId)),
  ];
  const orderChanged = ordered.some((tab, i) => tab !== dashboard.tabs![i]);
  if (orderChanged) dashboard.tabs = ordered;

  for (const tab of dashboard.tabs) {
    const saved = snapshot.layouts[tab.tabId];
    if (!saved) continue;
    for (const panel of tab.panels ?? []) {
      const box = saved[panel.id];
      if (!box || !panel.layout) continue;
      Object.assign(panel.layout, box);
    }
  }
};

const sameSnapshot = (a: LayoutSnapshot, b: LayoutSnapshot): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Explicit layout edit mode: a baseline plus an undo/redo history of layout snapshots, never persisted until Save. */
export function useLayoutEditDraft(
  getDashboard: () => DraftDashboard | null | undefined,
  options: LayoutEditDraftOptions = {},
) {
  const isEditing = ref(false);
  const history = ref<LayoutSnapshot[]>([]);
  const cursor = ref(0);

  const changeCount = computed(() => (isEditing.value ? cursor.value : 0));
  const isDirty = computed(() => changeCount.value > 0);
  const canUndo = computed(() => isEditing.value && cursor.value > 0);
  const canRedo = computed(() => isEditing.value && cursor.value < history.value.length - 1);

  const apply = (snapshot: LayoutSnapshot) => {
    applyLayoutSnapshot(getDashboard(), snapshot);
    options.onApply?.(snapshot);
  };

  const reset = () => {
    isEditing.value = false;
    history.value = [];
    cursor.value = 0;
  };

  const start = () => {
    if (isEditing.value) return;
    history.value = [takeLayoutSnapshot(getDashboard())];
    cursor.value = 0;
    isEditing.value = true;
  };

  /** Records the dashboard's current layout as one history entry; returns false when nothing moved. */
  const record = (): boolean => {
    if (!isEditing.value) return false;
    const next = takeLayoutSnapshot(getDashboard());
    if (sameSnapshot(next, history.value[cursor.value])) return false;
    history.value = [...history.value.slice(0, cursor.value + 1), next];
    cursor.value = history.value.length - 1;
    return true;
  };

  const undo = () => {
    if (!canUndo.value) return;
    cursor.value -= 1;
    apply(history.value[cursor.value]);
  };

  const redo = () => {
    if (!canRedo.value) return;
    cursor.value += 1;
    apply(history.value[cursor.value]);
  };

  /** Restores the baseline and leaves edit mode; pass `target` when the dashboard on screen was already replaced. */
  const discard = (target?: DraftDashboard | null) => {
    if (!isEditing.value) return;
    if (isDirty.value) {
      if (target) applyLayoutSnapshot(target, history.value[0]);
      else apply(history.value[0]);
    }
    reset();
  };

  /** Leaves edit mode keeping the current layout, after it was saved. */
  const finish = () => reset();

  return {
    isEditing,
    changeCount,
    isDirty,
    canUndo,
    canRedo,
    start,
    record,
    undo,
    redo,
    discard,
    finish,
  };
}

export default useLayoutEditDraft;
