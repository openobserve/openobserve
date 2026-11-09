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
import useHttpStreaming from "@/composables/useStreamingSearch";
import type { RcaEvidenceTarget } from "@/services/incidents";
import {
  RCA_RESULT_ROWS,
  foldPromqlFrame,
  foldSearchFrame,
  rcaEvidenceRunnable,
  rcaSeriesName,
} from "./useRcaEvidenceResult";

// Frames built by the streaming composable's own mapper from server payloads, as the handlers receive them.
const { wsMapper } = useHttpStreaming();
const hitsFrame = (hits: Record<string, unknown>[], total?: number) =>
  wsMapper.search_response_hits(
    "t1",
    { results: { hits, ...(total !== undefined && { total }) } },
    "search_response_hits",
  );
const promqlFrame = (result: unknown[]) =>
  wsMapper.promql_response("t1", { data: { result_type: "matrix", result } }, "promql_response");

const WINDOW = { start_us: 1, end_us: 2 };

describe("rcaEvidenceRunnable", () => {
  it.each<[string, RcaEvidenceTarget, "sql" | "promql" | null]>([
    ["logs SQL", { signal: "logs", streams: [], sql: "SELECT 1", ...WINDOW }, "sql"],
    ["traces SQL", { signal: "traces", streams: [], sql: "SELECT 1", ...WINDOW }, "sql"],
    ["PromQL", { signal: "metrics", streams: [], promql: "up", ...WINDOW }, "promql"],
    ["a command", { signal: "change", streams: [], command: "gh pr diff", ...WINDOW }, null],
    ["SQL with no window", { signal: "logs", streams: [], sql: "SELECT 1" }, null],
  ])("%s → %s", (_name, link, expected) => {
    expect(rcaEvidenceRunnable(link)).toBe(expected);
  });
});

describe("rcaSeriesName", () => {
  it("names a series the way Metrics does", () => {
    expect(rcaSeriesName({ __name__: "up", job: "api", code: "500" })).toBe(
      'up{code="500", job="api"}',
    );
    expect(rcaSeriesName({ __name__: "up" })).toBe("up");
    expect(rcaSeriesName({})).toBe("value");
  });
});

describe("foldSearchFrame", () => {
  it("keeps the first rows across chunks, every column, and the server's total", () => {
    const empty = { kind: "rows" as const, columns: [], rows: [], total: null };
    const first = foldSearchFrame(empty, hitsFrame([{ a: 1 }, { a: 2 }, { a: 3 }], 120));
    const second = foldSearchFrame(first, hitsFrame([{ a: 4, b: "x" }, { a: 5 }, { a: 6 }]));

    expect(second.rows).toHaveLength(RCA_RESULT_ROWS);
    expect(second.columns).toEqual(["a", "b"]);
    expect(second.total).toBe(120);
  });
});

describe("foldPromqlFrame", () => {
  it("merges matrix chunks per series, parses string values and drops NaN", () => {
    const empty = { kind: "series" as const, series: [] };
    const first = foldPromqlFrame(
      empty,
      promqlFrame([
        {
          metric: { __name__: "p95" },
          values: [
            [1, "812"],
            [2, "NaN"],
          ],
        },
      ]),
    );
    const second = foldPromqlFrame(
      first,
      promqlFrame([{ metric: { __name__: "p95" }, values: [[3, "905"]] }]),
    );

    expect(second.series).toEqual([{ name: "p95", points: [812, 905], latest: 905 }]);
  });
});
