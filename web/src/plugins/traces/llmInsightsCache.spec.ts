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

import { describe, it, expect } from "vitest";
import { selectionKey, createSelectionCache } from "./llmInsightsCache";

describe("selectionKey", () => {
  it("composes stream + agent + window into a stable string", () => {
    expect(selectionKey("default", "_stream", 100, 200)).toBe("default::_stream::100-200");
  });

  it("differs by selection and by window", () => {
    const a = selectionKey("s", "_stream", 1, 2);
    const b = selectionKey("s", "o2-ai", 1, 2); // different agent
    const c = selectionKey("s", "_stream", 1, 3); // different window
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("createSelectionCache", () => {
  it("stores and retrieves by key", () => {
    const cache = createSelectionCache<number>();
    expect(cache.has("k")).toBe(false);
    cache.set("k", 42);
    expect(cache.has("k")).toBe(true);
    expect(cache.get("k")).toBe(42);
  });

  it("caches empty/falsy values too (so 'no rows' isn't a miss)", () => {
    const cache = createSelectionCache<any[]>();
    cache.set("empty", []);
    expect(cache.has("empty")).toBe(true);
    expect(cache.get("empty")).toEqual([]);
  });

  it("evicts the oldest entry (FIFO) once over the 60-entry bound", () => {
    const cache = createSelectionCache<number>();
    for (let i = 0; i < 60; i++) cache.set(`k${i}`, i);
    expect(cache.has("k0")).toBe(true);
    cache.set("k60", 60); // 61st distinct key → evicts the oldest (k0)
    expect(cache.has("k0")).toBe(false);
    expect(cache.has("k1")).toBe(true);
    expect(cache.has("k60")).toBe(true);
  });

  it("re-setting an existing key does not evict", () => {
    const cache = createSelectionCache<number>();
    for (let i = 0; i < 60; i++) cache.set(`k${i}`, i);
    cache.set("k0", 999); // update, not insert → no eviction
    expect(cache.has("k0")).toBe(true);
    expect(cache.get("k0")).toBe(999);
    expect(cache.has("k1")).toBe(true);
  });
});
