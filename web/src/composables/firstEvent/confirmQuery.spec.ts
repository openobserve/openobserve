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
import {
  anchorSql,
  confirmSql,
  filterFields,
  firstRecordSql,
  ingestWindow,
  recordRange,
  sinceWindow,
} from "./confirmQuery";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 7, 10, 0, 0);
const cfg = { ingestAllowedUptoH: 5, ingestAllowedInFutureH: 24, maxQueryRangeH: 0 };

describe("ingestWindow", () => {
  it("spans the accepted ingest window plus an hour on both sides", () => {
    const w = ingestWindow(NOW, cfg);
    expect(w.startUs).toBe((NOW - 6 * HOUR) * 1000);
    expect(w.endUs).toBe((NOW + 25 * HOUR) * 1000);
  });

  it("covers a record stamped five hours ahead and one back-dated an hour", () => {
    const w = ingestWindow(NOW, cfg);
    const ahead = (NOW + 5 * HOUR) * 1000;
    const behind = (NOW - HOUR) * 1000;
    expect(ahead).toBeGreaterThanOrEqual(w.startUs);
    expect(ahead).toBeLessThanOrEqual(w.endUs);
    expect(behind).toBeGreaterThanOrEqual(w.startUs);
  });

  it("trims the future end before the start when max_query_range is narrower", () => {
    const w = ingestWindow(NOW, { ...cfg, maxQueryRangeH: 10 });
    expect(w.startUs).toBe((NOW - 6 * HOUR) * 1000);
    expect(w.endUs).toBe((NOW + 4 * HOUR) * 1000);
    expect(w.endUs - w.startUs).toBe(10 * HOUR * 1000);
  });

  it("raises the start only once the end is down to now plus one hour", () => {
    const w = ingestWindow(NOW, { ...cfg, maxQueryRangeH: 3 });
    expect(w.endUs).toBe((NOW + HOUR) * 1000);
    expect(w.startUs).toBe((NOW - 2 * HOUR) * 1000);
  });

  it("leaves a window already inside max_query_range alone", () => {
    expect(ingestWindow(NOW, { ...cfg, maxQueryRangeH: 48 })).toEqual(ingestWindow(NOW, cfg));
  });
});

describe("sinceWindow and recordRange", () => {
  it("starts at the server anchor and ends an hour past the elapsed time", () => {
    const zoNowUs = 1_791_386_116_000_000;
    expect(sinceWindow(zoNowUs, 60_000)).toEqual({
      startUs: zoNowUs,
      endUs: zoNowUs + (60_000 + HOUR) * 1000,
    });
  });

  it("is fifteen minutes either side of the record", () => {
    expect(recordRange(1_000_000_000_000)).toEqual({
      startUs: 1_000_000_000_000 - 900_000_000,
      endUs: 1_000_000_000_000 + 900_000_000,
    });
  });
});

describe("SQL builders", () => {
  it("counts and takes the earliest timestamp, filtered and anchored", () => {
    expect(confirmSql("default")).toBe(
      'SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min FROM "default"',
    );
    expect(confirmSql("default", "k8s_namespace_name IS NOT NULL", 1_791_386_116_000_000)).toBe(
      'SELECT COUNT(*) AS zo_count, MIN(_timestamp) AS zo_min FROM "default" WHERE (k8s_namespace_name IS NOT NULL) AND _timestamp >= 1791386116000000',
    );
  });

  it("escapes a quote in a user-typed stream name", () => {
    expect(confirmSql('a"b')).toContain('FROM "a""b"');
  });

  it("reads the server clock in the anchor", () => {
    expect(anchorSql("default")).toBe(
      'SELECT COUNT(*) AS zo_count, CAST(to_unixtime(now()) AS BIGINT) AS zo_now FROM "default"',
    );
  });

  it("fetches the earliest record from a point in time", () => {
    expect(firstRecordSql("default", 5, "type = 'view'")).toBe(
      "SELECT * FROM \"default\" WHERE (type = 'view') AND _timestamp >= 5 ORDER BY _timestamp ASC LIMIT 1",
    );
  });
});

describe("filterFields", () => {
  it("names the columns a detect filter reads, not its keywords or literals", () => {
    expect(filterFields("k8s_namespace_name IS NOT NULL")).toEqual(["k8s_namespace_name"]);
    expect(filterFields("type = 'view'")).toEqual(["type"]);
    expect(filterFields("gen_ai_system = 'Anthropic' AND level IN ('info', 'warn')")).toEqual([
      "gen_ai_system",
      "level",
    ]);
    expect(filterFields("\"service.name\" = 'api'")).toEqual(["service.name"]);
    expect(filterFields("")).toEqual([]);
    expect(filterFields(undefined)).toEqual([]);
  });
});
