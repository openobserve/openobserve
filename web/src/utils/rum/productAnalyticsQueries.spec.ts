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
  CLICK_KEY_PASSES,
  PAGE_KEY_PASSES,
  activeUsersSql,
  appProbeSql,
  assertJoinFree,
  branchSessionsSql,
  pathsSql,
  clickPagesSql,
  clicksSql,
  pagesSql,
  retentionCellUsersSql,
  retentionSql,
  trendSql,
  cohortSessionsSql,
  dropoffHealthSql,
  dropoffNextSql,
  entryExitSql,
  featuresSql,
  sessionEventsProbeSql,
  funnelAlertSql,
  funnelPanelSql,
  funnelSql,
  nextStepsSql,
  stepPickerSql,
  facetOptionsSql,
  identityTopSql,
  summarySql,
  clickKeyExpr,
  identityExpr,
  pageKeyExpr,
  scopeClause,
  stepPredicateGrouped,
  stepPredicateRaw,
  urlPrefilter,
  type AnalyticsScope,
  type RegexPass,
} from "@/utils/rum/productAnalyticsQueries";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import * as PROVEN from "@/utils/rum/__fixtures__/productAnalyticsProvenSql";
import * as QUERIES from "@/utils/rum/productAnalyticsQueries";
import * as SEQ from "@/utils/rum/__fixtures__/productAnalyticsSequenceSql";

// JS port of the SQL regexp_replace passes: same patterns, Rust `\N` groups become `$N`.
const applyPasses = (input: string, passes: readonly RegexPass[]): string =>
  passes.reduce(
    (x, p) =>
      x.replace(
        new RegExp(p.pattern, p.global ? "g" : ""),
        p.replacement.replace(/\\(\d)/g, "$$$1"),
      ),
    input,
  );

const jsPageKey = (
  url: string | null,
  viewName: string | null,
  schema: Record<string, boolean>,
) => {
  if (url === null || url === "") return schema.view_name ? viewName || null : null;
  return applyPasses(url, PAGE_KEY_PASSES) || "/";
};

const jsPrefilter = (key: string, url: string | null): boolean => {
  const sql = urlPrefilter(key, "url");
  if (sql === "TRUE") return true;
  if (sql.startsWith("(url IS NULL OR url = '' OR regexp_like")) {
    return !url || /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*\/?(?:[?#].*)?$/.test(url);
  }
  if (sql === "(url IS NULL OR url = '')") return !url;
  const parts = [...sql.matchAll(/strpos\(url, '((?:[^']|'')*)'\) > 0/g)].map((m) =>
    m[1].replace(/''/g, "'"),
  );
  return parts.every((p) => (url ?? "").includes(p));
};

const KEY_TABLE: [string, string | null, Record<string, boolean>, string | null][] = [
  [
    "https://cloud.example.com/web/cb#id_token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
    null,
    {},
    "/web/cb",
  ],
  ["https://app.example.com/#/orders/12345?tab=items", null, {}, "/#/orders/:id"],
  ["https://app.example.com/#!/signup", null, {}, "/#/signup"],
  ["https://app.example.com/#/", null, {}, "/"],
  ["https://app.example.com/users/ana%40example.com/edit", null, {}, "/users/:id/edit"],
  ["https://app.example.com/r/abc%2Bdef%2Fghi%3D0123456", null, {}, "/r/:id"],
  [
    "https://x.com/blog/top-10-open-source-monitoring-tools",
    null,
    {},
    "/blog/top-10-open-source-monitoring-tools",
  ],
  ["https://x.com/assets/logs_settings_6c3984ca0a.png", null, {}, "/assets/:id"],
  ["https://x.com/a/123/456/x", null, {}, "/a/:id/:id/x"],
  ["https://x.com/downloads//", null, {}, "/downloads"],
  ["", "ProductDetail", { view_name: true }, "ProductDetail"],
  ["", "ProductDetail", {}, null],
];

const PROVEN_CK = String.raw`regexp_replace(regexp_replace(regexp_replace(regexp_replace(action_target_name, '[^\s]*(?:@|%40)[^\s]*', ':email', 'g'), 'eyJ[A-Za-z0-9_=-]+(?:\.[A-Za-z0-9_=-]+)*', ':token', 'g'), '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{16,}', ':id', 'g'), '[0-9]{6,}', ':num', 'g')`;

const CS = 1790000000000000;

// Keys must be idempotent, PK(PK(x)) = PK(x), so the last pass strips every trailing slash, not one.
const amendPk = (proven: string): string =>
  proven.split(String.raw`'(.)/$', '\1'`).join(String.raw`'(.)/+$', '\1'`);

const norm = (sql: string, s: AnalyticsScope, sample: 1 | 2 | 4 | 8 | 16 = 1): string => {
  let out = sql.split(scopeClause(s, sample)).join("{scope}");
  for (const col of ["view_url", "url", "fu", "lu"])
    out = out.split(pageKeyExpr(col, s.schema)).join(`{PK(${col})}`);
  for (const col of ["action_target_name", "atn"])
    out = out.split(clickKeyExpr(col)).join(`{CK(${col})}`);
  return out.split(String(CS)).join("{cs}");
};

const scope = (patch: Partial<AnalyticsScope> = {}): AnalyticsScope => ({
  app: "web",
  env: [],
  version: [],
  schema: {},
  ...patch,
});

describe("page key (AC-4, AC-7)", () => {
  it.each(KEY_TABLE)("%s -> %s", (url, viewName, schema, expected) => {
    expect(jsPageKey(url, viewName, schema)).toBe(expected);
  });

  it("emits the proven PK expression verbatim", () => {
    const proven = PROVEN.Q6_ENTRY_EXIT_IDENTITY.slice(
      PROVEN.Q6_ENTRY_EXIT_IDENTITY.indexOf("make_array(") + "make_array(".length,
      PROVEN.Q6_ENTRY_EXIT_IDENTITY.indexOf(", CASE WHEN lu IS NULL"),
    );
    expect(pageKeyExpr("fu", {})).toBe(amendPk(proven));
  });

  it.each(KEY_TABLE.filter((r) => r[0] !== ""))("is idempotent for %s", (url, viewName, schema) => {
    const key = jsPageKey(url, viewName, schema) ?? "";
    expect(jsPageKey(key, null, schema)).toBe(key);
    expect(jsPageKey(`https://h${key}`, null, schema)).toBe(key);
  });

  it("falls back to view_name only when the schema has it", () => {
    expect(pageKeyExpr("url", { view_name: true })).toContain("THEN NULLIF(view_name, '') ELSE");
    expect(pageKeyExpr("url", {})).not.toContain("view_name");
    expect(pageKeyExpr("url", {})).toContain("THEN CAST(NULL AS VARCHAR) ELSE");
  });

  it("never renders a query string, a non-route hash or a token", () => {
    for (const [url, viewName, schema] of KEY_TABLE) {
      const key = jsPageKey(url, viewName, schema) ?? "";
      expect(key).not.toMatch(/\?|@|%40|eyJ/);
      expect(key.replace(/^\/?#\//, "")).not.toContain("#");
    }
  });
});

describe("url prefilter", () => {
  it.each(KEY_TABLE.filter((r) => r[3] !== null))(
    "keeps every URL that templates to its key: %s",
    (url, viewName, schema, key) => {
      expect(jsPrefilter(key as string, url)).toBe(true);
      expect(jsPageKey(url, viewName, schema)).toBe(key);
    },
  );

  it("splits literal parts on :id and the route hash", () => {
    expect(urlPrefilter("/users/:id/edit", "view_url")).toBe(
      "(strpos(view_url, '/users/') > 0 AND strpos(view_url, '/edit') > 0)",
    );
    expect(urlPrefilter("/", "url")).toBe(
      "(url IS NULL OR url = '' OR regexp_like(url, '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*/?(?:[?#].*)?$'))",
    );
    expect(urlPrefilter("ProductDetail", "url")).toBe("(url IS NULL OR url = '')");
    expect(urlPrefilter("/:id", "url")).toBe("TRUE");
    expect(urlPrefilter("/it's", "url")).toBe("(strpos(url, '/it''s') > 0)");
  });

  it("rejects URLs that lack a literal part", () => {
    expect(jsPrefilter("/users/:id/edit", "https://a.com/users/1/view")).toBe(false);
  });
});

describe("click key (AC-43)", () => {
  it.each([
    ["Contact ana@example.com", "Contact :email"],
    ["Order 12345678", "Order :num"],
    ["row-3fa85f64-5717-4562-b3fc-2c963f66afa6", "row-:id"],
    ["menu-link-/logs-item", "menu-link-/logs-item"],
    ["Self Hosted", "Self Hosted"],
    ["Open eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0 link", "Open :token link"],
    ["mail ana%40example.com", "mail :email"],
  ])("%s -> %s", (raw, expected) => {
    expect(applyPasses(raw, CLICK_KEY_PASSES)).toBe(expected);
  });

  it("emits the proven CK expression verbatim", () => {
    expect(clickKeyExpr("action_target_name")).toBe(PROVEN_CK);
  });
});

describe("identity expression (AC-50)", () => {
  it("is a plain NULLIF with nothing excluded", () => {
    expect(identityExpr({ field: "usr_email", excluded: [] })).toBe("NULLIF(usr_email, '')");
  });

  it("nulls excluded values through sqlLiteral", () => {
    expect(identityExpr({ field: "usr_email", excluded: ["bot@x.com", "o'neil"] })).toBe(
      "CASE WHEN NULLIF(usr_email, '') IN ('bot@x.com', 'o''neil') THEN NULL ELSE NULLIF(usr_email, '') END",
    );
  });

  it("refuses a field outside IDENTITY_FIELDS", () => {
    expect(() => identityExpr({ field: "usr_name" as never, excluded: [] })).toThrow();
  });
});

describe("scope clause (AC-37, AC-54, AC-52)", () => {
  it("is app plus non-null session", () => {
    expect(scopeClause(scope())).toBe("application_id = 'web' AND session_id IS NOT NULL");
  });

  it("adds env, version and the synthetics exclusion only when present", () => {
    const s = scope({
      env: ["prod"],
      version: ["1.0", "2'0"],
      schema: { env: true, version: true, session_type: true },
    });
    expect(scopeClause(s)).toBe(
      "application_id = 'web' AND session_id IS NOT NULL AND env IN ('prod') AND version IN ('1.0','2''0') AND (session_type IS NULL OR session_type <> 'synthetics')",
    );
    expect(scopeClause(scope({ env: ["prod"] }))).not.toContain("env IN");
  });

  it("samples 16/r hex characters of md5(session_id)", () => {
    expect(scopeClause(scope(), 4)).toBe(
      "application_id = 'web' AND session_id IS NOT NULL AND substr(md5(session_id), 1, 1) IN ('0', '1', '2', '3')",
    );
    expect(scopeClause(scope(), 16)).toContain("IN ('0')");
    expect(scopeClause(scope(), 1)).not.toContain("md5");
  });

  it("escapes a quote in the app id (AC-14)", () => {
    expect(scopeClause(scope({ app: "a'b" }))).toContain("application_id = 'a''b'");
  });
});

describe("step predicates (AC-3, AC-14, AC-45)", () => {
  const events: NamedEvent[] = [
    {
      id: "ev1",
      app: "web",
      name: "Logs",
      rules: [
        { t: "view", op: "eq", value: "/web/logs" },
        { t: "view", op: "prefix", value: "/web/dash" },
        { t: "view", op: "regex", value: "^/web/(a|b)$" },
        { t: "action", targets: ["save", "o'k"], onPage: "/web" },
      ],
      version: 1,
      createdBy: "",
      createdAt: 0,
      updatedBy: "",
      updatedAt: 0,
    },
  ];

  it("page raw predicate is prefilter plus PK equality", () => {
    expect(stepPredicateRaw({ kind: "p", key: "/web" }, scope(), [])).toBe(
      `(type = 'view' AND (strpos(view_url, '/web') > 0) AND ${pageKeyExpr("view_url", {})} = '/web')`,
    );
  });

  it("click raw predicate excludes empty names and goes through CK", () => {
    expect(stepPredicateRaw({ kind: "c", key: "it's" }, scope(), [])).toBe(
      `(type = 'action' AND action_target_name <> '' AND ${PROVEN_CK} = 'it''s')`,
    );
  });

  it("grouped predicates compare the grouped key", () => {
    expect(stepPredicateGrouped({ kind: "p", key: "/web" }, scope(), [])).toBe(
      "ty = 'view' AND k = '/web'",
    );
    expect(stepPredicateGrouped({ kind: "c", key: "x" }, scope(), [])).toBe(
      "ty = 'action' AND k = 'x'",
    );
  });

  it("a named event is the OR of its rules", () => {
    const g = stepPredicateGrouped({ kind: "e", key: "ev1" }, scope(), events);
    expect(g).toBe(
      `((ty = 'view' AND k = '/web/logs') OR (ty = 'view' AND starts_with(k, '/web/dash')) OR (ty = 'view' AND regexp_like(k, '^/web/(a|b)$')) OR (ty = 'action' AND k IN ('save', 'o''k') AND ${pageKeyExpr("url", {})} = '/web'))`,
    );
    const r = stepPredicateRaw({ kind: "e", key: "ev1" }, scope(), events);
    expect(r).toContain(`starts_with(${pageKeyExpr("view_url", {})}, '/web/dash')`);
    expect(r).toContain(
      `${PROVEN_CK} IN ('save', 'o''k') AND ${pageKeyExpr("view_url", {})} = '/web'`,
    );
  });

  it("a deleted named event matches nothing", () => {
    expect(stepPredicateGrouped({ kind: "e", key: "gone" }, scope(), events)).toBe("1 = 0");
    expect(stepPredicateRaw({ kind: "e", key: "gone" }, scope(), events)).toBe("(1 = 0)");
  });
});

describe("assertJoinFree (AC-55)", () => {
  it("accepts one scan with windows", () => {
    expect(() =>
      assertJoinFree("WITH a AS (SELECT * FROM \"_rumdata\" WHERE x = 'JOIN us') SELECT * FROM a"),
    ).not.toThrow();
  });

  it.each([
    'SELECT * FROM "_rumdata" a JOIN b ON a.x = b.x',
    'SELECT * FROM "_rumdata" WHERE session_id IN (SELECT sid FROM t)',
    'SELECT * FROM "_rumdata" WHERE EXISTS (SELECT 1)',
    'SELECT 1 FROM "_rumdata" UNION ALL SELECT 2',
    'SELECT 1 FROM "_rumdata" x, (SELECT 1 FROM "_rumdata") y',
    "SELECT 1 FROM t",
  ])("rejects %s", (sql) => {
    expect(() => assertJoinFree(sql)).toThrow();
  });
});

describe("scope-load builders (G2)", () => {
  const s = scope({ schema: { usr_email: true, session_type: true, env: true } });

  it("Q1 appProbe lists apps by sessions", () => {
    expect(appProbeSql()).toBe(
      `SELECT application_id AS app, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE application_id IS NOT NULL AND application_id <> '' AND session_id IS NOT NULL GROUP BY application_id ORDER BY sessions DESC LIMIT 100`,
    );
  });

  it("Q2 facetOptions reads env or version for the app", () => {
    expect(facetOptionsSql(s, "env")).toBe(
      `SELECT env AS value, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE application_id = 'web' AND session_id IS NOT NULL AND env IS NOT NULL AND env <> '' GROUP BY env ORDER BY sessions DESC LIMIT 100`,
    );
  });

  it("Q3 summary equals the proven shape and keeps synthetic sessions countable", () => {
    const sql = summarySql(s, CS);
    const unscoped = "application_id = 'web' AND session_id IS NOT NULL";
    expect(sql.split(unscoped).join("{scope}").split(String(CS)).join("{cs}")).toBe(
      PROVEN.Q3_SUMMARY,
    );
    expect(sql).not.toContain("<> 'synthetics'");
  });

  it("Q3 without session_type or candidates reports zero synthetics and no identity pairs", () => {
    const sql = summarySql(scope(), CS);
    expect(sql).toContain("0 AS synthetic_sessions");
    expect(sql).not.toContain("__values");
  });

  it("Q3 keeps env and version filters", () => {
    const sql = summarySql({ ...s, env: ["prod"] }, CS);
    expect(sql).toContain(
      "WHERE application_id = 'web' AND session_id IS NOT NULL AND env IN ('prod') LIMIT 1",
    );
  });

  it("Q3b identityTop returns the top 3 values with totals", () => {
    expect(identityTopSql(s, "usr_email")).toBe(
      `WITH v AS (SELECT NULLIF(usr_email, '') AS u, COUNT(DISTINCT session_id) AS s FROM "_rumdata" WHERE ${scopeClause(s)} AND type IN ('view','action') AND NULLIF(usr_email, '') IS NOT NULL GROUP BY NULLIF(usr_email, '')),\nr AS (SELECT u, s, SUM(s) OVER () AS total_s, COUNT(*) OVER () AS n_values FROM v)\nSELECT u, s, total_s, n_values FROM r ORDER BY s DESC, u LIMIT 3`,
    );
  });

  it("Q1 to Q3b are join-free (AC-55)", () => {
    for (const sql of [
      appProbeSql(),
      facetOptionsSql(s, "version"),
      summarySql(s, CS),
      identityTopSql(s, "usr_email"),
    ]) {
      expect(() => assertJoinFree(sql)).not.toThrow();
    }
  });
});

describe("entry/exit and step picker builders (G3, G4)", () => {
  const s = scope({ schema: { usr_email: true } });
  const id = { field: "usr_email" as const, excluded: [] };

  it("Q6 entryExit equals the proven shape plus the key tie-break, one row per session", () => {
    // One session is one entry, in its first view's window, and one exit, in its last view's window.
    const expected = amendPk(PROVEN.Q6_ENTRY_EXIT_IDENTITY)
      .replace(
        "CASE WHEN _timestamp >= {cs} THEN 1 ELSE 0 END AS cur,",
        "CASE WHEN MIN(CASE WHEN type = 'view' THEN _timestamp END) >= {cs} THEN 1 ELSE 0 END AS ce, CASE WHEN MAX(CASE WHEN type = 'view' THEN _timestamp END) >= {cs} THEN 1 ELSE 0 END AS cx,",
      )
      .replace(
        "s1 AS (SELECT sid, cur, u, unnest(",
        "s1 AS (SELECT sid, u, unnest(make_array(ce, cx)) AS cur, unnest(",
      )
      .replace(
        "GROUP BY session_id, CASE WHEN _timestamp >= {cs} THEN 1 ELSE 0 END)",
        "GROUP BY session_id)",
      )
      .replace("ORDER BY rank_key DESC LIMIT 1000", "ORDER BY rank_key DESC, k LIMIT 1000");
    expect(norm(entryExitSql(s, CS, id), s)).toBe(norm(expected, s));
  });

  it("Q6 without identity drops the users columns", () => {
    const sql = entryExitSql(s, CS, null);
    expect(sql).not.toContain("users");
    expect(sql).not.toContain("usr_email");
    expect(sql).toContain(`WHERE ${scopeClause(s)} AND (type = 'view') GROUP BY session_id`);
  });

  it("Q9 stepPicker equals the proven shape with the design tie-break and term limit", () => {
    const expected = PROVEN.Q9_STEP_PICKER.replace(
      "ORDER BY sessions DESC LIMIT 200",
      "ORDER BY sessions DESC, kind, k LIMIT 50",
    );
    expect(norm(stepPickerSql(s, "Dash"), s)).toBe(expected);
    expect(stepPickerSql(s)).not.toContain("strpos(lower(k)");
    expect(stepPickerSql(s)).toContain("ORDER BY sessions DESC, kind, k LIMIT 200");
  });
});

describe("overview builders (G3)", () => {
  const s = scope({ schema: { usr_email: true } });
  const id = { field: "usr_email" as const, excluded: [] };

  it("Q4 pages equals the proven shape plus the key tie-break (AC-2)", () => {
    const expected = PROVEN.Q4_PAGES_IDENTITY.replace(
      "ORDER BY rank_key DESC LIMIT 500",
      "ORDER BY rank_key DESC, k LIMIT 500",
    );
    expect(norm(pagesSql(s, CS, id), s)).toBe(expected);
  });

  it("Q4 without identity drops u0, ut, the OR term, the window and the users columns", () => {
    const sql = pagesSql(s, CS, null);
    expect(sql).not.toMatch(/u0|ut|usr_email|users/);
    expect(sql).toContain(`AND (type = 'view') GROUP BY session_id`);
    expect(sql).toContain("v1 AS (SELECT sid, ty, cur, vid, url FROM v0)");
  });

  it("Q5 clicks equals the proven shape plus the key tie-break (AC-2, AC-3)", () => {
    const expected = PROVEN.Q5_CLICKS_IDENTITY.replace(
      "ORDER BY rank_key DESC LIMIT 500",
      "ORDER BY rank_key DESC, k LIMIT 500",
    );
    expect(norm(clicksSql(s, CS, id), s)).toBe(expected);
    expect(clicksSql(s, CS, null)).not.toContain("users");
  });

  it("Q5b clickPages equals the proven shape with the design order (AC-57)", () => {
    const expected = PROVEN.Q5B_CLICK_PAGES.replace(
      "ORDER BY sessions DESC LIMIT 2000",
      "ORDER BY sessions DESC, k, pg LIMIT 2000",
    );
    expect(norm(clickPagesSql(s, CS, ["k1", "k2"]), s)).toBe(expected);
  });

  it("Q21 app trend equals the proven shape with users", () => {
    expect(norm(trendSql(s, id, "1 day", "Asia/Kolkata", [], []), s)).toBe(PROVEN.Q21_TREND_APP);
    expect(trendSql(s, null, "1 week", "UTC", [], [])).not.toContain("y_axis_2");
  });

  it("Q21 selected trend equals the proven shape (AC-48)", () => {
    const series = [
      { kind: "p" as const, key: "/web" },
      { kind: "c" as const, key: "menu-link-/logs-item" },
      { kind: "p" as const, key: "/web/logs" },
    ];
    expect(norm(trendSql(scope(), null, "1 day", "UTC", series, []), scope())).toBe(
      PROVEN.Q21_TREND_KEYS,
    );
  });

  it("Q21 is time-relative: no range literal", () => {
    expect(trendSql(s, id, "1 day", "UTC", [], [])).not.toMatch(/_timestamp >= \d/);
  });

  it("Q22 activeUsers counts identified users in the last 1, 7 and 30 days (AC-49)", () => {
    expect(norm(activeUsersSql(s, id, 1790576393933254), s)).toBe(PROVEN.Q22_ACTIVE_USERS);
  });

  it("the timezone and interval are literals from fixed inputs", () => {
    expect(trendSql(s, null, "1 day", "Asia/O'Kol", [], [])).toContain("'Asia/O''Kol'");
  });
});

describe("funnel builders (G4, AC-12, AC-14, AC-15, AC-47)", () => {
  const steps = [
    { kind: "p" as const, key: "/web" },
    { kind: "c" as const, key: "menu-link-/logs-item" },
    { kind: "p" as const, key: "/web/logs" },
  ];
  const s = scope({
    schema: { action_id: true, usr_email: true, user_agent_user_agent_family: true },
  });
  const id = { field: "usr_email" as const, excluded: [] };
  const opts = { events: [], sample: 1 as const };

  it("Q7 Sessions aggregates sequence_step_times per session in place of the proven chain", () => {
    const sql = funnelSql(
      s,
      id,
      { steps, unit: "sessions", window: "session", breakdown: null },
      opts,
    );
    expect(norm(sql, s)).toBe(norm(SEQ.Q7_FUNNEL_SESSIONS, s));
  });

  it("Q7 Users within 7 days runs one windowed sequence per user, with any-type identity rows and left_out", () => {
    const sql = funnelSql(s, id, { steps, unit: "users", window: "7d", breakdown: null }, opts);
    expect(norm(sql, s)).toBe(norm(SEQ.Q7_FUNNEL_USERS_7D, s));
    expect(sql).toContain("SUM(CASE WHEN anon = 1 THEN s1s ELSE 0 END) AS left_out");
    expect(sql).toContain("OR NULLIF(usr_email, '') IS NOT NULL) GROUP BY session_id, type");
  });

  it("Q7 Users / Same session partitions by session and keeps pu", () => {
    const sql = funnelSql(
      s,
      id,
      { steps, unit: "users", window: "session", breakdown: null },
      opts,
    );
    expect(sql).toContain(
      "s AS (SELECT sid, MAX(uid) AS uid, sequence_step_times(0, t, m1 = 1, m2 = 1, m3 = 1) AS f,",
    );
    expect(sql).toContain("FROM x2 GROUP BY sid)");
    expect(sql).toContain("pu AS (SELECT CASE WHEN uid IS NULL THEN 1 ELSE 0 END AS anon");
    expect(sql).not.toContain("su AS");
  });

  it("Users mode without an identity falls back to Sessions", () => {
    const sql = funnelSql(s, null, { steps, unit: "users", window: "7d", breakdown: null }, opts);
    expect(sql).toBe(
      funnelSql(s, null, { steps, unit: "sessions", window: "session", breakdown: null }, opts),
    );
  });

  it("Q7 breakdown keeps the proven dim pick next to the sequence, with the dim tie-break", () => {
    const sql = funnelSql(
      s,
      id,
      { steps, unit: "sessions", window: "session", breakdown: "browser" },
      opts,
    );
    const expected = SEQ.Q7_FUNNEL_BREAKDOWN.replace(
      "ORDER BY c1 DESC LIMIT 1000",
      "ORDER BY c1 DESC, dim LIMIT 1000",
    );
    expect(norm(sql, s)).toBe(norm(expected, s));
  });

  it("Q7 breakdown in Users mode reads pu without anonymous units", () => {
    const sql = funnelSql(
      s,
      id,
      { steps, unit: "users", window: "1d", breakdown: "browser" },
      opts,
    );
    expect(sql).toContain(
      "COUNT(DISTINCT CASE WHEN m1 = 1 THEN sid END) AS s1s, first_value(dim ORDER BY CASE WHEN m1 = 1 THEN 0 ELSE 1 END, t) AS dim FROM x2 GROUP BY COALESCE(uid, 's:' || sid)",
    );
    expect(sql).toContain(", s1s, dim FROM su)");
    expect(sql).toContain(
      "SELECT dim, SUM(r1) AS c1, SUM(r2) AS c2, SUM(r3) AS c3 FROM pu WHERE anon = 0 GROUP BY dim ORDER BY c1 DESC, dim LIMIT 1000",
    );
  });

  it("ignores a breakdown dimension missing from the schema", () => {
    const sql = funnelSql(
      scope({ schema: {} }),
      null,
      { steps, unit: "sessions", window: "session", breakdown: "country" },
      opts,
    );
    expect(sql).not.toContain("dim");
  });

  it("uses CAST(date) as the action key when the schema lacks action_id", () => {
    const sql = funnelSql(
      scope(),
      null,
      { steps, unit: "sessions", window: "session", breakdown: null },
      opts,
    );
    expect(sql).not.toContain("action_id");
    expect(sql).toContain("WHEN type = 'action' THEN CAST(date AS VARCHAR) ELSE type END");
  });

  it("a one-step funnel is step 1 only", () => {
    const sql = funnelSql(
      s,
      null,
      { steps: [steps[0]], unit: "sessions", window: "session", breakdown: null },
      opts,
    );
    expect(sql).toMatch(/SELECT SUM\(r1\) AS c1, SUM\(seen1\) AS seen1 FROM ps LIMIT 1$/);
  });

  it("a named-event step expands to its rules in the scan, keep filter and step flag (AC-45)", () => {
    const events = [
      {
        id: "ev1",
        app: "web",
        name: "Save",
        rules: [
          { t: "view" as const, op: "prefix" as const, value: "/web/dash" },
          { t: "action" as const, targets: ["save"], onPage: "/web" },
        ],
        version: 1,
        createdBy: "",
        createdAt: 0,
        updatedBy: "",
        updatedAt: 0,
      },
    ];
    const sql = funnelSql(
      s,
      null,
      {
        steps: [steps[0], { kind: "e", key: "ev1" }],
        unit: "sessions",
        window: "session",
        breakdown: null,
      },
      { events, sample: 1 },
    );
    expect(sql).toContain(
      `${clickKeyExpr("action_target_name")} IN ('save') AND ${pageKeyExpr("view_url", s.schema)} = '/web'`,
    );
    expect(sql).toContain(`starts_with(${pageKeyExpr("url", s.schema)}, '/web/dash')`);
    expect(sql).toContain(
      "CASE WHEN ((ty = 'view' AND starts_with(k, '/web/dash')) OR (ty = 'action' AND k IN ('save') AND",
    );
    expect(sql).toContain("x0 AS (SELECT sid, t, ty, CASE WHEN ty = 'view' THEN");
    expect(sql).toMatch(/ AS k, url FROM x00/);
    expect(() => assertJoinFree(sql)).not.toThrow();
  });

  it("Q8 nextSteps marks step n with sequence_step_match in place of the proven chain (AC-10)", () => {
    const sql = nextStepsSql(
      s,
      id,
      { steps, unit: "sessions", window: "session", breakdown: null },
      opts,
    );
    expect(norm(sql, s)).toBe(norm(SEQ.Q8_NEXT_STEPS, s));
  });

  it("Q8 samples sessions above the threshold in Sessions mode only (AC-52)", () => {
    const def = { steps, unit: "sessions" as const, window: "session" as const, breakdown: null };
    expect(nextStepsSql(s, id, def, { events: [], sample: 4 })).toContain(scopeClause(s, 4));
    const users = nextStepsSql(
      s,
      id,
      { ...def, unit: "users", window: "7d" },
      { events: [], sample: 4 },
    );
    expect(users).not.toContain("md5");
  });
});

describe("drop-off builders (G5, AC-16, AC-17, AC-59)", () => {
  const steps = [
    { kind: "p" as const, key: "/web" },
    { kind: "c" as const, key: "menu-link-/logs-item" },
    { kind: "p" as const, key: "/web/logs" },
  ];
  const s = scope({ schema: { action_id: true, usr_email: true } });
  const id = { field: "usr_email" as const, excluded: [] };
  const sessions = {
    steps,
    unit: "sessions" as const,
    window: "session" as const,
    breakdown: null,
  };
  const opts = { events: [], sample: 1 as const };

  it("Q11 dropoffNext (Users, 7 days) swaps the chain for the sequence functions, with Left the app first", () => {
    const sql = dropoffNextSql(
      s,
      id,
      { funnel: { ...sessions, unit: "users", window: "7d" }, stepIndex: 1, side: "dropped" },
      opts,
    );
    expect(norm(sql, s)).toBe(norm(SEQ.Q11_DROPOFF_NEXT_USERS_7D, s));
  });

  it("Q12 dropoffHealth (Sessions) swaps the chain for the sequence functions", () => {
    expect(norm(dropoffHealthSql(s, null, sessions, 1, opts), s)).toBe(
      norm(SEQ.Q12_HEALTH_SESSIONS, s),
    );
  });

  it("Q12 uses the Within-W window and a real frustration column only when the field exists", () => {
    const w = dropoffHealthSql(s, id, { ...sessions, unit: "users", window: "1h" }, 1, opts);
    expect(w).toContain(
      "MAX(CASE WHEN ty = 'error' AND t >= tk AND t <= tk + 3600000 THEN 1 ELSE 0 END) AS e",
    );
    expect(w).toContain("FROM r WHERE rk = 1 GROUP BY uid");
    expect(w).toContain("0 AS with_frustration");
    const fs = scope({ schema: { action_id: true, action_frustration_type: true } });
    const f = dropoffHealthSql(fs, null, sessions, 1, opts);
    expect(f).toContain(
      "MAX(CASE WHEN action_frustration_type IS NOT NULL THEN 1 ELSE 0 END) AS fr",
    );
    expect(f).toContain("SUM(f) AS with_frustration");
  });

  it("Q13 cohortSessions (Sessions, page 0) swaps the chain for the sequence functions, with a user label", () => {
    const sql = cohortSessionsSql(
      s,
      id,
      { funnel: sessions, stepIndex: 1, side: "dropped" },
      0,
      opts,
    );
    expect(norm(sql, s)).toBe(norm(SEQ.Q13_COHORT_SESSIONS, s));
    expect(
      cohortSessionsSql(s, id, { funnel: sessions, stepIndex: 1, side: "dropped" }, 2, opts),
    ).toMatch(/LIMIT 200 OFFSET 400$/);
  });

  it("Q13 without identity labels no user", () => {
    const sql = cohortSessionsSql(
      s,
      null,
      { funnel: sessions, stepIndex: 2, side: "dropped" },
      0,
      opts,
    );
    expect(sql).toContain("CAST(NULL AS VARCHAR) AS uid");
    expect(sql).toContain("MAX(v3) OVER (PARTITION BY sid) AS rk1");
  });

  it("drawer builders sample sessions in Sessions mode and run exact in Users mode (AC-52)", () => {
    const cohort = { funnel: sessions, stepIndex: 1, side: "dropped" as const };
    const sampled = { events: [], sample: 4 as const };
    expect(dropoffNextSql(s, id, cohort, sampled)).toContain(
      "substr(md5(session_id), 1, 1) IN ('0', '1', '2', '3')",
    );
    expect(dropoffHealthSql(s, id, sessions, 1, sampled)).toContain("md5(session_id)");
    expect(cohortSessionsSql(s, id, cohort, 0, sampled)).toContain("md5(session_id)");
    const users = {
      funnel: { ...sessions, unit: "users" as const, window: "1d" as const },
      stepIndex: 1,
      side: "dropped" as const,
    };
    expect(cohortSessionsSql(s, id, users, 0, sampled)).not.toContain("md5");
  });

  it("Q19 probes one session and gates usr_email on the schema", () => {
    expect(sessionEventsProbeSql("a'b", { usr_email: true, source: true })).toBe(
      `SELECT MIN(date) AS start_time, MAX(date) AS end_time, MAX(usr_email) AS user_email, MIN(source) AS source FROM "_rumdata" WHERE session_id = 'a''b' LIMIT 1`,
    );
    expect(sessionEventsProbeSql("x", {})).toContain("CAST(NULL AS VARCHAR) AS user_email");
  });
});

describe("paths builders (G6, AC-23, AC-24, AC-25, AC-26)", () => {
  const s = scope({ schema: { action_id: true, usr_email: true } });
  const opts = { events: [], sample: 1 as const };
  const def = {
    anchor: { kind: "p" as const, key: "/web/logs" },
    direction: "next" as const,
    depth: 3,
    include: "all" as const,
    cohort: null,
  };

  it("Q14 equals the proven shape plus the tuple tie-break", () => {
    const expected = PROVEN.Q14_PATHS.replace(
      "ORDER BY sessions DESC LIMIT 5000",
      "ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000",
    );
    expect(norm(pathsSql(s, null, def, opts), s)).toBe(norm(expected, s));
  });

  it("Previous walks back from the anchor", () => {
    const sql = pathsSql(s, null, { ...def, direction: "prev", depth: 2 }, opts);
    expect(sql).toContain(
      "MAX(CASE WHEN n = n0 - 1 THEN key END) AS s1, MAX(CASE WHEN n = n0 - 2 THEN key END) AS s2",
    );
    expect(sql).toContain("FROM an WHERE n BETWEEN n0 - 2 AND n0 GROUP BY sid");
    expect(sql).toContain("ORDER BY sessions DESC, s1, s2 LIMIT 5000");
  });

  it("Include narrows the scan to pages or clicks", () => {
    expect(pathsSql(s, null, { ...def, include: "pages" }, opts)).toContain(
      `WHERE ${scopeClause(s)} AND type = 'view' GROUP BY`,
    );
    expect(pathsSql(s, null, { ...def, include: "clicks" }, opts)).toContain(
      `WHERE ${scopeClause(s)} AND (type = 'action' AND action_target_name <> '') GROUP BY`,
    );
  });

  it("a named-event anchor marks rows by the event's rules", () => {
    const events = [
      {
        id: "ev",
        app: "web",
        name: "E",
        rules: [{ t: "view" as const, op: "prefix" as const, value: "/web/l" }],
        version: 1,
        createdBy: "",
        createdAt: 0,
        updatedBy: "",
        updatedAt: 0,
      },
    ];
    const sql = pathsSql(
      s,
      null,
      { ...def, anchor: { kind: "e", key: "ev" } },
      { events, sample: 1 },
    );
    expect(sql).toContain(
      "CASE WHEN ((ty = 'view' AND starts_with(k, '/web/l'))) THEN 1 ELSE 0 END AS am",
    );
    expect(sql).toContain("MIN(CASE WHEN am = 1 THEN n END) OVER (PARTITION BY sid) AS n0");
    expect(() => assertJoinFree(sql)).not.toThrow();
  });

  it("a funnel cohort reads the chain once and anchors at the step-k run (AC-25)", () => {
    const cohort = {
      funnel: {
        steps: [
          { kind: "p" as const, key: "/a" },
          { kind: "c" as const, key: "b" },
        ],
        unit: "sessions" as const,
        window: "session" as const,
        breakdown: null,
      },
      stepIndex: 1,
      side: "dropped" as const,
    };
    const sql = pathsSql(s, null, { ...def, anchor: null, cohort }, opts);
    expect(() => assertJoinFree(sql)).not.toThrow();
    expect(sql).toContain("FROM r WHERE rk = 1 AND rk1 = 0");
    expect(sql).toContain(
      "w AS (SELECT *, sequence_depth(0, t, m1 = 1, m2 = 1) OVER (PARTITION BY sid) AS wr, sequence_step_match(0, 1, t, m1 = 1, m2 = 1) OVER (PARTITION BY sid) AS wv FROM x2)",
    );
    expect(sql).toContain(
      "v AS (SELECT *, CASE WHEN wv THEN 1 ELSE 0 END AS v1, CASE WHEN wr >= 2 THEN 1 ELSE 0 END AS v2 FROM w)",
    );
    expect(sql).not.toContain("RANGE BETWEEN");
    expect(sql).toContain("MAX(CASE WHEN t <= step_t THEN n END) OVER (PARTITION BY sid) AS n0");
    expect(sql).toContain("ORDER BY sessions DESC, s1, s2, s3 LIMIT 5000");
  });

  it("a sessions cohort reuses the reach time; a users cohort takes the step time per session", () => {
    const funnel = {
      steps: [
        { kind: "p" as const, key: "/a" },
        { kind: "c" as const, key: "b" },
      ],
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: null,
    };
    const sessions = pathsSql(
      s,
      null,
      { ...def, anchor: null, cohort: { funnel, stepIndex: 1, side: "dropped" } },
      opts,
    );
    expect(sessions).toContain(
      "cr AS (SELECT sid, t, ty, hr, k, tk AS step_t FROM r WHERE rk = 1 AND rk1 = 0)",
    );
    const id = { field: "usr_email" as const, excluded: [] };
    const users = pathsSql(
      s,
      id,
      {
        ...def,
        anchor: null,
        cohort: {
          funnel: { ...funnel, unit: "users", window: "1d" },
          stepIndex: 1,
          side: "dropped",
        },
      },
      opts,
    );
    // A user's first reach can sit in another session, so the walk keeps its own per-session step time.
    expect(users).toContain(
      "MIN(CASE WHEN v1 = 1 THEN t END) OVER (PARTITION BY sid) AS step_t FROM r",
    );
  });

  it("Q15 equals the proven shape for a depth-2 branch (AC-26)", () => {
    const sql = branchSessionsSql(s, null, def, "s1 = 'x' AND s2 = 'y'", 2, 0, opts);
    const errorsApart = PROVEN.Q15_BRANCH.replace(
      "LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk",
      "LAG(key) OVER (PARTITION BY sid, CASE WHEN ty = 'error' THEN 1 ELSE 0 END ORDER BY t, key) AS pk",
    );
    expect(norm(sql, s)).toBe(norm(errorsApart, s));
    expect(branchSessionsSql(s, null, def, "TRUE", 0, 1, opts)).toContain(
      "SELECT sid, t0 AS step_t",
    );
    expect(branchSessionsSql(s, null, def, "TRUE", 0, 1, opts)).toMatch(/LIMIT 200 OFFSET 200$/);
  });

  it("the branch drawer numbers path steps exactly as the flow does, error rows included (AC-26)", () => {
    const cte = (sql: string, name: string) =>
      sql.split("\n").find((l) => l.startsWith(`${name} AS (`)) ?? "";
    const cohort = {
      funnel: {
        steps: [
          { kind: "p" as const, key: "/a" },
          { kind: "c" as const, key: "b" },
        ],
        unit: "sessions" as const,
        window: "session" as const,
        breakdown: null,
      },
      stepIndex: 1,
      side: "dropped" as const,
    };
    for (const d of [def, { ...def, anchor: null, cohort }]) {
      const flow = pathsSql(s, null, d, opts);
      const branch = branchSessionsSql(s, null, d, "TRUE", 1, 0, opts);
      expect(branch).toContain("ty = 'error'");
      // Error rows carry no key, so a LAG across them would let A, error, A count A twice.
      expect(cte(branch, "d")).toContain(
        "LAG(key) OVER (PARTITION BY sid, CASE WHEN ty = 'error' THEN 1 ELSE 0 END ORDER BY t, key) AS pk",
      );
      expect(cte(branch, "sq")).toBe(cte(flow, "sq"));
      expect(cte(branch, "an")).toBe(cte(flow, "an"));
    }
  });

  it("paths sample sessions above the threshold (AC-52)", () => {
    expect(pathsSql(s, null, def, { events: [], sample: 8 })).toContain(
      "substr(md5(session_id), 1, 1) IN ('0', '1')",
    );
    expect(branchSessionsSql(s, null, def, "TRUE", 1, 0, { events: [], sample: 2 })).toContain(
      "md5(session_id)",
    );
  });
});

describe("retention builders (G7, AC-31, AC-34, AC-35, AC-51)", () => {
  const s = scope({ schema: { usr_email: true } });
  const id = { field: "usr_email" as const, excluded: [] };
  const any = { start: null, ret: null, per: "week" as const, mode: "on" as const };
  const opts = { events: [], sample: 1 as const };

  it("Q16 equals the proven shape with period boundaries as literals", () => {
    expect(norm(retentionSql(s, id, any, [1000, 2000, 3000], opts), s)).toBe(
      norm(PROVEN.Q16_RETENTION, s),
    );
  });

  it("Q17 On mode equals the proven shape", () => {
    expect(norm(retentionCellUsersSql(s, id, any, [1000, 2000, 3000], 0, 1, opts), s)).toBe(
      norm(PROVEN.Q17_CELL, s),
    );
  });

  it("Q17 On or after counts a user retained by their last return period", () => {
    const sql = retentionCellUsersSql(
      s,
      id,
      { ...any, mode: "after" },
      [1000, 2000, 3000],
      0,
      1,
      opts,
    );
    expect(sql).toContain("CASE WHEN MAX(last_ret) >= 1 THEN 1 ELSE 0 END AS retained");
  });

  it("narrows start and return to a page or click (AC-34)", () => {
    const sql = retentionSql(
      s,
      id,
      { ...any, start: { kind: "p", key: "/signup" }, ret: { kind: "c", key: "save" } },
      [1, 2],
      opts,
    );
    expect(sql).toContain(
      `MAX(CASE WHEN (type = 'view' AND (strpos(view_url, '/signup') > 0) AND ${pageKeyExpr("view_url", s.schema)} = '/signup') THEN 1 ELSE 0 END) AS s`,
    );
    expect(sql).toContain(
      `MAX(CASE WHEN (type = 'action' AND action_target_name <> '' AND ${clickKeyExpr("action_target_name")} = 'save') THEN 1 ELSE 0 END) AS r`,
    );
    expect(sql).toMatch(/LIMIT 3$/);
  });

  it("samples users by a hash of the identity (AC-52)", () => {
    const sql = retentionSql(s, id, any, [1, 2, 3], { events: [], sample: 2 });
    expect(sql).toContain(
      "AND substr(md5(NULLIF(usr_email, '')), 1, 1) IN ('0', '1', '2', '3', '4', '5', '6', '7')",
    );
    expect(sql).not.toContain("md5(session_id)");
  });

  it("uses the dominant-value exclusion as the identity (AC-50)", () => {
    const sql = retentionSql(s, { field: "usr_email", excluded: ["bot"] }, any, [1, 2], opts);
    expect(sql).toContain(
      "CASE WHEN NULLIF(usr_email, '') IN ('bot') THEN NULL ELSE NULLIF(usr_email, '') END AS u",
    );
  });
});

describe("features builder (G8, AC-45)", () => {
  const s = scope({ schema: { action_id: true, usr_email: true } });
  const id = { field: "usr_email" as const, excluded: [] };
  const ev = (i: number, rules: NamedEvent["rules"]): NamedEvent => ({
    id: `e${i}`,
    app: "web",
    name: `E${i}`,
    rules,
    version: 1,
    createdBy: "",
    createdAt: 0,
    updatedBy: "",
    updatedAt: 0,
  });
  const events = [
    ev(0, [{ t: "view", op: "eq", value: "/web/logs" }]),
    ev(1, [{ t: "action", targets: ["menu-link-/logs-item"], onPage: "/web" }]),
  ];

  it("Q23 equals the proven shape", () => {
    expect(norm(featuresSql(s, CS, id, events), s)).toBe(norm(PROVEN.Q23_FEATURES, s));
  });

  it("drops the identity columns without an identity and refuses more than 5 events", () => {
    const sql = featuresSql(s, CS, null, events);
    expect(sql).not.toMatch(/users|u0|usr_email/);
    const many = Array.from({ length: 6 }, (_, i) =>
      ev(i, [{ t: "view", op: "prefix", value: "/a" }]),
    );
    expect(() => featuresSql(s, CS, null, many)).toThrow();
  });

  it("uses prefix and regex rules over the page template", () => {
    const sql = featuresSql(s, CS, null, [
      ev(0, [
        { t: "view", op: "prefix", value: "/web/" },
        { t: "view", op: "regex", value: "^/a$" },
      ]),
    ]);
    expect(sql).toContain(
      "((ty = 'view' AND starts_with(pg, '/web/')) OR (ty = 'view' AND regexp_like(pg, '^/a$')))",
    );
  });
});

describe("dashboard panel builder (G9, AC-53)", () => {
  const steps = [
    { kind: "p" as const, key: "/web" },
    { kind: "c" as const, key: "menu-link-/logs-item" },
    { kind: "p" as const, key: "/web/logs" },
  ];
  const s = scope({ schema: { action_id: true } });

  it("pivots the unbroken Sessions funnel into one row per step", () => {
    const sql = funnelPanelSql(
      s,
      { steps, unit: "users", window: "7d", breakdown: "browser" },
      { events: [], sample: 4 },
    );
    expect(norm(sql, s)).toBe(norm(SEQ.Q7_PANEL, s));
    expect(sql).not.toMatch(/_timestamp >= \d|md5/);
  });
});

describe("alert-bound builders (no SELECT *)", () => {
  // The same pattern as RE_ONLY_SELECT in src/search/src/sql/mod.rs, which the alert service applies to the whole text.
  const RE_ONLY_SELECT = /select[ ]+\*/i;
  const steps = [
    { kind: "p" as const, key: "/web" },
    { kind: "c" as const, key: "menu-link-/logs-item" },
    { kind: "e" as const, key: "ev1" },
  ];
  const events: NamedEvent[] = [
    {
      id: "ev1",
      app: "web",
      name: "Save",
      rules: [{ t: "action", targets: ["save"], onPage: "/web" }],
      version: 1,
      createdBy: "",
      createdAt: 0,
      updatedBy: "",
      updatedAt: 0,
    },
  ];
  const s = scope({
    schema: { action_id: true, usr_email: true, user_agent_user_agent_family: true },
  });
  const id = { field: "usr_email" as const, excluded: [] };
  const opts = { events, sample: 1 as const };
  const defs = [
    { unit: "sessions" as const, window: "session" as const },
    { unit: "users" as const, window: "session" as const },
    { unit: "users" as const, window: "1h" as const },
    { unit: "users" as const, window: "7d" as const },
  ].flatMap((u) =>
    [2, 3, 10, 20].map((n) => ({
      ...u,
      steps: Array.from({ length: n }, (_, i) => steps[i % steps.length]),
      breakdown: "browser" as const,
    })),
  );

  it.each(defs)("funnelAlertSql never writes SELECT * ($unit, $window)", (def) => {
    const sql = funnelAlertSql(s, id, def, 50, opts);
    expect(sql).not.toMatch(RE_ONLY_SELECT);
    expect(() => assertJoinFree(sql)).not.toThrow();
  });

  it.each(defs)(
    "funnelPanelSql, which dashboards can turn into alerts, never writes SELECT * ($unit, $window)",
    (def) => {
      expect(funnelPanelSql(s, def, opts)).not.toMatch(RE_ONLY_SELECT);
    },
  );

  it("ends in the conversion row filter over the funnel's own counts", () => {
    const def = {
      steps: steps.slice(0, 2),
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: null,
    };
    const sql = funnelAlertSql(s, id, def, 42.5, opts);
    expect(sql).toContain("fin AS (SELECT SUM(r1) AS entered, SUM(r2) AS converted FROM ps)");
    expect(sql).toMatch(
      /\nSELECT entered, converted, 100\.0 \* converted \/ entered AS conv_pct FROM fin WHERE entered > 0 AND 100\.0 \* converted \/ entered < 42\.5$/,
    );
    const users = funnelAlertSql(s, id, { ...def, unit: "users", window: "1d" }, 42.5, opts);
    expect(users).toContain("SUM(r2) AS converted FROM pu WHERE anon = 0)");
  });

  it("drops the breakdown and clamps the threshold to 0-100", () => {
    const def = {
      steps: steps.slice(0, 2),
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: "browser" as const,
    };
    expect(funnelAlertSql(s, id, def, 250, opts)).toMatch(/ < 100$/);
    expect(funnelAlertSql(s, id, def, Number.NaN, opts)).toMatch(/ < 0$/);
    expect(funnelAlertSql(s, id, def, 10, opts)).not.toContain("dim");
  });
});

describe("assertJoinFree over every builder (AC-55)", () => {
  const s = scope({
    schema: {
      action_id: true,
      usr_email: true,
      session_type: true,
      user_agent_user_agent_family: true,
      action_frustration_type: true,
    },
  });
  const id = { field: "usr_email" as const, excluded: ["bot@x.com"] };
  const ev: NamedEvent = {
    id: "ev1aaaaaaaaa",
    app: "web",
    name: "Save",
    rules: [
      { t: "view", op: "regex", value: "^/web/.*$" },
      { t: "action", targets: ["save"], onPage: "/web" },
    ],
    version: 1,
    createdBy: "",
    createdAt: 0,
    updatedBy: "",
    updatedAt: 0,
  };
  const opts = { events: [ev], sample: 4 as const };
  const pick = [
    { kind: "p" as const, key: "/web" },
    { kind: "c" as const, key: "save" },
    { kind: "e" as const, key: "ev1aaaaaaaaa" },
  ];
  const steps = (n: number) => Array.from({ length: n }, (_, i) => pick[i % pick.length]);
  const defs = [2, 20].flatMap((n) =>
    (
      [
        ["sessions", "session"],
        ["users", "session"],
        ["users", "1d"],
      ] as const
    ).map(([unit, window]) => ({ steps: steps(n), unit, window, breakdown: "browser" as const })),
  );
  const retention = { start: pick[2], ret: pick[1], per: "week" as const, mode: "after" as const };
  const bounds = [1000, 2000, 3000, 4000];
  const builders: Record<string, () => string[]> = {
    appProbeSql: () => [QUERIES.appProbeSql()],
    facetOptionsSql: () => [
      QUERIES.facetOptionsSql(s, "env"),
      QUERIES.facetOptionsSql(s, "version"),
    ],
    summarySql: () => [QUERIES.summarySql(s, CS)],
    identityTopSql: () => [QUERIES.identityTopSql(s, "usr_email")],
    entryExitSql: () => [QUERIES.entryExitSql(s, CS, id), QUERIES.entryExitSql(s, CS, null)],
    stepPickerSql: () => [QUERIES.stepPickerSql(s), QUERIES.stepPickerSql(s, "we")],
    pagesSql: () => [QUERIES.pagesSql(s, CS, id), QUERIES.pagesSql(s, CS, null)],
    clicksSql: () => [QUERIES.clicksSql(s, CS, id), QUERIES.clicksSql(s, CS, null)],
    clickPagesSql: () => [QUERIES.clickPagesSql(s, CS, ["save", "o'k"])],
    trendSql: () => [QUERIES.trendSql(s, id, "1 day", "UTC", pick, [ev])],
    activeUsersSql: () => [QUERIES.activeUsersSql(s, id, CS)],
    funnelSql: () =>
      defs.flatMap((d) => [
        QUERIES.funnelSql(s, id, d, opts),
        QUERIES.funnelSql(s, id, { ...d, breakdown: null }, opts),
      ]),
    funnelPanelSql: () => defs.map((d) => QUERIES.funnelPanelSql(s, d, opts)),
    funnelAlertSql: () => defs.map((d) => QUERIES.funnelAlertSql(s, id, d, 50, opts)),
    nextStepsSql: () => defs.map((d) => QUERIES.nextStepsSql(s, id, d, opts)),
    dropoffNextSql: () =>
      defs.map((d) =>
        QUERIES.dropoffNextSql(
          s,
          id,
          { funnel: d, stepIndex: d.steps.length - 1, side: "dropped" },
          opts,
        ),
      ),
    dropoffHealthSql: () => defs.map((d) => QUERIES.dropoffHealthSql(s, id, d, 1, opts)),
    cohortSessionsSql: () =>
      defs.map((d) =>
        QUERIES.cohortSessionsSql(s, id, { funnel: d, stepIndex: 1, side: "dropped" }, 1, opts),
      ),
    sessionEventsProbeSql: () => [QUERIES.sessionEventsProbeSql("s'1", s.schema)],
    pathsSql: () => [
      ...pick.map((anchor) =>
        QUERIES.pathsSql(
          s,
          id,
          { anchor, direction: "prev", depth: 5, include: "all", cohort: null },
          opts,
        ),
      ),
      ...defs.map((d) =>
        QUERIES.pathsSql(
          s,
          id,
          {
            anchor: null,
            direction: "next",
            depth: 5,
            include: "pages",
            cohort: { funnel: d, stepIndex: d.steps.length - 1, side: "dropped" },
          },
          opts,
        ),
      ),
    ],
    branchSessionsSql: () =>
      defs.map((d) =>
        QUERIES.branchSessionsSql(
          s,
          id,
          {
            anchor: null,
            direction: "next",
            depth: 3,
            include: "all",
            cohort: { funnel: d, stepIndex: 1, side: "dropped" },
          },
          "s1 = 'p:/web'",
          2,
          0,
          opts,
        ),
      ),
    retentionSql: () => [QUERIES.retentionSql(s, id, retention, bounds, opts)],
    retentionCellUsersSql: () => [
      QUERIES.retentionCellUsersSql(s, id, retention, bounds, 0, 2, opts),
    ],
    featuresSql: () => [
      QUERIES.featuresSql(s, CS, id, [ev]),
      QUERIES.featuresSql(s, CS, null, [ev]),
    ],
  };

  it("covers every exported *Sql builder", () => {
    const exported = Object.entries(QUERIES)
      .filter(([name, v]) => name.endsWith("Sql") && typeof v === "function")
      .map(([name]) => name)
      .sort();
    expect(Object.keys(builders).sort()).toEqual(exported);
  });

  it.each(Object.keys(builders))(
    "%s reads _rumdata once with no JOIN, IN (SELECT, EXISTS or UNION",
    (name) => {
      const sqls = builders[name]();
      expect(sqls.length).toBeGreaterThan(0);
      for (const sql of sqls) expect(() => assertJoinFree(sql)).not.toThrow();
    },
  );
});

describe("saved funnel sql cap (G8, CR-24)", () => {
  const s = scope({
    schema: { action_id: true, usr_email: true, user_agent_user_agent_family: true },
  });
  const id = { field: "usr_email" as const, excluded: ["a'b@x.com"] };
  const key = (i: number, c: string) => `/${c.repeat(1023 - String(i).length)}${i}`;
  const sizes = (page: string, click: string) => {
    const steps = Array.from({ length: 10 }, (_, i) =>
      i % 2
        ? { kind: "c" as const, key: key(i, click) }
        : { kind: "p" as const, key: key(i, page) },
    );
    return (["sessions", "users"] as const).flatMap((unit) =>
      [null, "browser" as const].map((breakdown) => {
        const window = unit === "users" ? ("7d" as const) : ("session" as const);
        const sql = funnelSql(
          s,
          unit === "users" ? id : null,
          { steps, unit, window, breakdown },
          {
            events: [],
            sample: 1,
          },
        );
        return new TextEncoder().encode(sql).length;
      }),
    );
  };

  it("a 10-step funnel of 1,024-character ASCII keys compiles under the server's 65,536-byte cap", () => {
    expect(Math.max(...sizes("b", "a"))).toBeLessThan(65536);
  });

  it("quote-heavy or multibyte 1,024-character keys can exceed it, which is why Save checks bytes first", () => {
    expect(Math.max(...sizes("'", "é"))).toBeGreaterThan(65536);
  });
});
