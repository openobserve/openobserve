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

  it("pins histogram AND savedViews by default on a pristine profile", async () => {
    const { useToolbarPins } = await importFresh();
    const { isPinned } = useToolbarPins();
    expect(isPinned("histogram")).toBe(true);
    expect(isPinned("savedViews")).toBe(true);
    expect(isPinned("sqlMode")).toBe(false);
  });

  it("adds savedViews for a pre-existing profile that never decided on it", async () => {
    // A pins array persisted before savedViews became default-pinned: its
    // absence means "never decided", not "unpinned".
    window.localStorage.setItem(
      "logs_toolbar_pinned_items",
      JSON.stringify(["sqlMode"]),
    );
    const { useToolbarPins } = await importFresh();
    const { isPinned } = useToolbarPins();
    expect(isPinned("sqlMode")).toBe(true);
    expect(isPinned("savedViews")).toBe(true);
  });

  it("respects an explicit unpin of savedViews (decided flag set)", async () => {
    window.localStorage.setItem(
      "logs_toolbar_pinned_items",
      JSON.stringify(["histogram"]),
    );
    window.localStorage.setItem("logs_toolbar_saved_views_pin_decided", "true");
    const { useToolbarPins } = await importFresh();
    expect(useToolbarPins().isPinned("savedViews")).toBe(false);
  });

  it("unpinning savedViews records the decision so the default stops reapplying", async () => {
    const { useToolbarPins } = await importFresh();
    const { isPinned, togglePin } = useToolbarPins();
    expect(isPinned("savedViews")).toBe(true);

    togglePin("savedViews");
    expect(isPinned("savedViews")).toBe(false);
    expect(
      window.localStorage.getItem("logs_toolbar_saved_views_pin_decided"),
    ).toBe("true");

    // A later session must not silently re-pin it.
    const fresh = await importFresh();
    expect(fresh.useToolbarPins().isPinned("savedViews")).toBe(false);
  });

  it("keeps the histogram decided-flag behavior intact", async () => {
    const { useToolbarPins } = await importFresh();
    useToolbarPins().togglePin("histogram");
    expect(
      window.localStorage.getItem("logs_toolbar_histogram_pin_decided"),
    ).toBe("true");
    const fresh = await importFresh();
    expect(fresh.useToolbarPins().isPinned("histogram")).toBe(false);
  });

  it("orders pinned items canonically regardless of pin order", async () => {
    const { useToolbarPins } = await importFresh();
    const { togglePin, pinnedItems } = useToolbarPins();
    togglePin("syntaxGuide");
    togglePin("sqlMode");
    expect(pinnedItems.value).toEqual([
      "histogram",
      "sqlMode",
      "savedViews",
      "syntaxGuide",
    ]);
  });
});
