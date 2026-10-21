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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useLayoutEditDraft,
  takeLayoutSnapshot,
  applyLayoutSnapshot,
  type DraftDashboard,
} from "./useLayoutEditDraft";

const makeDashboard = (): DraftDashboard => ({
  tabs: [
    {
      tabId: "t1",
      panels: [
        { id: "p1", layout: { x: 0, y: 0, w: 96, h: 18, i: "p1" } },
        { id: "p2", layout: { x: 96, y: 0, w: 96, h: 18, i: "p2" } },
      ],
    },
    { tabId: "t2", panels: [{ id: "p3", layout: { x: 0, y: 0, w: 192, h: 9, i: "p3" } }] },
  ],
});

const move = (dashboard: DraftDashboard, panelId: string, x: number, y: number) => {
  for (const tab of dashboard.tabs ?? []) {
    const panel = tab.panels?.find((p) => p.id === panelId);
    if (panel?.layout) Object.assign(panel.layout, { x, y });
  }
};

const layoutOf = (dashboard: DraftDashboard, panelId: string) => {
  for (const tab of dashboard.tabs ?? []) {
    const panel = tab.panels?.find((p) => p.id === panelId);
    if (panel) return { ...panel.layout };
  }
  return undefined;
};

describe("useLayoutEditDraft", () => {
  let dashboard: DraftDashboard;
  let onApply: ReturnType<typeof vi.fn>;
  let draft: ReturnType<typeof useLayoutEditDraft>;

  beforeEach(() => {
    dashboard = makeDashboard();
    onApply = vi.fn();
    draft = useLayoutEditDraft(() => dashboard, { onApply });
  });

  it("starts outside edit mode with nothing to undo", () => {
    expect(draft.isEditing.value).toBe(false);
    expect(draft.changeCount.value).toBe(0);
    expect(draft.isDirty.value).toBe(false);
    expect(draft.canUndo.value).toBe(false);
    expect(draft.canRedo.value).toBe(false);
  });

  it("ignores record() while not editing", () => {
    move(dashboard, "p1", 10, 0);
    expect(draft.record()).toBe(false);
    expect(draft.changeCount.value).toBe(0);
  });

  it("counts one change per recorded move and marks the draft dirty", () => {
    draft.start();
    move(dashboard, "p1", 10, 0);
    expect(draft.record()).toBe(true);
    move(dashboard, "p2", 0, 18);
    draft.record();

    expect(draft.changeCount.value).toBe(2);
    expect(draft.isDirty.value).toBe(true);
    expect(draft.canUndo.value).toBe(true);
    expect(draft.canRedo.value).toBe(false);
  });

  it("does not record an entry when nothing moved", () => {
    draft.start();
    expect(draft.record()).toBe(false);
    expect(draft.changeCount.value).toBe(0);
  });

  it("undo and redo write the snapshots back to the dashboard and notify the grid", () => {
    draft.start();
    move(dashboard, "p1", 10, 0);
    draft.record();
    move(dashboard, "p1", 20, 4);
    draft.record();

    draft.undo();
    expect(layoutOf(dashboard, "p1")).toMatchObject({ x: 10, y: 0, i: "p1" });
    expect(draft.changeCount.value).toBe(1);
    expect(draft.canRedo.value).toBe(true);
    expect(onApply).toHaveBeenCalledTimes(1);

    draft.undo();
    expect(layoutOf(dashboard, "p1")).toMatchObject({ x: 0, y: 0 });
    expect(draft.isDirty.value).toBe(false);
    expect(draft.canUndo.value).toBe(false);

    draft.redo();
    draft.redo();
    expect(layoutOf(dashboard, "p1")).toMatchObject({ x: 20, y: 4 });
    expect(draft.changeCount.value).toBe(2);
    expect(draft.canRedo.value).toBe(false);
  });

  it("drops the redo branch when a new change is recorded after undo", () => {
    draft.start();
    move(dashboard, "p1", 10, 0);
    draft.record();
    draft.undo();
    move(dashboard, "p2", 0, 30);
    draft.record();

    expect(draft.changeCount.value).toBe(1);
    expect(draft.canRedo.value).toBe(false);
  });

  it("undoes a tab reorder", () => {
    draft.start();
    dashboard.tabs = [dashboard.tabs![1], dashboard.tabs![0]];
    draft.record();
    expect(dashboard.tabs.map((t) => t.tabId)).toEqual(["t2", "t1"]);

    draft.undo();
    expect(dashboard.tabs.map((t) => t.tabId)).toEqual(["t1", "t2"]);
  });

  it("discard restores the baseline and leaves edit mode", () => {
    draft.start();
    move(dashboard, "p3", 0, 40);
    draft.record();
    dashboard.tabs = [dashboard.tabs![1], dashboard.tabs![0]];
    draft.record();

    draft.discard();

    expect(draft.isEditing.value).toBe(false);
    expect(draft.changeCount.value).toBe(0);
    expect(layoutOf(dashboard, "p3")).toMatchObject({ x: 0, y: 0 });
    expect(dashboard.tabs.map((t) => t.tabId)).toEqual(["t1", "t2"]);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("discard with a target restores that object instead of the current one", () => {
    draft.start();
    move(dashboard, "p1", 50, 0);
    draft.record();
    const old = dashboard;
    dashboard = makeDashboard();

    draft.discard(old);

    expect(layoutOf(old, "p1")).toMatchObject({ x: 0, y: 0 });
    expect(onApply).not.toHaveBeenCalled();
    expect(draft.isEditing.value).toBe(false);
  });

  it("discard on a clean draft leaves the dashboard untouched", () => {
    draft.start();
    draft.discard();
    expect(onApply).not.toHaveBeenCalled();
    expect(draft.isEditing.value).toBe(false);
  });

  it("finish keeps the current layout and clears the history", () => {
    draft.start();
    move(dashboard, "p1", 10, 0);
    draft.record();

    draft.finish();

    expect(draft.isEditing.value).toBe(false);
    expect(draft.changeCount.value).toBe(0);
    expect(layoutOf(dashboard, "p1")).toMatchObject({ x: 10 });
  });

  it("takes a new baseline every time edit mode starts", () => {
    draft.start();
    move(dashboard, "p1", 10, 0);
    draft.record();
    draft.finish();

    draft.start();
    move(dashboard, "p1", 30, 0);
    draft.record();
    draft.discard();

    expect(layoutOf(dashboard, "p1")).toMatchObject({ x: 10 });
  });
});

describe("layout snapshots", () => {
  it("captures tab order and x/y/w/h per panel only", () => {
    expect(takeLayoutSnapshot(makeDashboard())).toEqual({
      tabOrder: ["t1", "t2"],
      layouts: {
        t1: { p1: { x: 0, y: 0, w: 96, h: 18 }, p2: { x: 96, y: 0, w: 96, h: 18 } },
        t2: { p3: { x: 0, y: 0, w: 192, h: 9 } },
      },
    });
  });

  it("keeps a tab that is missing from the snapshot at the end", () => {
    const dashboard = makeDashboard();
    const snapshot = takeLayoutSnapshot(dashboard);
    dashboard.tabs!.unshift({ tabId: "t3", panels: [] });

    applyLayoutSnapshot(dashboard, snapshot);

    expect(dashboard.tabs!.map((t) => t.tabId)).toEqual(["t1", "t2", "t3"]);
  });

  it("tolerates a dashboard without tabs", () => {
    expect(takeLayoutSnapshot({})).toEqual({ tabOrder: [], layouts: {} });
    expect(() => applyLayoutSnapshot(null, { tabOrder: [], layouts: {} })).not.toThrow();
  });
});
