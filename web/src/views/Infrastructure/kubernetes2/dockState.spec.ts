// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  closeTab,
  emptyDock,
  openTab,
  selectTab,
  tabId,
  toggleMaximized,
  toggleMinimized,
} from "./dockState";
import type { DetailsRef } from "./kubernetesUrlState";

const pod = (name: string): DetailsRef => ({
  kind: "pod",
  cluster: "prod",
  namespace: "web",
  name,
});

describe("dockState", () => {
  it("opens a tab, makes it active and shows the panel", () => {
    const state = openTab(emptyDock(), "logs", pod("a"));
    expect(state.tabs).toHaveLength(1);
    expect(state.active).toBe(tabId("logs", pod("a")));
    expect(state.open).toBe(true);
  });

  it("focuses an already-open tab instead of duplicating it", () => {
    let state = openTab(emptyDock(), "logs", pod("a"));
    state = openTab(state, "yaml", pod("a"));
    state = openTab(state, "logs", pod("a"));
    expect(state.tabs).toHaveLength(2);
    expect(state.active).toBe(tabId("logs", pod("a")));
  });

  it("treats logs and yaml of the same object as different tabs", () => {
    expect(tabId("logs", pod("a"))).not.toBe(tabId("yaml", pod("a")));
  });

  it("moves to the neighbouring tab when the active one closes", () => {
    let state = openTab(emptyDock(), "logs", pod("a"));
    state = openTab(state, "logs", pod("b"));
    state = openTab(state, "logs", pod("c"));
    state = selectTab(state, tabId("logs", pod("b")));
    state = closeTab(state, tabId("logs", pod("b")));
    expect(state.active).toBe(tabId("logs", pod("c")));
    state = closeTab(state, tabId("logs", pod("c")));
    expect(state.active).toBe(tabId("logs", pod("a")));
  });

  it("keeps the active tab when another one closes", () => {
    let state = openTab(emptyDock(), "logs", pod("a"));
    state = openTab(state, "logs", pod("b"));
    state = closeTab(state, tabId("logs", pod("a")));
    expect(state.active).toBe(tabId("logs", pod("b")));
  });

  it("resets to an empty, closed dock when the last tab closes", () => {
    let state = openTab(emptyDock(), "logs", pod("a"));
    state = toggleMaximized(state);
    state = closeTab(state, tabId("logs", pod("a")));
    expect(state).toEqual(emptyDock());
  });

  it("minimizes without losing tabs and reopens on selecting one", () => {
    let state = openTab(emptyDock(), "logs", pod("a"));
    state = toggleMinimized(state);
    expect(state.open).toBe(false);
    expect(state.tabs).toHaveLength(1);
    state = selectTab(state, tabId("logs", pod("a")));
    expect(state.open).toBe(true);
  });

  it("maximizing shows a minimized panel", () => {
    let state = toggleMinimized(openTab(emptyDock(), "logs", pod("a")));
    state = toggleMaximized(state);
    expect(state).toMatchObject({ open: true, maximized: true });
  });

  it("ignores closing or selecting an unknown tab", () => {
    const state = openTab(emptyDock(), "logs", pod("a"));
    expect(closeTab(state, "nope")).toBe(state);
    expect(selectTab(state, "nope")).toBe(state);
  });

  it("keeps the snapshot a tab was opened with", () => {
    const row = { name: "a" } as any;
    const state = openTab(emptyDock(), "yaml", pod("a"), row);
    expect(state.tabs[0].snapshot).toBe(row);
  });

  it("refreshes the snapshot on reopen only when a non-null one is given", () => {
    const first = { name: "first" } as any;
    const second = { name: "second" } as any;
    let state = openTab(emptyDock(), "yaml", pod("a"), first);
    state = openTab(state, "yaml", pod("a"), null);
    expect(state.tabs[0].snapshot).toBe(first);
    state = openTab(state, "yaml", pod("a"));
    expect(state.tabs[0].snapshot).toBe(first);
    state = openTab(state, "yaml", pod("a"), second);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].snapshot).toBe(second);
  });
});
