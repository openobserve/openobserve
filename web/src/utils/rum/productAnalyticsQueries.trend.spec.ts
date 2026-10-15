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
  assertJoinFree,
  funnelSql,
  funnelTrendPanelSql,
  funnelTrendSql,
  type AnalyticsScope,
  type FunnelDef,
  type FunnelPair,
} from "@/utils/rum/productAnalyticsQueries";

const s: AnalyticsScope = {
  app: "web",
  env: [],
  version: [],
  schema: {
    action_target_name: true,
    usr_email: true,
    user_agent_user_agent_family: true,
    view_name: true,
  },
};
const id = { field: "usr_email" as const, excluded: [] };
const opts = { events: [], sample: 1 as const };
const steps = [
  { kind: "p" as const, key: "/shop" },
  { kind: "c" as const, key: "add-to-cart" },
  { kind: "p" as const, key: "/checkout" },
  { kind: "c" as const, key: "place-order" },
];
const DAY = 86_400_000_000;
const bounds = [0, 1, 2].map((i) => 1_791_417_600_000_000 + i * DAY);
const def = (patch: Partial<FunnelDef> = {}): FunnelDef => ({
  steps,
  unit: "sessions",
  window: "session",
  breakdown: null,
  ...patch,
});
const full: FunnelPair = { a: 1, b: 4 };

const ctesOf = (sql: string) => sql.slice(0, sql.lastIndexOf("\n"));
// Removes only what the trend adds, so the rest must equal the steps query's CTEs.
const withoutEntry = (sql: string, a: number) =>
  ctesOf(sql)
    .split(",\ntb AS (")[0]
    .split(", MIN(_timestamp) AS ts")
    .join("")
    .split(`, MIN(CASE WHEN r${a} = 1 THEN entry_ts END) AS entry_ts`)
    .join("")
    .split(`, MIN(CASE WHEN m${a} = 1 THEN ts END) AS entry_ts`)
    .join("")
    .split(", entry_ts")
    .join("")
    .split(", ts")
    .join("");

describe("funnelTrendSql (P0-9)", () => {
  it("Sessions buckets each session by its server-time entry into step 1", () => {
    const sql = funnelTrendSql(s, null, def(), bounds, full, opts);
    expect(sql).toContain("MIN(_timestamp) AS ts");
    expect(sql).toContain("MIN(CASE WHEN m1 = 1 THEN ts END) AS entry_ts");
    expect(sql).not.toContain("THEN t END) AS entry_ts");
    expect(sql.split("\n").at(-1)).toBe(
      `SELECT CASE WHEN entry_ts < ${bounds[1]} THEN 0 WHEN entry_ts < ${bounds[2]} THEN 1 ELSE 2 END AS bk, SUM(r1) AS ca, SUM(r4) AS cb FROM ps WHERE r1 = 1 GROUP BY bk ORDER BY bk LIMIT 3`,
    );
    expect(sql).toMatchSnapshot();
  });

  it("Users in the same session enter at their earliest session that reached step a", () => {
    const sql = funnelTrendSql(s, id, def({ unit: "users" }), bounds, { a: 2, b: 4 }, opts);
    expect(sql).toContain("MIN(CASE WHEN m2 = 1 THEN ts END) AS entry_ts");
    expect(sql).toContain("MIN(CASE WHEN r2 = 1 THEN entry_ts END) AS entry_ts");
    expect(sql.split("\n").at(-1)).toMatch(
      /SUM\(r2\) AS ca, SUM\(r4\) AS cb FROM pu WHERE anon = 0 AND r2 = 1 GROUP BY bk/,
    );
    expect(sql).toMatchSnapshot();
  });

  it("Users within 7 days carry the entry time through x2 into su and pu", () => {
    const sql = funnelTrendSql(s, id, def({ unit: "users", window: "7d" }), bounds, full, opts);
    expect(sql).toMatch(/x2 AS \(SELECT sid, t, ty, k, m1, m2, m3, m4, uid, ts FROM x1/);
    expect(sql).toMatch(/su AS \(SELECT .*MIN\(CASE WHEN m1 = 1 THEN ts END\) AS entry_ts FROM x2/);
    expect(sql).toMatch(/pu AS \(SELECT anon, .*, s1s, entry_ts FROM su\)/);
    expect(sql).toMatchSnapshot();
  });

  it("a breakdown keeps the top values by step-1 units and folds the rest, at buckets × (top + 1) rows", () => {
    const sql = funnelTrendSql(s, null, def({ breakdown: "browser" }), bounds, full, opts);
    expect(sql).toContain("DENSE_RANK() OVER (ORDER BY un, tot DESC, dim) AS rk");
    expect(sql).toContain("CASE WHEN un = 0 AND rk <= 5 THEN dim END AS gd");
    expect(sql.split("\n").at(-1)).toBe(
      "SELECT gd AS dim, MIN(un) AS un, bk, SUM(ca) AS ca, SUM(cb) AS cb FROM tg GROUP BY gd, bk ORDER BY bk, gd LIMIT 18",
    );
    expect(sql).toMatchSnapshot();
  });

  it("a pair other than step 1 → the last step reads its own reach columns", () => {
    const sql = funnelTrendSql(s, null, def(), bounds, { a: 2, b: 3 }, opts);
    expect(sql).toContain("MIN(CASE WHEN m2 = 1 THEN ts END) AS entry_ts");
    expect(sql.split("\n").at(-1)).toMatch(/SUM\(r2\) AS ca, SUM\(r3\) AS cb FROM ps WHERE r2 = 1/);
    expect(sql).toMatchSnapshot();
  });

  it("reads _rumdata once and stays join-free", () => {
    for (const d of [def(), def({ unit: "users", window: "1d", breakdown: "browser" })])
      expect(() => assertJoinFree(funnelTrendSql(s, id, d, bounds, full, opts))).not.toThrow();
  });

  it.each([
    ["sessions", def(), null],
    ["users / same session", def({ unit: "users" }), id],
    ["users / 7d", def({ unit: "users", window: "7d" }), id],
    ["breakdown", def({ breakdown: "browser" }), null],
    ["users breakdown", def({ unit: "users", breakdown: "browser" }), id],
  ] as const)(
    "%s: the trend only adds the entry time to the steps query's CTEs, which stay unchanged",
    (_, d, who) => {
      const steps = funnelSql(s, who, d, opts);
      expect(steps).not.toContain("entry_ts");
      expect(steps).not.toContain("AS ts");
      for (const a of [1, 2])
        expect(withoutEntry(funnelTrendSql(s, who, d, bounds, { a, b: 4 }, opts), a)).toBe(
          ctesOf(steps),
        );
    },
  );
});

describe("funnelTrendPanelSql (P0-9 dashboard line)", () => {
  it("buckets each session's entry time with histogram, so the dashboard's picker drives it", () => {
    const sql = funnelTrendPanelSql(
      s,
      def({ unit: "users", breakdown: "browser" }),
      full,
      "1 week",
      opts,
    );
    expect(sql.split("\n").at(-1)).toBe(
      "SELECT histogram(entry_ts, '1 week') AS x_axis_1, ROUND(100.0 * SUM(r4) / SUM(r1), 1) AS y_axis_1 FROM ps WHERE r1 = 1 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 1000",
    );
    expect(sql).not.toContain("CASE WHEN entry_ts <");
    expect(sql).not.toContain("dim");
    expect(() => assertJoinFree(sql)).not.toThrow();
  });
});
