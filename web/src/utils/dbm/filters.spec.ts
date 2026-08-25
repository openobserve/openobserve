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

import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { raw } from "@/types/i18n";

import { createDbmFilterEntry, optionsFrom } from "./filters";

describe("optionsFrom", () => {
  it("deduplicates and drops blanks", () => {
    expect(optionsFrom(["pg-1", "pg-2", "pg-1", undefined, ""])).toEqual([
      { value: "pg-1", label: "pg-1" },
      { value: "pg-2", label: "pg-2" },
    ]);
  });

  it("returns nothing for an all-blank response", () => {
    expect(optionsFrom([undefined, undefined])).toEqual([]);
  });
});

describe("createDbmFilterEntry", () => {
  const spec = (model = ref<string | null>(null)) => ({
    key: "system",
    dimension: raw("database"),
    placeholder: raw("All engines"),
    options: optionsFrom(["postgresql"]),
    model,
  });

  it("carries the entry's own content through unchanged", () => {
    const model = ref<string | null>("mysql");
    const entry = createDbmFilterEntry(() => {})(spec(model));
    expect(entry.key).toBe("system");
    expect(entry.dimension).toBe("database");
    expect(entry.placeholder).toBe("All engines");
    expect(entry.value).toBe("mysql");
    expect(entry.options).toEqual([{ value: "postgresql", label: "postgresql" }]);
  });

  /**
   * The reason the factory exists: every change must run the page's ONE
   * `syncUrl(); load();` pair. Eleven hand-written handlers is eleven chances
   * for one to drop the URL half and leave the route describing a different
   * table than the one on screen.
   */
  it("writes the ref and fires the page's apply on change", () => {
    const model = ref<string | null>(null);
    const apply = vi.fn();
    const entry = createDbmFilterEntry(apply)(spec(model));
    entry.onChange("postgresql");
    expect(model.value).toBe("postgresql");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  /** Clearing yields `null`, never `""` — the request layer treats only null
   *  and undefined as "no filter". */
  it("normalises a cleared selection to null", () => {
    const model = ref<string | null>("postgresql");
    const entry = createDbmFilterEntry(() => {})(spec(model));
    entry.onChange("");
    expect(model.value).toBeNull();
    entry.onChange(undefined);
    expect(model.value).toBeNull();
  });

  it("fires apply even when clearing", () => {
    const model = ref<string | null>("postgresql");
    const apply = vi.fn();
    createDbmFilterEntry(apply)(spec(model)).onChange("");
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
