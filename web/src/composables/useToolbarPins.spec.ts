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

  it("pins ONLY histogram by default on a pristine profile", async () => {
    const { useToolbarPins } = await importFresh();
    const { isPinned } = useToolbarPins();
    expect(isPinned("histogram")).toBe(true);
    expect(isPinned("savedViews")).toBe(false);
    expect(isPinned("sqlMode")).toBe(false);
  });

  it("keeps savedViews pinned for a user who pinned it explicitly", async () => {
    window.localStorage.setItem(
      "logs_toolbar_pinned_items",
      JSON.stringify(["histogram", "savedViews"]),
    );
    const { useToolbarPins } = await importFresh();
    expect(useToolbarPins().isPinned("savedViews")).toBe(true);
  });

  it("keeps the histogram decided-flag behavior intact", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins().togglePin("histogram");
    expect(window.localStorage.getItem("logs_toolbar_histogram_pin_decided")).toBe("true");
    const fresh = await importFresh();
    expect(fresh.useToolbarPins().isPinned("histogram")).toBe(false);
  });

  it("orders pinned items canonically regardless of pin order", async () => {
    const { useToolbarPins } = await importFresh();
    const { togglePin, pinnedItems } = useToolbarPins();
    togglePin("syntaxGuide");
    togglePin("sqlMode");
    expect(pinnedItems.value).toEqual(["histogram", "sqlMode", "syntaxGuide"]);
  });
});

describe("useToolbarPins scopes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps the logs storage key and defaults unchanged", async () => {
    const { useToolbarPins } = await importFresh();
    const { togglePin, pinnedItems } = useToolbarPins();
    expect(pinnedItems.value).toEqual(["histogram"]);
    togglePin("sqlMode");
    expect(JSON.parse(window.localStorage.getItem("logs_toolbar_pinned_items")!)).toEqual([
      "histogram",
      "sqlMode",
    ]);
    expect(window.localStorage.getItem("traces_toolbar_pinned_items")).toBeNull();
  });

  it("pins traces saved views by default", async () => {
    const { useToolbarPins } = await importFresh();
    const { isPinned, pinnedItems } = useToolbarPins("traces");
    expect(isPinned("savedViews")).toBe(true);
    expect(pinnedItems.value).toEqual(["savedViews"]);
  });

  it("isolates scopes from each other", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins("traces").togglePin("savedViews");
    expect(useToolbarPins("traces").isPinned("savedViews")).toBe(false);
    expect(useToolbarPins().isPinned("savedViews")).toBe(false);
    useToolbarPins().togglePin("savedViews");
    expect(useToolbarPins().isPinned("savedViews")).toBe(true);
    expect(useToolbarPins("traces").isPinned("savedViews")).toBe(false);
    expect(window.localStorage.getItem("logs_toolbar_histogram_pin_decided")).toBeNull();
  });

  it("keeps instances of one scope in sync", async () => {
    const { useToolbarPins } = await importFresh();
    const a = useToolbarPins("traces");
    const b = useToolbarPins("traces");
    a.togglePin("savedViews");
    expect(b.isPinned("savedViews")).toBe(false);
  });

  it("keeps traces saved views unpinned across a module reload", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins("traces").togglePin("savedViews");
    expect(window.localStorage.getItem("traces_toolbar_saved_views_pin_decided")).toBe("true");
    const fresh = await importFresh();
    expect(fresh.useToolbarPins("traces").isPinned("savedViews")).toBe(false);
  });

  it("keeps each default's decided flag when stored pins are corrupt", async () => {
    window.localStorage.setItem("logs_toolbar_pinned_items", "{not json");
    window.localStorage.setItem("traces_toolbar_pinned_items", "{not json");
    window.localStorage.setItem("traces_toolbar_saved_views_pin_decided", "true");
    const { useToolbarPins } = await importFresh();
    expect(useToolbarPins("traces").isPinned("savedViews")).toBe(false);
    expect(useToolbarPins().isPinned("histogram")).toBe(true);
  });
});
