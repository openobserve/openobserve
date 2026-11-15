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

import { describe, it, expect, beforeEach, vi } from "vitest";

// Pins are module-level state initialized from localStorage at import time, so
// each test seeds storage first and imports a FRESH copy of the module.
const importFresh = async () => {
  vi.resetModules();
  return await import("./useToolbarPins");
};

describe("useToolbarPins defaults", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("pins nothing by default on a pristine profile", async () => {
    const { useToolbarPins } = await importFresh();
    const { isPinned, pinnedItems } = useToolbarPins();
    expect(isPinned("histogram")).toBe(false);
    expect(isPinned("savedViews")).toBe(false);
    expect(pinnedItems.value).toEqual([]);
  });

  it("keeps savedViews pinned for a user who pinned it explicitly", async () => {
    window.localStorage.setItem(
      "logs_toolbar_pinned_items",
      JSON.stringify(["histogram", "savedViews"]),
    );
    const { useToolbarPins } = await importFresh();
    expect(useToolbarPins().isPinned("savedViews")).toBe(true);
  });

  it("keeps a histogram the user pinned across a module reload", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins().togglePin("histogram");
    const fresh = await importFresh();
    expect(fresh.useToolbarPins().isPinned("histogram")).toBe(true);
  });

  it("orders pinned items canonically regardless of pin order", async () => {
    const { useToolbarPins } = await importFresh();
    const { togglePin, pinnedItems } = useToolbarPins();
    togglePin("syntaxGuide");
    togglePin("sqlMode");
    togglePin("histogram");
    expect(pinnedItems.value).toEqual(["histogram", "sqlMode", "syntaxGuide"]);
  });
});

describe("useToolbarPins scopes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps the logs storage key unchanged", async () => {
    const { useToolbarPins } = await importFresh();
    const { togglePin, pinnedItems } = useToolbarPins();
    expect(pinnedItems.value).toEqual([]);
    togglePin("sqlMode");
    expect(JSON.parse(window.localStorage.getItem("logs_toolbar_pinned_items")!)).toEqual([
      "sqlMode",
    ]);
    expect(window.localStorage.getItem("traces_toolbar_pinned_items")).toBeNull();
  });

  it("pins nothing by default on traces", async () => {
    const { useToolbarPins } = await importFresh();
    const { isPinned, pinnedItems } = useToolbarPins("traces");
    expect(isPinned("savedViews")).toBe(false);
    expect(isPinned("histogram")).toBe(false);
    expect(pinnedItems.value).toEqual([]);
  });

  it("pins traces RED Metrics through the histogram key in canonical order", async () => {
    const { useToolbarPins } = await importFresh();
    const { togglePin, pinnedItems } = useToolbarPins("traces");
    togglePin("savedViews");
    togglePin("histogram");
    expect(pinnedItems.value).toEqual(["histogram", "savedViews"]);
    expect(JSON.parse(window.localStorage.getItem("traces_toolbar_pinned_items")!)).toEqual([
      "savedViews",
      "histogram",
    ]);
    const fresh = await importFresh();
    expect(fresh.useToolbarPins("traces").isPinned("histogram")).toBe(true);
  });

  it("keeps the traces and logs histogram pins independent", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins("traces").togglePin("histogram");
    expect(useToolbarPins("traces").isPinned("histogram")).toBe(true);
    useToolbarPins().togglePin("histogram");
    expect(useToolbarPins().isPinned("histogram")).toBe(true);
    expect(useToolbarPins("traces").isPinned("histogram")).toBe(true);
    useToolbarPins("traces").togglePin("histogram");
    expect(useToolbarPins("traces").isPinned("histogram")).toBe(false);
    expect(useToolbarPins().isPinned("histogram")).toBe(true);
  });

  it("isolates scopes from each other", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins("traces").togglePin("savedViews");
    expect(useToolbarPins("traces").isPinned("savedViews")).toBe(true);
    expect(useToolbarPins().isPinned("savedViews")).toBe(false);
    useToolbarPins().togglePin("savedViews");
    useToolbarPins("traces").togglePin("savedViews");
    expect(useToolbarPins().isPinned("savedViews")).toBe(true);
    expect(useToolbarPins("traces").isPinned("savedViews")).toBe(false);
  });

  it("keeps instances of one scope in sync", async () => {
    const { useToolbarPins } = await importFresh();
    const a = useToolbarPins("traces");
    const b = useToolbarPins("traces");
    a.togglePin("savedViews");
    expect(b.isPinned("savedViews")).toBe(true);
  });

  it("keeps traces saved views pinned across a module reload once pinned", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins("traces").togglePin("savedViews");
    const fresh = await importFresh();
    expect(fresh.useToolbarPins("traces").isPinned("savedViews")).toBe(true);
  });

  it("pins nothing when stored pins are corrupt", async () => {
    window.localStorage.setItem("logs_toolbar_pinned_items", "{not json");
    window.localStorage.setItem("traces_toolbar_pinned_items", "{not json");
    const { useToolbarPins } = await importFresh();
    expect(useToolbarPins("traces").isPinned("savedViews")).toBe(false);
    expect(useToolbarPins().isPinned("histogram")).toBe(false);
  });
});
