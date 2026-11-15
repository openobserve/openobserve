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
import { freshnessRows, noDataInRange } from "./overviewFreshness";

const START = 1_000_000;
const stream = (name: string, at?: number, type = "logs") => ({
  name,
  stream_type: type,
  stats: at === undefined ? {} : { doc_time_max: at },
});

describe("freshnessRows", () => {
  it("reads the newest record of each type and its stream", () => {
    const rows = freshnessRows(
      [
        [stream("old", START - 10), stream("new", START + 5)],
        [],
        [stream("t", START - 1, "traces")],
      ],
      START,
    );
    expect(rows).toEqual([
      { type: "logs", tone: "fresh", lastSeenUs: START + 5, stream: "new" },
      { type: "metrics", tone: "none", lastSeenUs: null, stream: null },
      { type: "traces", tone: "quiet", lastSeenUs: START - 1, stream: "t" },
    ]);
  });

  it("calls a stream with no record yet empty, and shows profiles only when they exist", () => {
    const rows = freshnessRows([[stream("idle")], [], [], [stream("p", START, "profiles")]], START);
    expect(rows[0]).toMatchObject({ tone: "empty", lastSeenUs: null, stream: "idle" });
    expect(rows.map((r) => r.type)).toEqual(["logs", "metrics", "traces", "profiles"]);
    expect(freshnessRows([[], [], [], []], START).map((r) => r.type)).toEqual([
      "logs",
      "metrics",
      "traces",
    ]);
  });

  it("leaves O2's own streams out, keeping the customer's underscore streams", () => {
    const rows = freshnessRows(
      [[stream("triggers", START), stream("_anomalies", START), stream("_rumlog", START - 1)]],
      START,
    );
    expect(rows[0]).toMatchObject({ tone: "quiet", stream: "_rumlog" });
  });

  it("leaves out a type whose list failed instead of calling it not set up", () => {
    const rows = freshnessRows([[stream("a", START)], undefined, []], START, [false, true, false]);
    expect(rows.map((r) => r.type)).toEqual(["logs", "traces"]);
  });
});

describe("noDataInRange", () => {
  it("is true only when the org has streams and none received data in the range", () => {
    expect(noDataInRange(freshnessRows([[stream("a", START - 1)]], START))).toBe(true);
    expect(noDataInRange(freshnessRows([[stream("a", START)]], START))).toBe(false);
    expect(noDataInRange(freshnessRows([[], [], []], START))).toBe(false);
  });
});
