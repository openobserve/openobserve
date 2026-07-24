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
  bucketizeHistogram,
  buildPatternVolumeContext,
  parseBucketKey,
  resolveBaseFilter,
} from "./usePatternVolume";

const usFor = (iso: string) => Date.parse(iso) * 1000;

/** The backend anchors histogram buckets here (`date_bin` origin). */
const DATE_BIN_ORIGIN_MS = Date.UTC(2001, 0, 1);

/** Index a bucket key must land on, derived from the backend's own grid. */
const expectedIndex = (key: string, startUs: number, intervalSecs: number) => {
  const bucketMs = intervalSecs * 1000;
  const gridStart =
    DATE_BIN_ORIGIN_MS + Math.floor((startUs / 1000 - DATE_BIN_ORIGIN_MS) / bucketMs) * bucketMs;
  return Math.floor((Date.parse(`${key}Z`) - gridStart) / bucketMs);
};

describe("parseBucketKey", () => {
  it("reads a naive backend key as UTC, not local time", () => {
    // The backend emits `2026-07-20T20:48:00` meaning UTC. `new Date()` would
    // treat a zone-less date-time as LOCAL, shifting the bucket by the
    // viewer's offset — which slid whole sparklines off their window.
    expect(parseBucketKey("2026-07-20T20:48:00")).toBe(Date.parse("2026-07-20T20:48:00Z"));
  });

  it("respects an explicit zone when the key carries one", () => {
    expect(parseBucketKey("2026-07-20T20:48:00Z")).toBe(Date.parse("2026-07-20T20:48:00Z"));
    expect(parseBucketKey("2026-07-20T20:48:00+02:00")).toBe(Date.parse("2026-07-20T18:48:00Z"));
  });

  it("passes numeric keys through and rejects junk", () => {
    expect(parseBucketKey(1_784_000_000_000)).toBe(1_784_000_000_000);
    expect(Number.isNaN(parseBucketKey(null))).toBe(true);
    expect(Number.isNaN(parseBucketKey("not-a-date"))).toBe(true);
  });
});

describe("bucketizeHistogram", () => {
  const start = usFor("2026-07-20T17:31:00Z");
  const end = usFor("2026-07-21T05:31:00Z"); // 12h window
  const interval = 24 * 60; // 24-minute buckets

  it("places a naive-UTC key in the correct bucket", () => {
    const key = "2026-07-20T20:48:00";
    const out = bucketizeHistogram([{ zo_key: key, zo_cnt: 14557 }], start, end, interval);
    // Lands on the backend's own bucket index, and nothing is lost.
    expect(out[expectedIndex(key, start, interval)]).toBe(14557);
    expect(out.reduce((a, b) => a + b, 0)).toBe(14557);
  });

  it("keeps quiet periods as real gaps", () => {
    // Two events far apart must NOT end up adjacent — the bug that made a
    // sparse histogram read as continuous activity.
    const out = bucketizeHistogram(
      [
        { zo_key: "2026-07-20T17:31:00", zo_cnt: 5 },
        { zo_key: "2026-07-21T05:10:00", zo_cnt: 7 },
      ],
      start,
      end,
      interval,
    );
    const filled = out.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    expect(filled).toHaveLength(2);
    // Far apart in time must stay far apart in the grid, with only zeros between.
    expect(filled[1] - filled[0]).toBeGreaterThan(25);
    expect(out[filled[0]]).toBe(5);
    expect(out[filled[1]]).toBe(7);
  });

  it("spans the window rather than collapsing to the end", () => {
    // Regression for the timezone shift: a real response whose activity sits
    // in the middle of the window must render in the middle, and every hit
    // must be retained.
    const hits = [
      { zo_key: "2026-07-20T20:48:00", zo_cnt: 14557 },
      { zo_key: "2026-07-20T21:12:00", zo_cnt: 23699 },
      { zo_key: "2026-07-20T21:36:00", zo_cnt: 37540 },
      { zo_key: "2026-07-20T22:00:00", zo_cnt: 39428 },
      { zo_key: "2026-07-21T01:36:00", zo_cnt: 12390 },
    ];
    const out = bucketizeHistogram(hits, start, end, interval);
    const total = hits.reduce((sum, h) => sum + h.zo_cnt, 0);

    expect(out.reduce((a, b) => a + b, 0)).toBe(total);
    const filled = out.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    expect(filled[0]).toBeGreaterThan(0);
    expect(filled[filled.length - 1]).toBeLessThan(out.length - 1);
  });

  it("aligns to the backend date_bin origin so adjacent buckets stay distinct", () => {
    // The backend anchors buckets at 2001-01-01, so for a 17:31 start with
    // 24-minute buckets its boundaries are 17:12, 17:36, ... A grid anchored at
    // the query start instead put BOTH 17:12 and 17:36 at index 0, merging two
    // real buckets into one bar.
    const out = bucketizeHistogram(
      [
        { zo_key: "2026-07-20T17:12:00", zo_cnt: 3 },
        { zo_key: "2026-07-20T17:36:00", zo_cnt: 9 },
      ],
      start,
      end,
      interval,
    );
    expect(out[0]).toBe(3);
    expect(out[1]).toBe(9);
  });

  it("keeps consecutive backend buckets one index apart", () => {
    const keys = [
      "2026-07-20T20:48:00",
      "2026-07-20T21:12:00",
      "2026-07-20T21:36:00",
      "2026-07-20T22:00:00",
    ];
    const out = bucketizeHistogram(
      keys.map((zo_key, i) => ({ zo_key, zo_cnt: i + 1 })),
      start,
      end,
      interval,
    );
    const filled = out.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    expect(filled).toHaveLength(keys.length);
    for (let i = 1; i < filled.length; i++) {
      expect(filled[i] - filled[i - 1]).toBe(1);
    }
  });

  it("returns an all-zero grid for no hits", () => {
    const out = bucketizeHistogram([], start, end, interval);
    // 12h window at 24-minute buckets, plus the partial bucket the grid starts in.
    expect(out.length).toBeGreaterThanOrEqual(30);
    expect(out.every((v) => v === 0)).toBe(true);
  });
});

describe("resolveBaseFilter", () => {
  it("returns an empty filter when the extraction had none", async () => {
    expect(await resolveBaseFilter(null)).toBe("");
    expect(await resolveBaseFilter('SELECT * FROM "logs"')).toBe("");
  });

  it("reuses a plain top-level WHERE", async () => {
    expect(await resolveBaseFilter("SELECT * FROM \"logs\" WHERE level = 'error'")).toBe(
      "level = 'error'",
    );
  });

  // The volume query is a fresh `SELECT ... FROM "<stream>"`, so a condition
  // qualified by an alias would reference something that doesn't exist there.
  // Reporting no volume beats reporting a number for the whole stream.
  it("refuses an aliased query it cannot reproduce", async () => {
    expect(
      await resolveBaseFilter("SELECT * FROM \"logs\" AS l WHERE l.level = 'error'"),
    ).toBeNull();
    expect(await resolveBaseFilter("SELECT * FROM logs l WHERE l.level = 'error'")).toBeNull();
  });

  it("refuses CTEs, joins and subqueries whose filters aren't top-level", async () => {
    expect(await resolveBaseFilter('WITH x AS (SELECT * FROM "logs") SELECT * FROM x')).toBeNull();
    expect(await resolveBaseFilter('SELECT * FROM "a" JOIN "b" ON a.id = b.id')).toBeNull();
    expect(await resolveBaseFilter('SELECT * FROM (SELECT * FROM "logs") WHERE x = 1')).toBeNull();
  });

  // A clause-keyword right after the table name must not be mistaken for an alias.
  it("does not mistake a following clause keyword for a table alias", async () => {
    expect(await resolveBaseFilter('SELECT * FROM "logs" WHERE a = 1')).toBe("a = 1");
    expect(await resolveBaseFilter('SELECT * FROM "logs" ORDER BY _timestamp')).toBe("");
  });
});

describe("buildPatternVolumeContext", () => {
  const window = { start: 1, end: 2 };

  it("returns null without a stream or window", () => {
    expect(buildPatternVolumeContext({ orgId: "o", window })).toBeNull();
    expect(buildPatternVolumeContext({ orgId: "o", streamName: "s", window: null })).toBeNull();
  });

  // Re-running with a relative range must re-query the NEW window. The caller's
  // window is a computed over `relativeTimePeriod`, which is identical between
  // runs, so it stays frozen at its first value — only the extraction request
  // carries the freshly-resolved times. Taking the window from there is what
  // makes a re-run actually refresh (a hard page refresh was the only cure).
  it("takes the window from the extraction request, not the stale caller window", () => {
    const frozen = { start: 1_000, end: 2_000 };
    const ctx = buildPatternVolumeContext({
      orgId: "o",
      streamName: "logs",
      window: frozen,
      lastQuery: { query: { sql: "SELECT * FROM logs", start_time: 5_000, end_time: 6_000 } },
    });
    expect(ctx).toMatchObject({ startUs: 5_000, endUs: 6_000 });
  });

  it("falls back to the caller window when the request has no times", () => {
    const ctx = buildPatternVolumeContext({
      orgId: "o",
      streamName: "logs",
      window: { start: 1_000, end: 2_000 },
      lastQuery: { query: { sql: "SELECT * FROM logs" } },
    });
    expect(ctx).toMatchObject({ startUs: 1_000, endUs: 2_000 });
  });

  // A VRL function or action can drop rows, and regions/clusters decide which
  // nodes answer — losing them would count a different population.
  it("carries the extraction request's full scope", () => {
    const ctx = buildPatternVolumeContext({
      orgId: "org",
      streamName: "logs",
      window,
      lastQuery: {
        query: { sql: "SELECT * FROM logs", query_fn: "vrl", action_id: "act" },
        regions: ["r1"],
        clusters: ["c1"],
      },
    });
    expect(ctx).toMatchObject({
      orgId: "org",
      streamName: "logs",
      startUs: 1,
      endUs: 2,
      baseSql: "SELECT * FROM logs",
      queryFn: "vrl",
      actionId: "act",
      regions: ["r1"],
      clusters: ["c1"],
    });
  });
});
