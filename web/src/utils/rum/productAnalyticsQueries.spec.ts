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
import * as MODEL from "@/utils/rum/productAnalyticsModel";
import * as PROVEN from "@/utils/rum/__fixtures__/productAnalyticsProvenSql";
import * as PATHS from "@/utils/rum/__fixtures__/productAnalyticsPathsSql";
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

// Strips the drawer's NULL user_label wherever it sits, so the rest can be compared with the pre-#2851 SQL.
const dropColumn = (sql: string, col: string): string =>
  sql.replace(new RegExp(`,\\s*${col}`, "g"), "").replace(new RegExp(`${col},\\s*`, "g"), "");
const withoutNullLabel = (sql: string): string =>
  dropColumn(
    dropColumn(sql, String.raw`CAST\(NULL AS VARCHAR\) AS user_label\b`),
    String.raw`\buser_label\b`,
  );

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
    const s = scope({ schema: { action_target_name: true } });
    expect(stepPredicateRaw({ kind: "c", key: "it's" }, s, [])).toBe(
      `(type = 'action' AND action_target_name <> '' AND ${PROVEN_CK} = 'it''s')`,
    );
  });

  it("click raw predicate matches nothing when the org has no action_target_name (o2-enterprise#2800)", () => {
    expect(stepPredicateRaw({ kind: "c", key: "it's" }, scope(), [])).toBe("(1 = 0)");
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
    const s = scope({ schema: { action_target_name: true } });
    const g = stepPredicateGrouped({ kind: "e", key: "ev1" }, s, events);
    expect(g).toBe(
      `((ty = 'view' AND k = '/web/logs') OR (ty = 'view' AND starts_with(k, '/web/dash')) OR (ty = 'view' AND regexp_like(k, '^/web/(a|b)$')) OR (ty = 'action' AND k IN ('save', 'o''k') AND ${pageKeyExpr("url", {})} = '/web'))`,
    );
    const r = stepPredicateRaw({ kind: "e", key: "ev1" }, s, events);
    expect(r).toContain(`starts_with(${pageKeyExpr("view_url", {})}, '/web/dash')`);
    expect(r).toContain(
      `${PROVEN_CK} IN ('save', 'o''k') AND ${pageKeyExpr("view_url", {})} = '/web'`,
    );
  });

  it("a named event's action rule matches nothing when the org has no action_target_name (o2-enterprise#2800)", () => {
    expect(stepPredicateRaw({ kind: "e", key: "ev1" }, scope(), events)).toContain("(1 = 0)");
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

  it("P5-R8: Q3 summary flags synthetic sessions per session, drops them from sessions and counts them apart (P1-M2)", () => {
    const sql = summarySql(s, CS);
    const g = sql.slice(sql.indexOf("g AS (SELECT ") + "g AS (SELECT ".length);
    const final = sql.slice(sql.lastIndexOf("\n") + 1);
    expect(g).toContain("MAX(CASE WHEN session_type = 'synthetics' THEN 1 ELSE 0 END) AS syn");
    expect(final).toMatch(/SUM\(CASE WHEN [^)]*cur = 1 AND syn = 0[^)]*\) AS sessions/);
    expect(final).toMatch(/SUM\(CASE WHEN [^)]*prv = 1 AND syn = 0[^)]*\) AS prev_sessions/);
    expect(final).toMatch(/SUM\(CASE WHEN [^)]*cur = 1 AND syn = 1[^)]*\) AS synthetic_sessions/);
  });

  it("Q3 drops synthetic sessions from views, rows and identity counts too", () => {
    const final = summarySql(s, CS).split("\n").pop()!;
    expect(final).toMatch(/SUM\(CASE WHEN [^)]*syn = 0[^)]*THEN views ELSE 0 END\) AS views/);
    expect(final).toMatch(/SUM\(CASE WHEN [^)]*syn = 0[^)]*THEN va ELSE 0 END\) AS va_rows/);
    expect(final).toMatch(
      /CASE WHEN [^)]*syn = 0 AND starts_with\(v, [^)]*\) THEN v END\) AS usr_email__values/,
    );
    expect(final).toMatch(
      /CASE WHEN [^)]*syn = 0 AND usr_email__has = 1 THEN sid END\) AS usr_email__sessions/,
    );
  });

  it("P5-R8: Q3 without session_type or candidates never reads session_type and has no identity pairs", () => {
    const sql = summarySql(scope(), CS);
    expect(sql).toContain("AS synthetic_sessions");
    expect(sql).not.toContain("session_type");
    expect(sql).not.toContain("__values");
  });

  it("P5-R8: Q3 keeps env and version filters in its per-session pass", () => {
    const sql = summarySql({ ...s, env: ["prod"] }, CS);
    expect(sql).toContain(
      "WHERE application_id = 'web' AND session_id IS NOT NULL AND env IN ('prod') GROUP BY session_id",
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
  const s = scope({ schema: { usr_email: true, action_target_name: true } });
  const id = { field: "usr_email" as const, excluded: [] };

  it("P5-R14: Q6 without identity drops the users columns and groups per view", () => {
    const sql = entryExitSql(s, CS, null);
    expect(sql).not.toContain("users");
    expect(sql).not.toContain("usr_email");
    expect(sql).toContain(`WHERE ${scopeClause(s)} AND type = 'view' GROUP BY session_id, view_id`);
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

  it("Q9 stepPicker never references action_target_name when the org has no click events (o2-enterprise#2800)", () => {
    const noClicks = scope({ schema: { usr_email: true } });
    const sql = stepPickerSql(noClicks);
    expect(sql).not.toContain("action_target_name");
    expect(sql).toContain("(type = 'view' OR FALSE)");
    expect(() => assertJoinFree(sql)).not.toThrow();
  });
});

describe("overview builders (G3)", () => {
  const s = scope({ schema: { usr_email: true, action_target_name: true } });
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

  it("Q5/Q5b render an empty result instead of a 400 when the org has no click events (o2-enterprise#2800)", () => {
    const noClicks = scope({ schema: { usr_email: true } });
    const clicks = clicksSql(noClicks, CS, id);
    expect(clicks).not.toContain("action_target_name");
    expect(clicks).toContain(`WHERE ${scopeClause(noClicks)} AND FALSE GROUP BY`);
    expect(() => assertJoinFree(clicks)).not.toThrow();
    const clickPages = clickPagesSql(noClicks, CS, ["k1", "k2"]);
    expect(clickPages).not.toContain("action_target_name");
    expect(clickPages).toContain("AND FALSE AND");
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
    const withClicks = scope({ schema: { action_target_name: true } });
    expect(norm(trendSql(withClicks, null, "1 day", "UTC", series, []), withClicks)).toBe(
      PROVEN.Q21_TREND_KEYS,
    );
  });

  it("Q21 a click series matches nothing, instead of referencing action_target_name, when the org has no click events (o2-enterprise#2800)", () => {
    const series = [{ kind: "c" as const, key: "menu-link-/logs-item" }];
    const sql = trendSql(scope(), null, "1 day", "UTC", series, []);
    expect(sql).not.toContain("action_target_name");
    expect(sql).toContain("COUNT(DISTINCT CASE WHEN (1 = 0) THEN session_id END) AS y_axis_1");
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
    schema: {
      action_id: true,
      usr_email: true,
      user_agent_user_agent_family: true,
      session_has_replay: true,
      action_target_name: true,
    },
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
  const s = scope({
    schema: {
      action_id: true,
      usr_email: true,
      session_has_replay: true,
      action_target_name: true,
    },
  });
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

  it("Q12 falls back to a constant hr instead of referencing session_has_replay when the org has no replay data", () => {
    const noReplay = scope({ schema: { action_id: true, usr_email: true } });
    const sql = dropoffHealthSql(noReplay, null, sessions, 1, opts);
    expect(sql).not.toContain("session_has_replay");
    expect(sql).toContain("0 AS hr");
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
  const s = scope({
    schema: {
      action_id: true,
      usr_email: true,
      session_has_replay: true,
      action_target_name: true,
    },
  });
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
      `WHERE ${scopeClause(s)} AND ((type = 'action' AND action_target_name <> '') OR ${stepPredicateRaw(def.anchor, s, opts.events)}) GROUP BY`,
    );
  });

  it("a page anchor survives a mismatched Clicks filter, so its own reach is never lost (P0 o2#15*)", () => {
    const sql = pathsSql(s, null, { ...def, include: "clicks" }, opts);
    expect(sql).toContain(
      `AND ((type = 'action' AND action_target_name <> '') OR (type = 'view' AND (strpos(view_url, '${def.anchor.key}') > 0) AND ${pageKeyExpr("view_url", s.schema)} = '${def.anchor.key}')) GROUP BY`,
    );
    expect(sql).toContain(
      "MIN(CASE WHEN key = 'p:/web/logs' THEN n END) OVER (PARTITION BY sid) AS n0",
    );
    expect(() => assertJoinFree(sql)).not.toThrow();
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

  it("R5: Q15 equals the proven shape for a depth-2 branch plus a NULL user_label (AC-26)", () => {
    const sql = branchSessionsSql(s, null, def, "s1 = 'x' AND s2 = 'y'", 2, 0, opts);
    const errorsApart = PROVEN.Q15_BRANCH.replace(
      "LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk",
      "LAG(key) OVER (PARTITION BY sid, CASE WHEN ty = 'error' THEN 1 ELSE 0 END ORDER BY t, key) AS pk",
    );
    expect(sql).toContain("CAST(NULL AS VARCHAR) AS user_label");
    expect(sql.split("\n").at(-1)!.split(" FROM ")[0]).toMatch(/\buser_label\b/);
    expect(norm(withoutNullLabel(sql), s)).toBe(norm(errorsApart, s));
    expect(branchSessionsSql(s, null, def, "TRUE", 0, 1, opts)).toContain(
      "SELECT sid, t0 AS step_t",
    );
    expect(branchSessionsSql(s, null, def, "TRUE", 0, 1, opts)).toMatch(/LIMIT 200 OFFSET 200$/);
  });

  it("falls back to a constant hr instead of referencing session_has_replay when the org has no replay data", () => {
    const noReplay = scope({ schema: { action_id: true, usr_email: true } });
    const sql = pathsSql(noReplay, null, def, opts);
    expect(sql).not.toContain("session_has_replay");
    expect(sql).toContain("0 AS hr");
  });

  it("degrades Include to view-only, instead of referencing action_target_name, when the org has no click events (o2-enterprise#2800)", () => {
    const noClicks = scope({ schema: { action_id: true, usr_email: true } });
    const all = pathsSql(noClicks, null, def, opts);
    expect(all).not.toContain("action_target_name");
    expect(all).toContain("WHERE " + scopeClause(noClicks) + " AND type = 'view' GROUP BY");
    const pages = pathsSql(noClicks, null, { ...def, include: "pages" }, opts);
    expect(pages).not.toContain("action_target_name");
    const clicks = pathsSql(noClicks, null, { ...def, include: "clicks" }, opts);
    expect(clicks).not.toContain("action_target_name");
    expect(clicks).toContain(
      `WHERE ${scopeClause(noClicks)} AND (FALSE OR ${stepPredicateRaw(def.anchor, noClicks, opts.events)}) GROUP BY`,
    );
    expect(() => assertJoinFree(all)).not.toThrow();
    expect(() => assertJoinFree(clicks)).not.toThrow();
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
    const withClicks = scope({ schema: { usr_email: true, action_target_name: true } });
    const sql = retentionSql(
      withClicks,
      id,
      { ...any, start: { kind: "p", key: "/signup" }, ret: { kind: "c", key: "save" } },
      [1, 2],
      opts,
    );
    expect(sql).toContain(
      `MAX(CASE WHEN (type = 'view' AND (strpos(view_url, '/signup') > 0) AND ${pageKeyExpr("view_url", withClicks.schema)} = '/signup') THEN 1 ELSE 0 END) AS s`,
    );
    expect(sql).toContain(
      `MAX(CASE WHEN (type = 'action' AND action_target_name <> '' AND ${clickKeyExpr("action_target_name")} = 'save') THEN 1 ELSE 0 END) AS r`,
    );
    expect(sql).toMatch(/LIMIT 3$/);
  });

  it("a click return matches nothing, instead of referencing action_target_name, when the org has no click events (o2-enterprise#2800)", () => {
    const sql = retentionSql(
      s,
      id,
      { ...any, start: { kind: "p", key: "/signup" }, ret: { kind: "c", key: "save" } },
      [1, 2],
      opts,
    );
    expect(sql).not.toContain("action_target_name");
    expect(sql).toContain("MAX(CASE WHEN (1 = 0) THEN 1 ELSE 0 END) AS r");
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
  const s = scope({ schema: { action_id: true, usr_email: true, action_target_name: true } });
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

  it("never references action_target_name when the org has no click events (o2-enterprise#2800)", () => {
    const noClicks = scope({ schema: { action_id: true, usr_email: true } });
    const sql = featuresSql(noClicks, CS, id, events);
    expect(sql).not.toContain("action_target_name");
    expect(sql).toContain("(type = 'view' OR FALSE OR");
    expect(() => assertJoinFree(sql)).not.toThrow();
  });
});

describe("dashboard panel builder (G9, AC-53)", () => {
  const steps = [
    { kind: "p" as const, key: "/web" },
    { kind: "c" as const, key: "menu-link-/logs-item" },
    { kind: "p" as const, key: "/web/logs" },
  ];
  const s = scope({ schema: { action_id: true, action_target_name: true } });

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

// P5 builders (§4.1, §4.6, §4.7) that are not exported yet.
const P5_NEW = QUERIES as unknown as Record<string, (...args: unknown[]) => string>;

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
    errorPickerSql: () => [P5_NEW.errorPickerSql(s), P5_NEW.errorPickerSql(s, "fa'il")],
    unnamedClicksSql: () => [P5_NEW.unnamedClicksSql(s)],
    userAgentSuggestionSql: () => [P5_NEW.userAgentSuggestionSql(s)],
    namedEventPreviewSql: () => [P5_NEW.namedEventPreviewSql(s, ev)],
    filterValuesSql: () => [QUERIES.filterValuesSql(s, "usr_email")],
    whyEnteredSql: () =>
      defs.map((d) =>
        QUERIES.whyEnteredSql(
          s,
          { ...d, f: [{ field: "usr_email", op: "in", values: ["a@x.io"] }] },
          opts,
        ),
      ),
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
    schema: {
      action_id: true,
      usr_email: true,
      user_agent_user_agent_family: true,
      action_target_name: true,
    },
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

// pageKeyExpr's mobile fallback read view_name directly, but CTE call sites only ever select url/fu/lu.
describe("mobile view_name fallback reaches a column the CTE actually selects (o2-enterprise#2798)", () => {
  const s = scope({
    schema: { view_name: true, usr_email: true, action_id: true, action_target_name: true },
  });
  const id = { field: "usr_email" as const, excluded: [] };
  const opts = { events: [], sample: 1 as const };

  it("pageKeyExpr lets a caller name the real backing column instead of the raw 'view_name'", () => {
    expect(pageKeyExpr("url", { view_name: true }, "vn")).toContain("THEN NULLIF(vn, '') ELSE");
    expect(pageKeyExpr("url", { view_name: true })).toContain("THEN NULLIF(view_name, '') ELSE");
  });

  it("Q4 pages (Overview -> Pages) carries vn through v0/v1 and reads it, not the raw column", () => {
    const sql = pagesSql(s, CS, id);
    expect(sql).toContain("MIN(CASE WHEN type = 'view' THEN view_name END) AS vn");
    expect(sql).toContain("v1 AS (SELECT sid, ty, cur, vid, url, vn,");
    expect(sql).toContain("NULLIF(vn, '')");
    expect(sql).not.toContain("NULLIF(view_name, '')");
  });

  it("P5-R14: Q6 entryExit carries view_name per view for the page key, not the raw column", () => {
    const sql = entryExitSql(s, CS, id);
    const v0 = sql.slice(0, sql.indexOf("\n"));
    expect(v0).toContain("view_name");
    expect(sql).not.toContain("AS fvn");
    expect(sql).not.toContain("NULLIF(view_name, '')");
  });

  it("Q9 stepPicker carries vn", () => {
    const sql = stepPickerSql(s);
    expect(sql).toContain("MIN(view_name) AS vn");
    expect(sql).toContain("NULLIF(vn, '')");
    expect(sql).not.toContain("NULLIF(view_name, '')");
  });

  it("Q7 funnel (Funnels panel) carries vn through x00/x0 for the page key", () => {
    const steps = [
      { kind: "p" as const, key: "/web" },
      { kind: "p" as const, key: "/web/logs" },
    ];
    const sql = funnelSql(
      s,
      id,
      { steps, unit: "sessions", window: "session", breakdown: null },
      opts,
    );
    expect(sql).toContain("MIN(view_name) AS vn");
    expect(sql).toContain("NULLIF(vn, '')");
    expect(sql).not.toContain("NULLIF(view_name, '')");
  });

  it("an on-page action rule forwards vn alongside url so the step flag resolves it inside x1", () => {
    const events = [
      {
        id: "ev1",
        app: "web",
        name: "Save",
        rules: [{ t: "action" as const, targets: ["save"], onPage: "/web" }],
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
        steps: [{ kind: "e" as const, key: "ev1" }],
        unit: "sessions",
        window: "session",
        breakdown: null,
      },
      { events, sample: 1 },
    );
    expect(sql).toMatch(/ AS k, url, vn FROM x00/);
    expect(sql).toContain(`k IN ('save') AND ${pageKeyExpr("url", s.schema, "vn")} = '/web'`);
    expect(sql).toContain("NULLIF(view_name, '')"); // the raw-level onPage scan filter in x00, unaffected
  });

  it("Q12 dropoffHealth and Q13 cohortSessions carry vn through fullChainCtes", () => {
    const sessions = {
      steps: [
        { kind: "p" as const, key: "/web" },
        { kind: "c" as const, key: "menu-link-/logs-item" },
      ],
      unit: "sessions" as const,
      window: "session" as const,
      breakdown: null,
    };
    const health = dropoffHealthSql(s, null, sessions, 1, opts);
    expect(health).toContain("MIN(view_name) AS vn");
    expect(health).toContain("NULLIF(vn, '')");
    expect(health).not.toContain("NULLIF(view_name, '')");
    const cohort = cohortSessionsSql(
      s,
      id,
      { funnel: sessions, stepIndex: 1, side: "dropped" },
      0,
      opts,
    );
    expect(cohort).toContain("NULLIF(vn, '')");
    expect(cohort).not.toContain("NULLIF(view_name, '')");
  });

  it("Q14 paths carries vn", () => {
    const def = {
      anchor: { kind: "p" as const, key: "/web/logs" },
      direction: "next" as const,
      depth: 3,
      include: "all" as const,
      cohort: null,
    };
    const sql = pathsSql(s, null, def, opts);
    expect(sql).toContain("MIN(view_name) AS vn");
    expect(sql).toContain("NULLIF(vn, '')");
    expect(sql).not.toContain("NULLIF(view_name, '')");
  });

  it("Q23 features carries vn", () => {
    const events = [
      {
        id: "e0",
        app: "web",
        name: "E0",
        rules: [{ t: "view" as const, op: "eq" as const, value: "/web/logs" }],
        version: 1,
        createdBy: "",
        createdAt: 0,
        updatedBy: "",
        updatedAt: 0,
      },
    ];
    const sql = featuresSql(s, CS, id, events);
    expect(sql).toContain("MIN(view_name) AS vn");
    expect(sql).toContain("NULLIF(vn, '')");
    expect(sql).not.toContain("NULLIF(view_name, '')");
  });

  it("every builder still runs join-free with view_name in the schema", () => {
    const steps = [
      { kind: "p" as const, key: "/web" },
      { kind: "c" as const, key: "menu-link-/logs-item" },
      { kind: "p" as const, key: "/web/logs" },
    ];
    const def = { steps, unit: "sessions" as const, window: "session" as const, breakdown: null };
    for (const sql of [
      pagesSql(s, CS, id),
      entryExitSql(s, CS, id),
      stepPickerSql(s),
      funnelSql(s, id, def, opts),
      funnelPanelSql(s, def, opts),
      pathsSql(
        s,
        id,
        {
          anchor: { kind: "p", key: "/web" },
          direction: "next",
          depth: 3,
          include: "all",
          cohort: null,
        },
        opts,
      ),
      featuresSql(s, CS, id, [
        {
          id: "e0",
          app: "web",
          name: "E0",
          rules: [{ t: "view", op: "eq", value: "/web" }],
          version: 1,
          createdBy: "",
          createdAt: 0,
          updatedBy: "",
          updatedAt: 0,
        },
      ]),
    ]) {
      expect(() => assertJoinFree(sql)).not.toThrow();
    }
  });
});

// P5 (gap fixes, web SQL builders). Assumed scope fields: `exclusions` (§4.0), `xall`, `apps: string[]`,
// `appExclusions` (each compared app's settings by app id), `newSince` (new-users range start, ms).
describe("P5 gap fixes: SQL builders", () => {
  const FIELDS =
    "action_error_count action_id action_target_name action_type application_id date env error_id error_message error_type geo_info_city geo_info_country session_has_replay session_id session_type type user_agent_device_family user_agent_os_family user_agent_user_agent_family usr_email usr_name version view_error_count view_frustration_count view_id view_referrer view_time_spent view_url".split(
      " ",
    );
  const FULL: Record<string, boolean> = Object.fromEntries(FIELDS.map((f) => [f, true]));
  const BUILTIN = {
    version: 1,
    families: ["HeadlessChrome", "PhantomJS", "Spider"],
    devices: ["Spider"],
  };
  const FAMILY_HALF =
    "(user_agent_user_agent_family IS NULL OR user_agent_user_agent_family NOT IN ('HeadlessChrome', 'PhantomJS', 'Spider'))";
  const DEVICE_HALF =
    "(user_agent_device_family IS NULL OR user_agent_device_family NOT IN ('Spider'))";
  const BUILTIN_PRED = `${FAMILY_HALF} AND ${DEVICE_HALF}`;
  const STAFF = { field: "usr_email", op: "suffix", values: ["@openobserve.ai"] };
  const STAFF_XI =
    "MAX(CASE WHEN usr_email IS NOT NULL AND ends_with(usr_email, '@openobserve.ai') THEN 1 ELSE 0 END) AS xi";
  const STAFF_ROW = "(usr_email IS NULL OR NOT ends_with(usr_email, '@openobserve.ai'))";
  const COUNTRY = { field: "geo_info_country", op: "eq", values: ["XX"] };
  const COUNTRY_PRED = "(geo_info_country IS NULL OR geo_info_country <> 'XX')";
  const IGNORED = [
    { op: "eq", value: "/web/login" },
    { op: "eq", value: "/web/cb" },
  ];
  const IGN_K = "NOT (k IN ('/web/login', '/web/cb'))";
  type Rules = {
    bots?: boolean;
    builtinBots?: typeof BUILTIN;
    sessions?: unknown[];
    pages?: unknown[];
  };
  const rules = (r: Rules = {}) => ({
    bots: true,
    builtinBots: BUILTIN,
    sessions: [],
    pages: [],
    ...r,
  });
  const ruled = (
    r: Rules = {},
    patch: Record<string, unknown> = {},
    schema: Record<string, boolean> = FULL,
  ): AnalyticsScope =>
    ({
      app: "web",
      env: [],
      version: [],
      schema,
      exclusions: rules(r),
      ...patch,
    }) as AnalyticsScope;
  const noRules = (schema: Record<string, boolean> = FULL) => ruled({ bots: false }, {}, schema);
  const NEW = QUERIES as unknown as Record<string, (...args: unknown[]) => string>;
  const opts = { events: [] as NamedEvent[], sample: 1 as const };
  const id = { field: "usr_email" as const, excluded: [] };
  const p = (key: string, f?: Record<string, unknown>) =>
    ({ kind: "p", key, ...(f ? { f } : {}) }) as StepRefP5;
  type StepRefP5 = { kind: "p" | "c" | "e" | "r"; key: string; f?: Record<string, unknown> };
  type DefP5 = {
    steps: StepRefP5[];
    unit: "sessions" | "users";
    window: "session" | "1h" | "1d" | "7d";
    breakdown: string | null;
    x?: unknown[];
  };
  const fdef = (patch: Partial<DefP5> = {}) =>
    ({
      steps: [p("/web"), p("/web/logs"), p("/web/billings"), p("/web/settings")],
      unit: "sessions",
      window: "session",
      breakdown: null,
      ...patch,
    }) as unknown as Parameters<typeof funnelSql>[2];
  const BETWEEN = { step: p("/web/ingestion"), a: 2, b: 3 };
  const WITHIN = { step: p("/web/ingestion"), a: 2, withinMs: 1000 };
  const named = (rulesList: unknown[], eid = "ev1aaaaaaaaa"): NamedEvent =>
    ({
      id: eid,
      app: "web",
      name: "Ev",
      rules: rulesList,
      version: 1,
      createdBy: "",
      createdAt: 0,
      updatedBy: "",
      updatedAt: 0,
    }) as NamedEvent;
  const evStep = { kind: "e" as const, key: "ev1aaaaaaaaa" };

  // Returns one CTE's body by balanced parentheses, skipping quoted literals.
  const cte = (sql: string, name: string): string => {
    const m = new RegExp(`(?:^|WITH |\\n)${name} +AS \\(`).exec(sql);
    if (!m) return "";
    const start = m.index + m[0].length;
    let depth = 1;
    let quoted = false;
    for (let i = start; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === "'") quoted = !quoted;
      else if (!quoted && ch === "(") depth++;
      else if (!quoted && ch === ")" && --depth === 0) return sql.slice(start, i);
    }
    return sql.slice(start);
  };
  // Returns the select item aliased `alias`, walking back to its top-level comma.
  const item = (text: string, alias: string): string => {
    const m = new RegExp(` AS ${alias}(?=,| FROM|$)`).exec(text);
    if (!m) return "";
    let depth = 0;
    let quoted = false;
    for (let i = m.index - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === "'") quoted = !quoted;
      else if (!quoted && ch === ")") depth++;
      else if (!quoted && ch === "(") {
        if (depth === 0) return text.slice(i + 1, m.index).trim();
        depth--;
      } else if (!quoted && depth === 0 && ch === ",") return text.slice(i + 1, m.index).trim();
      if (!quoted && depth === 0 && text.slice(i, i + 7) === "SELECT ")
        return text.slice(i + 7, m.index).trim();
    }
    return text.slice(0, m.index).trim();
  };
  const scans = (sql: string) => sql.split('FROM "_rumdata"').length - 1;
  const tail = (sql: string) => sql.slice(sql.lastIndexOf("\n") + 1);

  describe("session exclusions (§4.1)", () => {
    it.each([
      ["eq", ["o'k"], "(geo_info_country IS NULL OR geo_info_country <> 'o''k')"],
      ["in", ["a", "b"], "(geo_info_country IS NULL OR geo_info_country NOT IN ('a', 'b'))"],
      ["prefix", ["v"], "(geo_info_country IS NULL OR NOT starts_with(geo_info_country, 'v'))"],
      ["suffix", ["v"], "(geo_info_country IS NULL OR NOT ends_with(geo_info_country, 'v'))"],
      ["contains", ["v"], "(geo_info_country IS NULL OR strpos(geo_info_country, 'v') = 0)"],
      ["regex", ["^v$"], "(geo_info_country IS NULL OR NOT regexp_like(geo_info_country, '^v$'))"],
    ])("P5-R2: a %s rule emits its NULL-safe predicate in scopeClause", (op, values, pred) => {
      const s = ruled({ bots: false, sessions: [{ field: "geo_info_country", op, values }] });
      expect(scopeClause(s)).toContain(pred);
    });

    it("P5-R2: every scopeClause caller carries the rule predicate", () => {
      const s = ruled({ bots: false, sessions: [COUNTRY] });
      const sqls = [
        pagesSql(s, CS, null),
        clicksSql(s, CS, null),
        entryExitSql(s, CS, null),
        stepPickerSql(s),
        trendSql(s, null, "1 day", "UTC", [], []),
        funnelSql(s, null, fdef(), opts),
        identityTopSql(s, "usr_email"),
        activeUsersSql(s, id, CS),
        featuresSql(s, CS, null, [named([{ t: "view", op: "eq", value: "/web" }])]),
        clickPagesSql(s, CS, ["save"]),
        nextStepsSql(s, null, fdef(), opts),
        pathsSql(
          s,
          null,
          { anchor: p("/web") as never, direction: "next", depth: 2, include: "all", cohort: null },
          opts,
        ),
        retentionSql(s, id, { start: null, ret: null, per: "week", mode: "on" }, [1, 2, 3], opts),
      ];
      for (const sql of sqls) expect(sql).toContain(COUNTRY_PRED);
    });

    it("P5-R3: bots on emits the §4.0 canonical built-in predicate verbatim; bots off emits none", () => {
      expect(scopeClause(ruled())).toBe(
        `application_id = 'web' AND session_id IS NOT NULL AND (session_type IS NULL OR session_type <> 'synthetics') AND ${BUILTIN_PRED}`,
      );
      expect(scopeClause(ruled({ bots: false }))).not.toContain("user_agent_");
    });

    it("P5-R3: the built-in predicate is built from the server's builtinBots list", () => {
      const s = ruled({ builtinBots: { version: 2, families: ["Foo", "Bar"], devices: ["Baz"] } });
      expect(scopeClause(s)).toContain(
        "(user_agent_user_agent_family IS NULL OR user_agent_user_agent_family NOT IN ('Foo', 'Bar')) AND (user_agent_device_family IS NULL OR user_agent_device_family NOT IN ('Baz'))",
      );
      expect(scopeClause(s)).not.toContain("HeadlessChrome");
    });

    it("P5-R4: each built-in half and each rule is gated on its field being in the schema", () => {
      const noDevice = { ...FULL, user_agent_device_family: false };
      const s = ruled(
        { sessions: [{ field: "geo_info_city", op: "eq", values: ["x"] }] },
        {},
        {
          ...noDevice,
          geo_info_city: false,
        },
      );
      const sql = scopeClause(s);
      expect(sql).toContain(FAMILY_HALF);
      expect(sql).not.toContain("user_agent_device_family");
      expect(sql).not.toContain("geo_info_city");
      const noFamily = { ...FULL, user_agent_user_agent_family: false };
      expect(scopeClause(ruled({}, {}, noFamily))).toContain(DEVICE_HALF);
      expect(scopeClause(ruled({}, {}, noFamily))).not.toContain("user_agent_user_agent_family");
    });

    it("P5-R5: xall reproduces the no-rules SQL byte-for-byte across builders", () => {
      const r = { sessions: [STAFF, COUNTRY] };
      const xall = ruled(r, { xall: true });
      const base = noRules();
      const builds: ((s: AnalyticsScope) => string)[] = [
        (s) => scopeClause(s),
        (s) => funnelSql(s, null, fdef(), opts),
        (s) => trendSql(s, null, "1 day", "UTC", [], []),
        (s) => clicksSql(s, CS, null),
        (s) =>
          retentionSql(s, id, { start: null, ret: null, per: "week", mode: "on" }, [1, 2, 3], opts),
      ];
      for (const b of builds) {
        expect(b(ruled(r))).not.toBe(b(base));
        expect(b(xall)).toBe(b(base));
      }
    });

    it("P5-R5: ignored pages still apply under xall", () => {
      const sql = pagesSql(
        ruled({ sessions: [COUNTRY], pages: IGNORED }, { xall: true }),
        CS,
        null,
      );
      expect(sql).toContain(IGN_K);
      expect(sql).not.toContain(COUNTRY_PRED);
      expect(sql).not.toContain("user_agent_");
    });

    it.each<[string, (s: AnalyticsScope) => string]>([
      ["funnelCtes", (s) => funnelSql(s, null, fdef(), opts)],
      ["fullChainCtes", (s) => nextStepsSql(s, null, fdef(), opts)],
      [
        "pathCtes",
        (s) =>
          pathsSql(
            s,
            null,
            {
              anchor: p("/web") as never,
              direction: "next",
              depth: 3,
              include: "all",
              cohort: null,
            },
            opts,
          ),
      ],
      ["pagesSql", (s) => pagesSql(s, CS, null)],
      ["entryExitSql", (s) => entryExitSql(s, CS, null)],
      [
        "featuresSql",
        (s) => featuresSql(s, CS, null, [named([{ t: "view", op: "eq", value: "/web" }])]),
      ],
      ["stepPickerSql", (s) => stepPickerSql(s)],
    ])(
      "P5-R6: %s runs the identity session pass in its first grouped CTE with a widened row filter",
      (_name, build) => {
        const sql = build(ruled({ bots: false, sessions: [STAFF] }));
        const first = sql.slice(0, sql.indexOf("\n"));
        expect(first).toContain(STAFF_XI);
        expect(first).toContain("OR usr_email IS NOT NULL");
        expect(sql).toContain("MAX(xi) OVER (PARTITION BY sid) AS xs");
        expect(sql).toContain("xs = 0");
        expect(sql).not.toContain(STAFF_ROW);
      },
    );

    it("P5-R6: both trendSql forms add a per-session group and filter xs = 0", () => {
      const s = ruled({ bots: false, sessions: [STAFF] });
      for (const sql of [
        trendSql(s, null, "1 day", "UTC", [], []),
        trendSql(s, null, "1 day", "UTC", [p("/web") as never], []),
      ]) {
        expect(sql).toContain(STAFF_XI);
        expect(sql).toContain("MAX(xi) OVER (PARTITION BY");
        expect(sql).toContain("xs = 0");
        expect(sql).not.toContain(STAFF_ROW);
      }
    });

    it("P5-R6: retentionCtes adds session_id to its first group for the session pass", () => {
      const s = ruled({ bots: false, sessions: [STAFF] });
      const sql = retentionSql(
        s,
        id,
        { start: null, ret: null, per: "week", mode: "on" },
        [1000, 2000, 3000],
        opts,
      );
      const a = cte(sql, "a");
      expect(a).toContain(STAFF_XI);
      expect(a.slice(a.lastIndexOf("GROUP BY"))).toContain("session_id");
      expect(sql).toContain("xs = 0");
    });

    it("P5-R7: identity rules use the row form only in clicks, click pages, active users and identity top", () => {
      const s = ruled({ bots: false, sessions: [STAFF] });
      for (const sql of [
        clicksSql(s, CS, null),
        clickPagesSql(s, CS, ["save"]),
        activeUsersSql(s, id, CS),
        identityTopSql(s, "usr_email"),
      ]) {
        expect(sql).toContain(STAFF_ROW);
        expect(sql).not.toContain(" AS xi");
      }
    });

    describe("P5-R8: summarySql flags", () => {
      const schema = { ...FULL, usr_id: true };
      const sql = summarySql(ruled({ sessions: [STAFF, COUNTRY] }, {}, schema), CS);
      const g = cte(sql, "g");
      const final = tail(sql);

      it("P5-R8: keeps every session in g and carries the rules as xb and xr flags", () => {
        const where = g.slice(g.indexOf("WHERE"));
        expect(where).not.toContain("user_agent_");
        expect(where).not.toContain(COUNTRY_PRED);
        expect(item(g, "xb")).toContain(BUILTIN_PRED);
        expect(item(g, "xr")).toContain(COUNTRY_PRED);
        expect(item(g, "xr")).toContain("ends_with(usr_email, '@openobserve.ai')");
      });

      it("P5-R8: returns sessions, prev_sessions, total_sessions and builtin_kept_sessions from the flags", () => {
        expect(item(final, "sessions")).toContain("xb = 0 AND xr = 0");
        expect(item(final, "prev_sessions")).toContain("xb = 0 AND xr = 0");
        expect(item(final, "total_sessions")).not.toMatch(/\bx[br] = 0/);
        expect(item(final, "builtin_kept_sessions")).toContain("xb = 0");
        expect(item(final, "builtin_kept_sessions")).not.toContain("xr = 0");
      });

      it("P5-R8: views is rule-filtered; synthetics, va_rows and data_through_us are not", () => {
        expect(item(final, "views")).toContain("xb = 0 AND xr = 0");
        for (const alias of ["synthetic_sessions", "va_rows", "data_through_us"])
          expect(item(final, alias)).not.toMatch(/\bx[br]\b/);
      });

      it("P5-R8: emits __values/__sessions for every present identity field from the gv CTE", () => {
        expect(cte(sql, "gv")).not.toBe("");
        for (const f of ["usr_id", "usr_email"]) {
          expect(item(final, `${f}__values`)).toContain("xb = 0 AND xr = 0");
          expect(item(final, `${f}__sessions`)).toContain("xb = 0 AND xr = 0");
        }
        expect(final).not.toContain("usr_anonymous_id__values");
        expect(scans(sql)).toBe(1);
        expect(() => assertJoinFree(sql)).not.toThrow();
      });

      it("a session counts as removed only when the views would drop every row of it", () => {
        expect(item(g, "xb")).toMatch(/^MIN\(CASE WHEN /);
        const country = item(cte(summarySql(ruled({ sessions: [COUNTRY] }), CS), "g"), "xr");
        expect(country).toMatch(/^MIN\(CASE WHEN /);
      });

      it("an identity rule still removes the whole session on any matching row, as sessionPass does", () => {
        const staff = item(
          cte(summarySql(ruled({ bots: false, sessions: [STAFF] }), CS), "g"),
          "xr",
        );
        expect(staff).toMatch(/^MAX\(CASE WHEN /);
        const both = item(g, "xr");
        expect(both).toContain("MIN(CASE WHEN ");
        expect(both).toContain("MAX(CASE WHEN ");
        expect(both).toMatch(/^CASE WHEN MIN\(.* = 1 OR MAX\(.* = 1 THEN 1 ELSE 0 END$/);
      });

      it("P5-R8: xb is constant 0 with bots off, and both flags are 0 under xall", () => {
        const off = cte(summarySql(ruled({ bots: false, sessions: [COUNTRY] }), CS), "g");
        expect(item(off, "xb")).toBe("0");
        expect(item(off, "xr")).toContain(COUNTRY_PRED);
        const all = cte(summarySql(ruled({ sessions: [STAFF, COUNTRY] }, { xall: true }), CS), "g");
        expect(item(all, "xb")).toBe("0");
        expect(item(all, "xr")).toBe("0");
      });
    });

    it("P5-R9: funnelAlertSql and funnelPanelSql emit the current rules' predicate", () => {
      const s = ruled({ sessions: [COUNTRY] });
      for (const sql of [
        funnelAlertSql(s, null, fdef(), 50, opts),
        funnelPanelSql(s, fdef(), opts),
      ]) {
        expect(sql).toContain(BUILTIN_PRED);
        expect(sql).toContain(COUNTRY_PRED);
      }
    });

    it("P5-R10: Q7_FUNNEL_EXCLUDED, with the version-1 device form and the widened row filter", () => {
      const s = ruled(
        {
          builtinBots: {
            version: 0,
            families: ["HeadlessChrome", "PhantomJS"],
            devices: ["Spider"],
          },
          sessions: [STAFF],
        },
        { app: "o2-prod-eu1" },
      );
      const def = fdef({ steps: [p("/web"), p("/web/billings/plans")] });
      const expected = (PROVEN as Record<string, string>).Q7_FUNNEL_EXCLUDED.replace(
        "user_agent_device_family <> 'Spider'",
        "user_agent_device_family NOT IN ('Spider')",
      ).replace(
        "AND (type = 'view') GROUP BY",
        "AND (type = 'view' OR usr_email IS NOT NULL) GROUP BY",
      );
      expect(funnelSql(s, null, def, opts)).toBe(expected);
    });

    it("P5-R11: userAgentSuggestionSql ranks top 15 family/device pairs over the scope without exclusions", () => {
      const s = ruled({ sessions: [COUNTRY, STAFF] });
      const sql = NEW.userAgentSuggestionSql(s);
      expect(sql).toContain("GROUP BY user_agent_user_agent_family, user_agent_device_family");
      expect(sql).toContain("COUNT(DISTINCT session_id) AS sessions");
      expect(sql).toContain("ORDER BY sessions DESC LIMIT 15");
      expect(sql).toContain(scopeClause(noRules()));
      expect(sql).not.toContain(FAMILY_HALF);
      expect(sql).not.toContain(COUNTRY_PRED);
      expect(sql).not.toContain("ends_with(usr_email");
    });
  });

  describe("ignored pages (§4.2)", () => {
    const pagesFull = [
      ...IGNORED,
      { op: "prefix", value: "/web/org/" },
      { op: "regex", value: "^/web/cb" },
    ];

    it("P5-R12: ignoredPagePredicate emits NOT (IN OR starts_with OR regexp_like) on the key", () => {
      const sql = pagesSql(ruled({ bots: false, pages: pagesFull }), CS, null);
      expect(sql).toContain(
        "NOT (k IN ('/web/login', '/web/cb') OR starts_with(k, '/web/org/') OR regexp_like(k, '^/web/cb'))",
      );
    });

    it("P5-R13: pagesSql filters ignored keys after computing the key and before the aggregate", () => {
      const sql = pagesSql(ruled({ bots: false, pages: IGNORED }), CS, null);
      expect(cte(sql, "g")).toContain(`FROM v WHERE k IS NOT NULL AND ${IGN_K} GROUP BY k`);
    });

    it("P5-R13: stepPickerSql filters ignored keys for page rows only", () => {
      const sql = stepPickerSql(ruled({ bots: false, pages: IGNORED }));
      expect(tail(sql)).toContain(
        "WHERE k IS NOT NULL AND k <> '' AND NOT (kind = 'p' AND (k IN ('/web/login', '/web/cb')))",
      );
    });

    it("P5-R13: pathTail drops ignored p: keys before the LAG dedup, NULL-safe in the attrs form", () => {
      const s = ruled({ bots: false, pages: IGNORED });
      const def = {
        anchor: p("/web") as never,
        direction: "next" as const,
        depth: 3,
        include: "all" as const,
        cohort: null,
      };
      const flow = pathsSql(s, null, def, opts);
      expect(flow).toContain(
        "d AS (SELECT *, LAG(key) OVER (PARTITION BY sid ORDER BY t, key) AS pk FROM e WHERE NOT (key IN ('p:/web/login', 'p:/web/cb')))",
      );
      const branch = branchSessionsSql(s, null, def, "s1 = 'p:/web'", 1, 0, opts);
      expect(cte(branch, "d")).toContain(
        "FROM e WHERE key IS NULL OR NOT (key IN ('p:/web/login', 'p:/web/cb'))",
      );
      const pre = pathsSql(
        ruled({ bots: false, pages: [{ op: "prefix", value: "/web/org/" }] }),
        null,
        def,
        opts,
      );
      expect(cte(pre, "d")).toContain("substr(key, 3)");
    });

    it("P5-R13: pathTail prefix and regex rules match the page text of p: keys only", () => {
      const def = {
        anchor: p("/web") as never,
        direction: "next" as const,
        depth: 3,
        include: "all" as const,
        cohort: null,
      };
      for (const rule of [
        { op: "prefix", value: "/web/org/" },
        { op: "regex", value: "^/web/cb" },
      ]) {
        const d = cte(pathsSql(ruled({ bots: false, pages: [rule] }), null, def, opts), "d");
        const where = d.includes(" WHERE ") ? d.slice(d.lastIndexOf(" WHERE ")) : "";
        expect(where).toContain("substr(key, 3)");
        expect(where).toContain(`'${rule.value}'`);
        expect(where).toContain("'p:'");
      }
    });

    it("P5-R13: A -> ignored -> A collapses to one A under the pathTail filter and LAG dedup", () => {
      const sql = pathsSql(
        ruled({ bots: false, pages: IGNORED }),
        null,
        { anchor: p("/web") as never, direction: "next", depth: 3, include: "all", cohort: null },
        opts,
      );
      const where = /FROM e WHERE NOT \(key IN \(([^)]*)\)\)/.exec(cte(sql, "d"));
      expect(where).not.toBeNull();
      const ignored = [...(where?.[1] ?? "").matchAll(/'([^']*)'/g)].map((m) => m[1]);
      const kept = ["p:/a", "p:/web/login", "p:/a"].filter((k) => !ignored.includes(k));
      const deduped = kept.filter((k, i) => i === 0 || kept[i - 1] !== k);
      expect(deduped).toEqual(["p:/a"]);
    });

    it("P5-R14: entryExitSql without identity is the per-view shape of the spike fixture", () => {
      const fixture = (PROVEN as Record<string, string>).Q6_ENTRY_EXIT_PER_VIEW;
      const cs = Number(/>= (\d+) THEN/.exec(fixture)?.[1]);
      const s = ruled({ bots: false }, { app: "o2-prod-eu1" });
      expect(entryExitSql(s, cs, null)).toBe(fixture);
      expect(
        entryExitSql(
          { ...s, exclusions: rules({ bots: false, pages: IGNORED }) } as AnalyticsScope,
          cs,
          null,
        ),
      ).toBe(
        fixture.replace(
          "v AS (SELECT * FROM v1 WHERE k IS NOT NULL)",
          `v AS (SELECT * FROM v1 WHERE k IS NOT NULL AND ${IGN_K})`,
        ),
      );
    });

    it("P5-R14: with identity, entryExitSql combines view and identity rows in v0 and filters xs = 0 AND vid IS NOT NULL", () => {
      const sql = entryExitSql(ruled({ bots: false, sessions: [STAFF], pages: IGNORED }), CS, id);
      const v0 = cte(sql, "v0");
      expect(v0).toContain("OR NULLIF(usr_email, '') IS NOT NULL");
      expect(v0).toContain(STAFF_XI);
      expect(v0).toContain(" AS u0");
      expect(cte(sql, "v")).toBe(
        `SELECT * FROM v1 WHERE xs = 0 AND vid IS NOT NULL AND k IS NOT NULL AND ${IGN_K}`,
      );
    });

    it("P5-R15: funnels never apply ignored pages", () => {
      const def = fdef({ steps: [p("/web/login"), p("/web")] });
      expect(funnelSql(ruled({ pages: IGNORED }), null, def, opts)).toBe(
        funnelSql(ruled(), null, def, opts),
      );
    });
  });

  describe("exclusion steps and step filters (§4.3)", () => {
    const s = ruled({ bots: false });

    it("P5-R16: a between-steps exclusion in the sid partition gates steps b and later on ex1 = 0", () => {
      const sql = funnelSql(s, null, fdef({ x: [BETWEEN] }), opts);
      const conds = "t, m1 = 1, m2 = 1, m3 = 1, m4 = 1";
      for (const frag of [
        "CASE WHEN ty = 'view' AND k = '/web/ingestion' THEN 1 ELSE 0 END AS mx1",
        `sequence_step_match(0, 2, ${conds}) OVER (PARTITION BY sid) AS va1`,
        `sequence_step_match(0, 3, ${conds}) OVER (PARTITION BY sid) AS vb1`,
        "MIN(CASE WHEN va1 THEN t END) OVER (PARTITION BY sid) AS ta1",
        "MIN(CASE WHEN vb1 THEN t END) OVER (PARTITION BY sid) AS tb1",
        "MAX(CASE WHEN mx1 = 1 AND t > ta1 AND t < tb1 THEN 1 ELSE 0 END) AS ex1",
        "CASE WHEN f[2] IS NOT NULL THEN 1 ELSE 0 END AS r2",
        "CASE WHEN f[3] IS NOT NULL AND ex1 = 0 THEN 1 ELSE 0 END AS r3",
        "CASE WHEN f[4] IS NOT NULL AND ex1 = 0 THEN 1 ELSE 0 END AS r4",
        "f[2] AS d2",
        "CASE WHEN ex1 = 0 THEN f[3] END AS d3",
        "CASE WHEN ex1 = 0 THEN f[4] END AS d4",
        "CASE WHEN f[3] IS NOT NULL AND ex1 = 1 THEN 1 ELSE 0 END AS xr1",
      ])
        expect(sql).toContain(frag);
      expect(sql).not.toContain("CASE WHEN ex1 = 0 THEN f[2] END");
    });

    it("P5-R17: Users pu counts xr1 only for users with no clean reach of step b", () => {
      const sql = funnelSql(s, id, fdef({ unit: "users", x: [BETWEEN] }), opts);
      expect(cte(sql, "pu")).toContain("CASE WHEN MAX(r3) = 0 THEN MAX(xr1) ELSE 0 END AS xr1");
    });

    it("P5-R17: the breakdown sums xr1 per dim", () => {
      const sql = funnelSql(s, null, fdef({ breakdown: "browser", x: [BETWEEN] }), opts);
      expect(tail(sql)).toContain("SUM(xr1)");
      expect(tail(sql)).toContain("GROUP BY dim");
    });

    it("P5-R17, P5-R18: the windowed Users path bounds the span and computes ex1/xr1 in su", () => {
      const sql = funnelSql(s, id, fdef({ unit: "users", window: "7d", x: [BETWEEN] }), opts);
      const part = "COALESCE(uid, 's:' || sid)";
      const conds = "t, m1 = 1, m2 = 1, m3 = 1, m4 = 1";
      expect(sql).toContain(
        `sequence_step_match(604800000, 2, ${conds}) OVER (PARTITION BY ${part}) AS va1`,
      );
      expect(sql).toContain(
        `sequence_step_match(604800000, 3, ${conds}) OVER (PARTITION BY ${part}) AS vb1`,
      );
      expect(sql).toContain(`MIN(CASE WHEN vb1 THEN t END) OVER (PARTITION BY ${part}) AS tb1`);
      expect(sql).toContain(
        `MAX(CASE WHEN va1 AND t < tb1 AND t >= tb1 - 604800000 THEN t END) OVER (PARTITION BY ${part}) AS ta1`,
      );
      expect(cte(sql, "su")).toContain(" AS ex1");
      expect(cte(sql, "su")).toContain("xr1");
      expect(cte(sql, "pu")).toContain("xr1");
    });

    it.each(["session", "7d"] as const)(
      "P5-R18: Users x2 (window %s) keeps exclusion rows and gains only the mx flags",
      (window) => {
        const steps = [p("/web"), p("/web/logs", { minMs: 1000 }), p("/web/billings")];
        const sql = funnelSql(s, id, fdef({ unit: "users", window, steps, x: [BETWEEN] }), opts);
        const x2 = cte(sql, "x2");
        expect(x2).toContain("OR mx1 = 1");
        const cols = x2.slice(0, x2.indexOf(" FROM "));
        expect(cols).toMatch(/\bmx1\b/);
        expect(cols).not.toContain("vts");
      },
    );

    it("two within exclusions on one step each lift only their own gate when counting removals", () => {
      const other = { step: p("/web/settings"), a: 2, withinMs: 2000 };
      const sql = funnelSql(s, null, fdef({ x: [WITHIN, other] }), opts);
      expect(sql).toContain(
        "CASE WHEN ty = 'view' AND k = '/web/logs' AND (nx2 IS NULL OR nx2 - t > 2000) THEN 1 ELSE 0 END AS ma1",
      );
      expect(sql).toContain(
        "CASE WHEN ty = 'view' AND k = '/web/logs' AND (nx1 IS NULL OR nx1 - t > 1000) THEN 1 ELSE 0 END AS ma2",
      );
    });

    it("P5-R19: a within-N exclusion gates step a with a NULL-safe flag over a RANGE frame and adds a count column", () => {
      const sql = funnelSql(s, null, fdef({ x: [WITHIN] }), opts);
      expect(sql).toContain(
        "x0f AS (SELECT *, CASE WHEN ty = 'view' AND k = '/web/ingestion' THEN 1 ELSE 0 END AS mx1 FROM x0)",
      );
      expect(sql).toContain(
        "MIN(CASE WHEN mx1 = 1 THEN t END) OVER (PARTITION BY sid ORDER BY t RANGE BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS nx1",
      );
      expect(sql).toContain(
        "CASE WHEN ty = 'view' AND k = '/web/logs' AND (nx1 IS NULL OR nx1 - t > 1000) THEN 1 ELSE 0 END AS m2",
      );
      const aliases = (q: string) => new Set([...tail(q).matchAll(/ AS (\w+)/g)].map((m) => m[1]));
      const plain = aliases(funnelSql(s, null, fdef(), opts));
      expect([...aliases(sql)].filter((a) => !plain.has(a)).length).toBeGreaterThan(0);
    });

    it("P5-R20: minMs adds vts to x00 and gates the page flag on nanoseconds", () => {
      const steps = [p("/web"), p("/web/logs", { minMs: 1000 })];
      const sql = funnelSql(s, null, fdef({ steps }), opts);
      expect(cte(sql, "x00")).toContain("MAX(view_time_spent) AS vts");
      expect(sql).toContain(
        "CASE WHEN ty = 'view' AND k = '/web/logs' AND vts >= 1000000000 THEN 1 ELSE 0 END AS m2",
      );
    });

    it("P5-R20: frustrated and errored filters read the per-view maxima; a funnel without filters gets none", () => {
      const fr = funnelSql(
        s,
        null,
        fdef({ steps: [p("/web"), p("/web/logs", { frustrated: true })] }),
        opts,
      );
      expect(fr).toContain("MAX(view_frustration_count) > 0");
      const er = funnelSql(
        s,
        null,
        fdef({ steps: [p("/web"), p("/web/logs", { errored: true })] }),
        opts,
      );
      expect(er).toContain("MAX(view_error_count) > 0");
      const none = funnelSql(s, null, fdef(), opts);
      for (const col of ["view_time_spent", "view_frustration_count", "view_error_count"])
        expect(none).not.toContain(col);
    });

    it("P5-R21: exclusion pages and clicks enter the scan, never the sequence conditions", () => {
      const page = funnelSql(s, null, fdef({ x: [BETWEEN] }), opts);
      expect(cte(page, "x0")).toContain("= '/web/ingestion'");
      const click = funnelSql(
        s,
        null,
        fdef({ x: [{ step: { kind: "c", key: "cancel-btn" }, a: 1, b: 2 }] }),
        opts,
      );
      expect(cte(click, "x00")).toContain("= 'cancel-btn'");
      for (const sql of [page, click]) {
        const calls = [...sql.matchAll(/sequence_step_(?:times|match)\(([^)]*)\)/g)];
        expect(calls.length).toBeGreaterThan(0);
        for (const c of calls) expect(c[1]).not.toContain("mx");
      }
      expect(page).toContain("sequence_step_times(0, t, m1 = 1, m2 = 1, m3 = 1, m4 = 1) AS f");
    });

    it.each<[string, (d: Parameters<typeof funnelSql>[2]) => string]>([
      ["nextStepsSql", (d) => nextStepsSql(s, null, d, opts)],
      [
        "dropoffNextSql",
        (d) => dropoffNextSql(s, null, { funnel: d, stepIndex: 3, side: "dropped" }, opts),
      ],
      ["dropoffHealthSql", (d) => dropoffHealthSql(s, null, d, 3, opts)],
      [
        "cohortSessionsSql",
        (d) => cohortSessionsSql(s, null, { funnel: d, stepIndex: 3, side: "dropped" }, 0, opts),
      ],
      [
        "cohort paths",
        (d) =>
          pathsSql(
            s,
            null,
            {
              anchor: null,
              direction: "next",
              depth: 2,
              include: "all",
              cohort: { funnel: d, stepIndex: 3, side: "dropped" },
            },
            opts,
          ),
      ],
    ])(
      "P5-R22: %s carries the exclusion flags, the ex1 gate, the step filters and error rows",
      (_n, build) => {
        const steps = [
          p("/web"),
          p("/web/logs", { minMs: 1000 }),
          p("/web/billings"),
          { kind: "r", key: "Failed to fetch billing info" } as StepRefP5,
        ];
        const sql = build(fdef({ steps, x: [BETWEEN] }));
        expect(sql).toContain(" AS mx1");
        expect(sql).toContain("ex1 = 0");
        expect(cte(sql, "xw")).not.toBe("");
        expect(cte(sql, "xrr")).not.toBe("");
        expect(sql).toContain("vts >= 1000000000");
        expect(sql.slice(0, sql.indexOf("\n"))).toContain(
          "starts_with(error_message, 'Failed to fetch billing info')",
        );
        expect(scans(sql)).toBe(1);
        expect(() => assertJoinFree(sql)).not.toThrow();
      },
    );

    it("P5-R23: funnelPanelSql carries the exclusion", () => {
      const sql = funnelPanelSql(s, fdef({ x: [BETWEEN] }), opts);
      expect(sql).toContain(" AS ex1");
      expect(sql).toContain("CASE WHEN f[3] IS NOT NULL AND ex1 = 0 THEN 1 ELSE 0 END AS r3");
    });

    it("P5-R23: funnelAlertSql carries the exclusion", () => {
      const sql = funnelAlertSql(s, null, fdef({ x: [BETWEEN] }), 50, opts);
      expect(sql).toContain(" AS ex1");
      expect(sql).toContain("CASE WHEN f[3] IS NOT NULL AND ex1 = 0 THEN 1 ELSE 0 END AS r3");
    });
  });

  describe("rule ops, error steps, compare apps, new users (§4.4-§4.10)", () => {
    const s = ruled({ bots: false });
    const PKV = pageKeyExpr("view_url", FULL);
    const PKU = pageKeyExpr("url", FULL);
    const CKA = clickKeyExpr("action_target_name");
    const PARAM = {
      t: "view",
      op: "param",
      name: "new_user_login",
      value: "true",
      onPage: "/web/cb",
    };
    const REF = { t: "view", op: "ref", value: "checkout.stripe.com" };
    const REF_RE = String.raw`'^https?://([^/]*\.)?checkout\.stripe\.com(/|:|$)'`;

    it("P5-R24: param and ref rules emit the §4.4 raw and grouped predicates", () => {
      const ev = [named([PARAM, REF])];
      const raw = stepPredicateRaw(evStep, s, ev);
      expect(raw).toContain(
        `(type = 'view' AND strpos(view_url, 'new_user_login=') > 0 AND regexp_like(view_url, '[?#&]new_user_login=true(&|#|$)') AND ${PKV} = '/web/cb')`,
      );
      expect(raw).toContain(
        `(type = 'view' AND strpos(view_referrer, 'checkout.stripe.com') > 0 AND regexp_like(view_referrer, ${REF_RE}))`,
      );
      const grouped = stepPredicateGrouped(evStep, s, ev);
      expect(grouped).toContain(
        `(ty = 'view' AND regexp_like(url, '[?#&]new_user_login=true(&|#|$)') AND ${PKU} = '/web/cb')`,
      );
      expect(grouped).toContain(`(ty = 'view' AND regexp_like(ref, ${REF_RE}))`);
    });

    it("P5-R24: values are regex-escaped then quote-escaped; a param without a value matches its name alone", () => {
      expect(NEW.escapeRegex("a.b?c")).toBe(String.raw`a\.b\?c`);
      const esc = stepPredicateRaw(evStep, s, [
        named([{ t: "view", op: "param", name: "q.x", value: "it's?" }]),
      ]);
      expect(esc).toContain(String.raw`regexp_like(view_url, '[?#&]q\.x=it''s\?(&|#|$)')`);
      const bare = stepPredicateGrouped(evStep, s, [
        named([{ t: "view", op: "param", name: "new_user_login" }]),
      ]);
      expect(bare).toContain("regexp_like(url, '[?#&]new_user_login(=|&|#|$)')");
    });

    it("P5-R25: param rules carry url and ref rules carry view_referrer through funnel, chain, features and trend", () => {
      const def = fdef({ steps: [p("/web"), evStep] });
      const paramEv = [named([{ ...PARAM, onPage: undefined }])];
      const pf = funnelSql(s, null, def, { events: paramEv, sample: 1 });
      expect(cte(pf, "x0").slice(0, cte(pf, "x0").indexOf(" FROM "))).toMatch(/, url\b/);
      const refEv = [named([REF])];
      for (const sql of [
        funnelSql(s, null, def, { events: refEv, sample: 1 }),
        nextStepsSql(s, null, def, { events: refEv, sample: 1 }),
        featuresSql(s, CS, null, refEv),
      ]) {
        expect(sql).toContain("MIN(view_referrer) AS ref");
        expect(sql).toContain(`regexp_like(ref, ${REF_RE})`);
      }
      expect(trendSql(s, null, "1 day", "UTC", [evStep], refEv)).toContain(
        `regexp_like(view_referrer, ${REF_RE})`,
      );
    });

    it("P5-R26: click prefix, contains and regex ops emit the §4.5 predicates", () => {
      const ev = [
        named([
          { t: "action", op: "prefix", value: "o2-table-expand-" },
          { t: "action", op: "contains", value: "copy-btn" },
          { t: "action", op: "regex", value: "-copy-btn$" },
        ]),
      ];
      const raw = stepPredicateRaw(evStep, s, ev);
      expect(raw).toContain(
        `(type = 'action' AND action_target_name <> '' AND strpos(action_target_name, 'o2-table-expand-') > 0 AND starts_with(${CKA}, 'o2-table-expand-'))`,
      );
      expect(raw).toContain(`strpos(${CKA}, 'copy-btn') > 0`);
      expect(raw).toContain(`regexp_like(${CKA}, '-copy-btn$')`);
      expect(stepPredicateGrouped(evStep, s, ev)).toContain(
        "(ty = 'action' AND starts_with(k, 'o2-table-expand-'))",
      );
    });

    it("P5-R26: the strpos prefilter is dropped when the value holds a mask token", () => {
      const raw = stepPredicateRaw(evStep, s, [
        named([{ t: "action", op: "prefix", value: "row-:num-" }]),
      ]);
      expect(raw).toContain(`starts_with(${CKA}, 'row-:num-')`);
      expect(raw).not.toContain("strpos(action_target_name,");
    });

    const ERR = "Failed to fetch billing info";
    const errStep = { kind: "r", key: ERR } as never;

    it("P5-R27: an error step brings error rows into x00 and x0 and flags them on em", () => {
      const sql = funnelSql(s, null, fdef({ steps: [p("/web"), errStep] }), opts);
      const x00 = cte(sql, "x00");
      expect(x00).toContain(`(type = 'error' AND starts_with(error_message, '${ERR}'))`);
      expect(x00).toContain("MIN(error_message) AS em");
      expect(x00).toContain("WHEN type = 'error' THEN CAST(date AS VARCHAR)");
      const x0 = cte(sql, "x0");
      expect(x0.slice(0, x0.indexOf(" FROM "))).toMatch(/\bem\b/);
      expect(x0.slice(x0.indexOf(" WHERE "))).toContain("ty = 'error'");
      expect(sql).toContain(
        `CASE WHEN ty = 'error' AND starts_with(em, '${ERR}') THEN 1 ELSE 0 END AS m2`,
      );
      expect(funnelSql(s, null, fdef(), opts)).not.toContain(" AS em");
    });

    it("P5-R27: the r step predicates, Paths and Retention anchors match on the message prefix", () => {
      expect(stepPredicateRaw(errStep, s, [])).toContain(
        `type = 'error' AND starts_with(error_message, '${ERR}')`,
      );
      expect(stepPredicateGrouped(errStep, s, [])).toContain(
        `ty = 'error' AND starts_with(em, '${ERR}')`,
      );
      const paths = pathsSql(
        s,
        null,
        { anchor: errStep, direction: "next", depth: 2, include: "all", cohort: null },
        opts,
      );
      expect(paths).toContain(`starts_with(error_message, '${ERR}')`);
      const ret = retentionSql(
        s,
        id,
        { start: errStep, ret: null, per: "week", mode: "on" },
        [1000, 2000, 3000],
        opts,
      );
      expect(ret).toContain(`starts_with(error_message, '${ERR}')`);
    });

    it("P5-R27: an error rule on a named event brings error rows into the scan", () => {
      const ev = [named([{ t: "error", op: "prefix", value: "Failed" }])];
      const x00 = cte(
        funnelSql(s, null, fdef({ steps: [p("/web"), evStep] }), { events: ev, sample: 1 }),
        "x00",
      );
      expect(x00).toContain("type = 'error'");
      expect(x00).toContain("error_message");
    });

    it("P5-R28: errorPickerSql lists the top 50 message prefixes by sessions, with an escaped search term", () => {
      expect(NEW.errorPickerSql(s)).toBe(
        `SELECT substr(error_message, 1, 120) AS k, COUNT(DISTINCT session_id) AS sessions FROM "_rumdata" WHERE ${scopeClause(s)} AND type = 'error' GROUP BY 1 ORDER BY sessions DESC LIMIT 50`,
      );
      expect(NEW.errorPickerSql(s, "Fe'tch")).toContain(
        "AND strpos(lower(error_message), 'fe''tch') > 0",
      );
    });

    it("P5-R29: stepPickerSql reads MIN(action_type) AS at", () => {
      expect(stepPickerSql(s)).toContain("MIN(action_type) AS at");
    });

    describe("P5-R30: compare apps", () => {
      const b = rules({
        bots: false,
        sessions: [{ field: "usr_email", op: "suffix", values: ["@b.io"] }],
      });
      const sa = ruled(
        { sessions: [STAFF], pages: IGNORED },
        { apps: ["b"], appExclusions: { b } },
      );

      it("P5-R30: scopeClause lists every app and ORs each app's row rules, an empty branch as the app alone", () => {
        const sql = scopeClause(sa);
        expect(sql).toMatch(/application_id IN \(('web', 'b'|'b', 'web')\)/);
        expect(sql).toContain(
          `((application_id = 'web' AND ${BUILTIN_PRED}) OR application_id = 'b')`,
        );
      });

      it("P5-R30: identity rules become one flag per app in a single MAX(CASE)", () => {
        expect(funnelSql(sa, null, fdef(), opts)).toContain(
          "MAX(CASE WHEN application_id = 'web' AND usr_email IS NOT NULL AND ends_with(usr_email, '@openobserve.ai') THEN 1 WHEN application_id = 'b' AND usr_email IS NOT NULL AND ends_with(usr_email, '@b.io') THEN 1 ELSE 0 END) AS xi",
        );
      });

      it("P5-R30: the first grouped CTE carries the app and applies each app's ignored pages", () => {
        const sql = pagesSql(sa, CS, null);
        expect(cte(sql, "v0")).toContain("MIN(application_id) AS app");
        expect(sql).toContain(`((app = 'web' AND ${IGN_K}) OR app = 'b')`);
      });
    });

    it("P5-R31: a named-event step under compared apps uses the primary app's definition once", () => {
      const ev = [named([{ t: "view", op: "eq", value: "/web/only-primary" }])];
      const def = fdef({ steps: [p("/web"), evStep] });
      const o = { events: ev, sample: 1 as const };
      const single = funnelSql(s, null, def, o);
      const compared = funnelSql(
        ruled({ bots: false }, { apps: ["b"], appExclusions: { b: rules({ bots: false }) } }),
        null,
        def,
        o,
      );
      const count = (q: string) => q.split("'/web/only-primary'").length - 1;
      expect(compared).toMatch(/application_id IN \(/);
      expect(count(compared)).toBe(count(single));
      const flag = item(cte(compared, "x1"), "m2");
      expect(flag).toContain("'/web/only-primary'");
      expect(flag).not.toContain("app");
    });

    it("P5-R31: DIMENSIONS gains app, so a funnel breaks down by application_id", () => {
      expect((QUERIES.DIMENSIONS as Record<string, string>).app).toBe("application_id");
      const sql = funnelSql(s, null, fdef({ breakdown: "app" }), opts);
      expect(cte(sql, "x00")).toContain("MIN(application_id) AS dim");
    });

    it("P5-R32: new users keep only units first seen on or after the range start", () => {
      const RS = 1788000000000;
      const sn = ruled({ bots: false }, { newSince: RS });
      const sql = funnelSql(sn, id, fdef({ unit: "users", window: "7d" }), opts);
      expect(cte(sql, "x00")).toContain("MIN(date) AS t0");
      expect(sql).toContain(
        "fs AS (SELECT *, MIN(t0) OVER (PARTITION BY COALESCE(uid, 's:' || sid)) AS first_t FROM x1)",
      );
      expect(cte(sql, "x2")).toContain(`first_t >= ${RS}`);
      const paths = pathsSql(
        sn,
        id,
        { anchor: p("/web") as never, direction: "next", depth: 2, include: "all", cohort: null },
        opts,
      );
      expect(paths).toContain(`>= ${RS}`);
      const WEEK_US = 7 * 86400000000;
      const weeks = [0, 1, 2].map((i) => RS * 1000 + i * WEEK_US);
      const ret = retentionSql(
        sn,
        id,
        { start: null, ret: null, per: "week", mode: "on" },
        weeks,
        opts,
      );
      expect(ret).toContain(`>= ${RS}`);
      expect(ret).toContain(`WHEN _timestamp < ${weeks[0]} THEN -1`);
      expect(ret).toContain("p >= 0");
      // A first column opening before the range start judges newness from that column.
      const early = [RS * 1000 - WEEK_US / 2, RS * 1000 + WEEK_US / 2];
      const retEarly = retentionSql(
        sn,
        id,
        { start: null, ret: null, per: "week", mode: "on" },
        early,
        opts,
      );
      expect(retEarly).toContain(`first_t >= ${early[0] / 1000}`);
    });

    it("retention without new users keeps every row's period", () => {
      const ret = retentionSql(
        ruled({ bots: false }),
        id,
        { start: null, ret: null, per: "week", mode: "on" },
        [1000, 2000, 3000],
        opts,
      );
      expect(ret).not.toContain("THEN -1");
      expect(ret).not.toContain("p >= 0");
    });

    it("P5-R34: namedEventPreviewSql applies the scope's exclusions", () => {
      const sql = NEW.namedEventPreviewSql(
        ruled({ sessions: [COUNTRY] }),
        named([{ t: "view", op: "eq", value: "/web" }]),
      );
      expect(sql).toContain(BUILTIN_PRED);
      expect(sql).toContain(COUNTRY_PRED);
    });

    it("P5-R32: the new-users search range starts 30 days before the selected start", () => {
      const DAY = 86400000000;
      const range = { startUs: 1790000000000000, endUs: 1790600000000000 };
      const widened = (
        MODEL as unknown as Record<string, (r: typeof range) => typeof range>
      ).newUsersSearchRange(range);
      expect(widened).toEqual({ startUs: range.startUs - 30 * DAY, endUs: range.endUs });
    });

    it("P5-R33: unnamedClicksSql counts container-named clicks per page, top 20", () => {
      expect(NEW.unnamedClicksSql(s)).toBe(
        `SELECT ${PKV} AS pg, COUNT(*) AS clicks, COUNT(CASE WHEN regexp_like(action_target_name, '-(page|content|dialog|layout|container|panel|wrapper|section)$') THEN 1 END) AS unnamed FROM "_rumdata" WHERE ${scopeClause(s)} AND type = 'action' AND action_target_name <> '' GROUP BY 1 ORDER BY unnamed DESC LIMIT 20`,
      );
    });
  });

  it("P5-R10: every builder with rules reads _rumdata once and passes assertJoinFree", () => {
    const s = ruled({ sessions: [STAFF, COUNTRY], pages: IGNORED });
    const ev = [
      named([
        { t: "view", op: "param", name: "q", value: "1" },
        { t: "view", op: "ref", value: "x.com" },
        { t: "action", op: "prefix", value: "btn-" },
        { t: "error", op: "contains", value: "boom" },
      ]),
    ];
    const o = { events: ev, sample: 1 as const };
    const steps = [p("/web"), p("/web/logs", { minMs: 1000 }), evStep, { kind: "r", key: "boom" }];
    const defs = (["session", "7d"] as const).flatMap((window) =>
      (["sessions", "users"] as const).map((unit) =>
        fdef({ steps: steps as never, unit, window, x: [BETWEEN, WITHIN] }),
      ),
    );
    const path = {
      anchor: p("/web") as never,
      direction: "next" as const,
      depth: 3,
      include: "all" as const,
      cohort: null,
    };
    const ret = { start: p("/web") as never, ret: null, per: "week" as const, mode: "on" as const };
    const sqls = [
      summarySql(s, CS),
      identityTopSql(s, "usr_email"),
      entryExitSql(s, CS, id),
      stepPickerSql(s),
      pagesSql(s, CS, id),
      clicksSql(s, CS, id),
      clickPagesSql(s, CS, ["a"]),
      trendSql(s, id, "1 day", "UTC", [], []),
      trendSql(s, id, "1 day", "UTC", [p("/web") as never], o.events),
      activeUsersSql(s, id, CS),
      featuresSql(s, CS, id, ev),
      pathsSql(s, id, path, o),
      branchSessionsSql(s, id, path, "s1 = 'p:/web'", 1, 0, o),
      retentionSql(s, id, ret, [1, 2, 3], o),
      retentionCellUsersSql(s, id, ret, [1, 2, 3], 0, 1, o),
      NEW.errorPickerSql(s),
      NEW.unnamedClicksSql(s),
      ...defs.flatMap((d) => [
        funnelSql(s, id, d, o),
        funnelPanelSql(s, d, o),
        funnelAlertSql(s, id, d, 50, o),
        nextStepsSql(s, id, d, o),
        dropoffHealthSql(s, id, d, 2, o),
        cohortSessionsSql(s, id, { funnel: d, stepIndex: 2, side: "dropped" }, 0, o),
      ]),
    ];
    for (const sql of sqls) {
      expect(scans(sql)).toBe(1);
      expect(() => assertJoinFree(sql)).not.toThrow();
    }
  });
});

describe("paths drawer user label (o2-enterprise#2851)", () => {
  const s = scope({
    schema: {
      action_id: true,
      usr_email: true,
      session_has_replay: true,
      action_target_name: true,
    },
  });
  const id = { field: "usr_email" as const, excluded: ["bot@x.com"] };
  const u = identityExpr(id);
  const events: NamedEvent[] = [
    {
      id: "ev",
      app: "web",
      name: "E",
      rules: [{ t: "view", op: "prefix", value: "/web/l" }],
      version: 1,
      createdBy: "",
      createdAt: 0,
      updatedBy: "",
      updatedAt: 0,
    },
  ];
  const opts = { events, sample: 1 as const };
  const base = {
    anchor: { kind: "p" as const, key: "/web/logs" },
    direction: "next" as const,
    depth: 3,
    include: "all" as const,
    cohort: null,
  };
  const funnel = {
    steps: [
      { kind: "p" as const, key: "/a" },
      { kind: "c" as const, key: "b" },
    ],
    unit: "sessions" as const,
    window: "session" as const,
    breakdown: null,
  };
  const anchors = {
    page: base,
    click: { ...base, anchor: { kind: "c" as const, key: "menu-link-/logs-item" } },
    event: { ...base, anchor: { kind: "e" as const, key: "ev" } },
  };
  const cohorts = {
    sessions: { ...base, anchor: null, cohort: { funnel, stepIndex: 1, side: "dropped" as const } },
    users: {
      ...base,
      anchor: null,
      cohort: {
        funnel: { ...funnel, unit: "users" as const, window: "1d" as const },
        stepIndex: 1,
        side: "dropped" as const,
      },
    },
  };
  const all = { ...anchors, ...cohorts };
  const branch = (i: typeof id | null, d: PathsDef, o: BuildOpts = opts) =>
    branchSessionsSql(s, i, d, "TRUE", 1, 0, o);
  const projection = (sql: string) => sql.split("\n").at(-1)!.split(" FROM ")[0];
  const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mask = (sql: string) =>
    sql.replace(/'(?:[^']|'')*'/g, (m) => `'${"x".repeat(m.length - 2)}'`);
  const unwrap = (x: string): string => {
    const t = x.trim();
    const m = mask(t);
    if (!m.startsWith("(")) return t;
    let depth = 0;
    for (let i = 0; i < m.length; i++) {
      depth += m[i] === "(" ? 1 : m[i] === ")" ? -1 : 0;
      if (depth === 0) return i === m.length - 1 ? unwrap(t.slice(1, -1)) : t;
    }
    return t;
  };
  const splitTop = (x: string, sep: string): string[] => {
    const m = mask(x);
    const out: string[] = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < m.length; i++) {
      if (depth === 0 && m.startsWith(sep, i)) {
        out.push(x.slice(from, i));
        from = i + sep.length;
        i += sep.length - 1;
        continue;
      }
      depth += m[i] === "(" ? 1 : m[i] === ")" ? -1 : 0;
    }
    out.push(x.slice(from));
    return out;
  };
  const whereClauses = (sql: string): { at: number; text: string }[] => {
    const m = mask(sql);
    const out: { at: number; text: string }[] = [];
    for (const w of m.matchAll(/\bWHERE /g)) {
      const start = w.index! + 6;
      let depth = 0;
      let i = start;
      for (; i < m.length; i++) {
        depth += m[i] === "(" ? 1 : m[i] === ")" ? -1 : 0;
        if (depth < 0 || (depth === 0 && /^ (?:GROUP BY|ORDER BY|LIMIT) /.test(m.slice(i, i + 10))))
          break;
      }
      out.push({ at: w.index!, text: sql.slice(start, i) });
    }
    return out;
  };
  const scanClause = (sql: string) =>
    whereClauses(sql).find((w) => sql.slice(0, w.at).endsWith('FROM "_rumdata" '));
  const outsideUidSelect = (sql: string, at: number): boolean => {
    const m = mask(sql);
    const uid = m.lastIndexOf(`${UID} AS uid`, at);
    if (uid < 0) return false;
    let depth = 0;
    for (const ch of m.slice(uid, at)) {
      depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
      if (depth < 0) return true;
    }
    return false;
  };
  const rowFilters = (sql: string) => {
    const d = sql.indexOf("\nd AS (");
    const scan = scanClause(sql);
    return whereClauses(sql).filter((w) => w.at < d && w.at !== scan?.at);
  };
  const conjuncts = (text: string): string[] | null =>
    splitTop(text, " OR ").length > 1 ? null : splitTop(text, " AND ").map(unwrap);
  const identityAdmitted = (sql: string, scopeSql: string, idExpr: string): boolean => {
    const scan = scanClause(sql);
    if (!scan || !scan.text.startsWith(`${scopeSql} AND `)) return false;
    const rest = scan.text.slice(scopeSql.length + 5);
    if (unwrap(rest) === rest.trim() || splitTop(scan.text, " OR ").length > 1) return false;
    return splitTop(unwrap(rest), " OR ").some((p) => p.trim() === `${idExpr} IS NOT NULL`);
  };
  // Identity-only rows must be dropped after the uid window and before d, or a NULL key breaks the LAG dedup.
  const pathRowFilterProblem = (sql: string, types: string): string | null => {
    const e = escRe(types);
    const flag = new RegExp(
      `CASE WHEN (?:${e}|\\(${e}\\)) THEN 1(?: ELSE 0)? END\\)? AS (\\w+)`,
    ).exec(sql);
    if (!flag) return "the Sankey row predicate is not kept as a per-row flag";
    const test = new RegExp(`^${flag[1]} (?:= 1|> 0|IS NOT NULL)$`);
    const ok = rowFilters(sql).some(
      (w) => conjuncts(w.text)?.some((c) => test.test(c)) && outsideUidSelect(sql, w.at),
    );
    return ok ? null : "no WHERE drops non-path rows outside the uid window and before d";
  };
  const CLICK_COL = "(?:k|atn)";
  const NON_EMPTY = `(?:COALESCE\\(${CLICK_COL}, ''\\) <> ''|${CLICK_COL} <> ''|NULLIF\\(${CLICK_COL}, ''\\) IS NOT NULL|LENGTH\\(${CLICK_COL}\\) > 0)`;
  const EMPTY_GUARD = new RegExp(
    [
      `^${NON_EMPTY}$`,
      `^ty <> 'action' OR ${NON_EMPTY}$`,
      `^NOT \\(ty = 'action' AND \\((?:${CLICK_COL} = '' OR ${CLICK_COL} IS NULL|${CLICK_COL} IS NULL OR ${CLICK_COL} = '')\\)\\)$`,
      `^NOT \\(ty = 'action' AND COALESCE\\(${CLICK_COL}, ''\\) = ''\\)$`,
    ].join("|"),
  );
  const hasEmptyClickGuard = (sql: string): boolean =>
    rowFilters(sql).some((w) => conjuncts(w.text)?.some((c) => EMPTY_GUARD.test(c)));
  const pathWhereClauses = (sql: string): string[] => rowFilters(sql).map((w) => w.text);
  const UID =
    "FIRST_VALUE(u0) OVER (PARTITION BY sid ORDER BY CASE WHEN u0 IS NULL THEN 1 ELSE 0 END, ut)";

  it.each(Object.entries(anchors))(
    "R1: the %s-anchored drawer selects user_label, with or without an identity",
    (_, d) => {
      expect(projection(branch(null, d))).toMatch(/\buser_label\b/);
      expect(projection(branch(id, d))).toMatch(/\buser_label\b/);
    },
  );

  it.each(Object.entries(cohorts))(
    "R2: the %s-unit funnel-cohort drawer selects user_label, with or without an identity",
    (_, d) => {
      expect(projection(branch(null, d))).toMatch(/\buser_label\b/);
      expect(projection(branch(id, d))).toMatch(/\buser_label\b/);
    },
  );

  it.each(Object.entries(all))(
    "R3: the %s drawer labels a session with its first non-excluded identity value",
    (_, d) => {
      const sql = branch(id, d);
      expect(sql).toContain(
        `first_value(${u} ORDER BY CASE WHEN ${u} IS NULL THEN 1 ELSE 0 END, date) AS u0`,
      );
      expect(sql).toContain(`MIN(CASE WHEN ${u} IS NOT NULL THEN date END) AS ut`);
      expect(sql).toContain("IN ('bot@x.com') THEN NULL");
      expect(sql).toContain(`${UID} AS uid`);
      expect(sql).toContain("MAX(uid) AS user_label");
      expect(sql).not.toContain("CAST(NULL AS VARCHAR) AS user_label");
    },
  );

  it.each(["all", "pages", "clicks"] as const)(
    "R4: an anchored drawer under include %s also reads identity from rows outside the path filter",
    (include) => {
      for (const d of Object.values(anchors)) {
        expect(identityAdmitted(branch(id, { ...d, include }), scopeClause(s), u)).toBe(true);
      }
    },
  );

  it.each(Object.entries(all))(
    "R5: without an identity the %s drawer labels every session NULL and reads no identity",
    (_, d) => {
      const sql = branch(null, d);
      expect(sql).toContain("CAST(NULL AS VARCHAR) AS user_label");
      expect(sql).not.toContain("usr_email");
      expect(sql).not.toContain(UID);
    },
  );

  it("R5: without an identity the cohort drawer is unchanged apart from user_label", () => {
    const sql = branchSessionsSql(s, null, cohorts.sessions, "s1 = 'x'", 1, 0, opts);
    expect(norm(withoutNullLabel(sql), s)).toBe(norm(PATHS.BRANCH_COHORT_SESSIONS, s));
  });

  for (const [name, d] of Object.entries(anchors)) {
    it.each(["all", "pages", "clicks"] as const)(
      `R6: identity-only rows of the ${name}-anchored drawer under include %s never become path steps`,
      (include) => {
        const dd = { ...d, include };
        const head = `${scopeClause(s)} AND `;
        const plain = scanClause(branch(null, dd))?.text ?? "";
        expect(plain.startsWith(head)).toBe(true);
        expect(pathRowFilterProblem(branch(id, dd), plain.slice(head.length))).toBeNull();
      },
    );
  }

  it("R6: drawer sampling still applies with an identity", () => {
    for (const d of [anchors.page, cohorts.sessions]) {
      expect(branch(id, d, { events, sample: 2 })).toContain(scopeClause(s, 2));
    }
  });

  it.each(Object.entries(all))(
    "R7: the %s Sankey query is byte-identical to its pre-#2851 output",
    (name, d) => {
      const fixture: Record<string, string> = {
        page: PATHS.PATHS_ANCHOR_PAGE,
        click: PATHS.PATHS_ANCHOR_CLICK,
        event: PATHS.PATHS_ANCHOR_EVENT,
        sessions: PATHS.PATHS_COHORT_SESSIONS,
        users: PATHS.PATHS_COHORT_USERS,
      };
      expect(norm(pathsSql(s, id, d, opts), s)).toBe(norm(fixture[name], s));
    },
  );

  it.each(Object.entries(anchors))(
    "R7: the %s-anchored Sankey query ignores the identity",
    (_, d) => {
      expect(pathsSql(s, id, d, opts)).toBe(pathsSql(s, null, d, opts));
    },
  );

  it.each(Object.entries(all))(
    "R8: the %s drawer with an identity reads _rumdata once, join-free",
    (_, d) => {
      expect(() => assertJoinFree(branch(id, d))).not.toThrow();
      expect(() => assertJoinFree(branch(id, d, { events, sample: 4 }))).not.toThrow();
    },
  );

  it("R9: a sessions-unit cohort drawer never turns an identity-only, unnamed click into a c: step", () => {
    const sql = branch(id, cohorts.sessions);
    expect(sql).toContain(UID);
    expect(hasEmptyClickGuard(sql)).toBe(true);
  });

  it("R6: the users-unit cohort drawer filters path rows exactly as the Sankey does", () => {
    const flow = pathWhereClauses(pathsSql(s, id, cohorts.users, opts)).map((w) =>
      w.replace("ty IN ('view', 'action')", "(ty IN ('view', 'action') OR ty = 'error')"),
    );
    expect(pathWhereClauses(branch(id, cohorts.users))).toEqual(flow);
  });
});
