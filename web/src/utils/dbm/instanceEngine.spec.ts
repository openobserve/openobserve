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

import { describe, expect, it } from "vitest";

import type { DbmScopeFilter } from "@/components/dbm/DbmScopeFilters.vue";
import { raw } from "@/types/i18n";

import { applyInstanceEngine } from "./instanceEngine";

const f = (key: string, value: string | null): DbmScopeFilter => ({
  key,
  dimension: raw(key),
  value,
  placeholder: raw(key),
  options: [],
  onChange: () => {},
});
const hits = [{ db_system: "postgresql", db_instance: "pg-1" }];

describe("applyInstanceEngine", () => {
  it("shows the instance's engine and disables Engine", () => {
    const out = applyInstanceEngine([f("instance", "pg-1"), f("system", null)], hits, raw("why"));
    const system = out.find((x) => x.key === "system")!;
    expect(system.value).toBe("postgresql");
    expect(system.disabled).toBe(true);
    expect(system.disabledReason).toEqual(raw("why"));
    expect(out.find((x) => x.key === "instance")!.disabled).toBeUndefined();
  });

  it("leaves Engine enabled with no instance or an unknown one", () => {
    for (const inst of [null, "nope"]) {
      const out = applyInstanceEngine(
        [f("instance", inst), f("system", "mysql")],
        hits,
        raw("why"),
      );
      const system = out.find((x) => x.key === "system")!;
      expect(system.value).toBe("mysql");
      expect(system.disabled).toBeUndefined();
    }
  });
});
