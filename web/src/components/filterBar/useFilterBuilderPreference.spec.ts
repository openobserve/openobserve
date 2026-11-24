// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useFilterBuilderPreference } from "./useFilterBuilderPreference";

const KEY = "o2.test.queryInput";

describe("useFilterBuilderPreference", () => {
  afterEach(() => {
    localStorage.removeItem(KEY);
    vi.restoreAllMocks();
  });

  it("opens the query editor when nothing is remembered", () => {
    expect(useFilterBuilderPreference(KEY).builderOn.value).toBe(false);
  });

  it("opens the builder once the browser remembers it", () => {
    localStorage.setItem(KEY, "builder");
    expect(useFilterBuilderPreference(KEY).builderOn.value).toBe(true);
  });

  it("opens the query editor when the browser remembers it", () => {
    localStorage.setItem(KEY, "query");
    expect(useFilterBuilderPreference(KEY).builderOn.value).toBe(false);
  });

  it("remembers each toggle", async () => {
    const { toggle } = useFilterBuilderPreference(KEY);
    toggle();
    await nextTick();
    expect(localStorage.getItem(KEY)).toBe("builder");
    toggle();
    await nextTick();
    expect(localStorage.getItem(KEY)).toBe("query");
  });

  it("opens the query editor when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(useFilterBuilderPreference(KEY).builderOn.value).toBe(false);
  });
});
