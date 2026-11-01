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
import { assertJoinFree, scopeClause, type AnalyticsScope } from "./productAnalyticsQueries";
import {
  deviceClause,
  deviceSplitSql,
  pageListSql,
  rankingSql,
  selectorExpr,
  totalsSql,
} from "./clickHeatmapQueries";

const flags = (...names: string[]) => Object.fromEntries(names.map((n) => [n, true]));
const FULL = flags(
  "_o2_action_target",
  "action_type",
  "action_id",
  "action_target_name",
  "action_frustration_type",
  "display_viewport_width",
  "session_id",
);
const scope = (over: Partial<AnalyticsScope> = {}): AnalyticsScope => ({
  app: "shop",
  env: [],
  version: [],
  schema: FULL,
  ...over,
});
const BASE = "application_id = 'shop' AND session_id IS NOT NULL";
const CLICKS = "type = 'action' AND action_type = 'click'";
const URL = "view_url = '/pricing'";

describe("pageListSql", () => {
  it("counts distinct clicks per page, busiest first", () => {
    expect(pageListSql(scope())).toBe(
      `SELECT view_url, COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR))) AS clicks, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${BASE} AND ${CLICKS} AND view_url IS NOT NULL AND view_url <> '' GROUP BY view_url ORDER BY clicks DESC, view_url ASC LIMIT 50`,
    );
  });

  it("filters by a lowercased substring of the URL when given a term", () => {
    expect(pageListSql(scope(), "  Pric ")).toBe(
      `SELECT view_url, COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR))) AS clicks, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${BASE} AND ${CLICKS} AND view_url IS NOT NULL AND view_url <> '' AND strpos(lower(view_url), 'pric') > 0 GROUP BY view_url ORDER BY clicks DESC, view_url ASC LIMIT 50`,
    );
  });

  it("ignores a blank term", () => {
    expect(pageListSql(scope(), "   ")).toBe(pageListSql(scope()));
  });

  it("doubles quotes and leaves LIKE wildcards literal in the term", () => {
    expect(pageListSql(scope(), "o'x")).toContain("strpos(lower(view_url), 'o''x') > 0");
    expect(pageListSql(scope(), "50%_off")).toContain("strpos(lower(view_url), '50%_off') > 0");
  });

  it("reuses the product analytics app filter and bot exclusion", () => {
    const sc = scope({
      schema: { ...FULL, user_agent_user_agent_family: true, env: true },
      env: ["prod"],
      exclusions: {
        bots: true,
        builtinBots: { families: ["Googlebot"], devices: [] },
        sessions: [],
        pages: [],
      },
    });
    const sql = pageListSql(sc);
    expect(sql).toContain(scopeClause(sc));
    expect(sql).toContain("user_agent_user_agent_family NOT IN ('Googlebot')");
    expect(sql).toContain("env IN ('prod')");
  });

  it("skips the click type filter on streams without action_type", () => {
    const { action_type: _t, ...schema } = FULL;
    expect(pageListSql(scope({ schema }))).not.toContain("action_type");
  });
});

describe("deviceSplitSql", () => {
  it("buckets by viewport width and keeps unknown widths apart", () => {
    expect(deviceSplitSql(scope(), "/pricing")).toBe(
      `SELECT CASE WHEN display_viewport_width >= 1024 THEN 'desktop' WHEN display_viewport_width >= 768 THEN 'tablet' WHEN display_viewport_width > 0 THEN 'phone' ELSE 'unknown' END AS cls, COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR))) AS clicks FROM "_rumdata" WHERE ${BASE} AND ${CLICKS} AND ${URL} GROUP BY cls ORDER BY cls ASC`,
    );
  });

  it("sends every click to unknown when the stream has no width column", () => {
    const { display_viewport_width: _w, ...schema } = FULL;
    expect(deviceSplitSql(scope({ schema }), "/pricing")).toContain(
      "WHEN CAST(NULL AS BIGINT) >= 1024",
    );
  });

  it("escapes quotes in the page url", () => {
    expect(deviceSplitSql(scope(), "/o'neil")).toContain("view_url = '/o''neil'");
  });
});

describe("deviceClause", () => {
  it("cuts phone below 768, tablet 768 to 1023 and desktop from 1024", () => {
    const sc = scope();
    expect(deviceClause(sc, "all")).toBe("");
    expect(deviceClause(sc, "phone")).toBe(
      " AND display_viewport_width > 0 AND display_viewport_width < 768",
    );
    expect(deviceClause(sc, "tablet")).toBe(
      " AND display_viewport_width >= 768 AND display_viewport_width < 1024",
    );
    expect(deviceClause(sc, "desktop")).toBe(" AND display_viewport_width >= 1024");
  });

  it("matches nothing when the width column is missing", () => {
    expect(deviceClause(scope({ schema: {} }), "phone")).toBe(" AND 1 = 0");
  });
});

describe("totalsSql", () => {
  it("counts distinct clicks, sessions and frustrated clicks once each", () => {
    expect(totalsSql(scope(), "/pricing", "all")).toBe(
      `SELECT COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR))) AS clicks, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT CASE WHEN action_frustration_type IS NOT NULL AND action_frustration_type NOT IN ('', '[]') THEN COALESCE(action_id, CAST(date AS VARCHAR)) END) AS frustrated FROM "_rumdata" WHERE ${BASE} AND ${CLICKS} AND ${URL}`,
    );
  });

  it("applies the device class", () => {
    expect(totalsSql(scope(), "/pricing", "tablet")).toContain(
      `${URL} AND display_viewport_width >= 768 AND display_viewport_width < 1024`,
    );
  });

  it("reports zero frustrated clicks when the column is missing", () => {
    const { action_frustration_type: _f, ...schema } = FULL;
    expect(totalsSql(scope({ schema }), "/pricing", "all")).toContain("0 AS frustrated");
  });
});

describe("rankingSql", () => {
  it("groups by the selector in the target JSON with a stable tie-break order", () => {
    const sql = rankingSql(scope(), "/pricing", "desktop") as string;
    expect(sql).toBe(
      `SELECT json_get_str(_o2_action_target, 'selector') AS selector, MAX(action_target_name) AS name, COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR))) AS clicks, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT CASE WHEN action_frustration_type LIKE '%rage_click%' THEN COALESCE(action_id, CAST(date AS VARCHAR)) END) AS rage, COUNT(DISTINCT CASE WHEN action_frustration_type LIKE '%dead_click%' THEN COALESCE(action_id, CAST(date AS VARCHAR)) END) AS dead, COUNT(DISTINCT CASE WHEN action_frustration_type LIKE '%error_click%' THEN COALESCE(action_id, CAST(date AS VARCHAR)) END) AS err, COUNT(DISTINCT CASE WHEN action_frustration_type IS NOT NULL AND action_frustration_type NOT IN ('', '[]') THEN COALESCE(action_id, CAST(date AS VARCHAR)) END) AS frustrated FROM "_rumdata" WHERE ${BASE} AND ${CLICKS} AND ${URL} AND display_viewport_width >= 1024 AND json_get_str(_o2_action_target, 'selector') IS NOT NULL GROUP BY selector ORDER BY clicks DESC, sessions DESC, selector ASC LIMIT 500`,
    );
    expect(() => assertJoinFree(sql)).not.toThrow();
  });

  it("counts a rage and dead click once in each split and once in the total", () => {
    const sql = rankingSql(scope(), "/pricing", "all") as string;
    expect(sql.match(/COUNT\(DISTINCT CASE WHEN/g)).toHaveLength(4);
    expect(sql).toContain("COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR))) AS clicks");
  });

  it("falls back to the legacy flat selector column", () => {
    const { _o2_action_target: _t, ...rest } = FULL;
    const sc = scope({
      schema: { ...rest, _oo_action_target_selector: true, _o2_action_target_selector: true },
    });
    expect(selectorExpr(sc)).toBe(
      "COALESCE(_o2_action_target_selector, _oo_action_target_selector)",
    );
    expect(rankingSql(sc, "/pricing", "all")).toContain(
      "COALESCE(_o2_action_target_selector, _oo_action_target_selector) AS selector",
    );
  });

  it("is null when the stream records no click target", () => {
    expect(rankingSql(scope({ schema: {} }), "/pricing", "all")).toBeNull();
  });

  it("zeroes the frustration split without the frustration column", () => {
    const { action_frustration_type: _f, ...schema } = FULL;
    const sql = rankingSql(scope({ schema }), "/pricing", "all") as string;
    expect(sql).toContain("0 AS rage, 0 AS dead, 0 AS err, 0 AS frustrated");
  });
});

describe("request shape", () => {
  it("never selects raw click rows", () => {
    for (const sql of [
      pageListSql(scope()),
      deviceSplitSql(scope(), "/p"),
      totalsSql(scope(), "/p", "all"),
      rankingSql(scope(), "/p", "all") as string,
    ]) {
      expect(sql).toContain("COUNT(DISTINCT COALESCE(action_id, CAST(date AS VARCHAR)))");
      expect(sql).not.toMatch(/SELECT\s+\*/);
      expect(() => assertJoinFree(sql)).not.toThrow();
    }
  });
});

describe("identity exclusions", () => {
  const sc = scope({
    schema: { ...FULL, usr_email: true },
    exclusions: {
      bots: false,
      builtinBots: { families: [], devices: [] },
      sessions: [{ field: "usr_email", op: "eq", values: ["qa@x.com"] }],
      pages: [],
    },
  });
  const RULE = "usr_email IS NULL OR usr_email <> 'qa@x.com'";

  it("reaches the page list, totals and ranking", () => {
    expect(pageListSql(sc)).toContain(RULE);
    expect(totalsSql(sc, "/pricing", "all")).toContain(RULE);
    expect(rankingSql(sc, "/pricing", "all")).toContain(RULE);
  });
});

describe("streams without action_id", () => {
  const { action_id: _a, ...schema } = FULL;
  const bare = scope({ schema });

  it("keys distinct clicks on the timestamp in every query", () => {
    const sqls = [
      pageListSql(bare),
      deviceSplitSql(bare, "/pricing"),
      totalsSql(bare, "/pricing", "all"),
      rankingSql(bare, "/pricing", "all") as string,
    ];
    for (const sql of sqls) {
      expect(sql).not.toContain("action_id");
      expect(sql).toContain("COUNT(DISTINCT _timestamp)");
    }
    expect(sqls[3]).toContain("THEN _timestamp END");
  });
});
