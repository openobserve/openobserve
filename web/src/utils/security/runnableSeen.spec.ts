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

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadRunnableSeen,
  newlyRunnable,
  saveRunnableSeen,
  syncRunnableSeen,
} from "./runnableSeen";

beforeEach(() => localStorage.clear());

describe("runnableSeen", () => {
  it("counts nothing new on a stream's first sighting", () => {
    expect(newlyRunnable(undefined, ["a", "b"])).toEqual([]);
  });

  it("names the rules that became runnable since the stream was last seen", () => {
    expect(newlyRunnable(["a"], ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(newlyRunnable(["a", "b"], ["a"])).toEqual([]);
  });

  it("records a first sighting and keeps the old set while new rules wait for review", () => {
    const next = syncRunnableSeen(
      { okta: ["a"], ct: ["x"] },
      new Map([
        ["okta", ["a", "b"]],
        ["ct", ["x"]],
        ["linux", ["l"]],
      ]),
    );
    expect(next).toEqual({ okta: ["a"], ct: ["x"], linux: ["l"] });
  });

  it("follows a stream whose rules stopped running, so a return counts as new", () => {
    expect(syncRunnableSeen({ ct: ["x", "y"] }, new Map([["ct", ["x"]]]))).toEqual({ ct: ["x"] });
  });

  it("round-trips through storage per org and tolerates junk", () => {
    saveRunnableSeen("o1", { ct: ["x"] });
    expect(loadRunnableSeen("o1")).toEqual({ ct: ["x"] });
    expect(loadRunnableSeen("o2")).toEqual({});
    localStorage.setItem("oo_sec_runnable_seen_o3", "[1,2]");
    expect(loadRunnableSeen("o3")).toEqual({});
  });
});
