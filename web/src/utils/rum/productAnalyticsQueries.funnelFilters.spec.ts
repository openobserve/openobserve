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
  cohortSessionsSql,
  dropoffHealthSql,
  dropoffNextSql,
  filterValuesSql,
  funnelPanelSql,
  funnelSql,
  nextStepsSql,
  pathsSql,
  storedFunnelScope,
  whyEnteredSql,
  type AnalyticsScope,
  type FunnelDef,
  type FunnelFilter,
  type StepRef,
  type ViewCond,
} from "@/utils/rum/productAnalyticsQueries";
import type { AppExclusions } from "@/utils/rum/productAnalyticsModel";

const FIELDS =
  "action_id action_target_name application_id date env error_message geo_info_city geo_info_country session_id session_type type user_agent_device_family user_agent_os_family user_agent_user_agent_family usr_email usr_id version view_id view_referrer view_url".split(
    " ",
  );
const FULL: Record<string, boolean> = Object.fromEntries(FIELDS.map((f) => [f, true]));
const NO_RULES: AppExclusions = {
  bots: false,
  builtinBots: { version: 1, families: [], devices: [] },
  sessions: [],
  pages: [],
};
const scope = (patch: Partial<AnalyticsScope> = {}): AnalyticsScope => ({
  app: "web",
  env: [],
  version: [],
  schema: FULL,
  exclusions: NO_RULES,
  ...patch,
});
const opts = { events: [], sample: 1 as const };
const id = { field: "usr_email" as const, excluded: [] };
const p = (key: string, f?: StepRef["f"]): StepRef => ({ kind: "p", key, ...(f ? { f } : {}) });
const fdef = (patch: Partial<FunnelDef> = {}): FunnelDef => ({
  steps: [p("/a"), p("/b"), p("/c")],
  unit: "sessions",
  window: "session",
  breakdown: null,
  ...patch,
});
const COUNTRY: FunnelFilter = { field: "geo_info_country", op: "in", values: ["India", "Brazil"] };
const COUNTRY_PRED = "(geo_info_country IS NOT NULL AND geo_info_country IN ('India', 'Brazil'))";
const EMAIL: FunnelFilter = { field: "usr_email", op: "suffix", values: ["@acme.com"] };
const EMAIL_KI =
  "MAX(CASE WHEN (usr_email IS NOT NULL AND ends_with(usr_email, '@acme.com')) THEN 1 ELSE 0 END) AS ki1";
const x00 = (sql: string): string => sql.slice(sql.indexOf("x00 AS ("), sql.indexOf("\nx0 AS ("));

describe("Filter all steps (f) in the funnel SQL", () => {
  it("a session field filters rows in the x00 WHERE, and NULL never matches", () => {
    const sql = funnelSql(scope(), null, fdef({ f: [COUNTRY] }), opts);
    const where = x00(sql).slice(x00(sql).indexOf(" WHERE "));
    expect(where).toContain(` AND ${COUNTRY_PRED} AND (`);
    expect(sql).not.toContain("ki1");
  });

  it.each([
    ["eq", ["x"], "(geo_info_city IS NOT NULL AND geo_info_city = 'x')"],
    [
      "contains",
      ["a", "b"],
      "((geo_info_city IS NOT NULL AND strpos(geo_info_city, 'a') > 0) OR (geo_info_city IS NOT NULL AND strpos(geo_info_city, 'b') > 0))",
    ],
  ] as const)("a %s filter keeps a session on any of its values", (op, values, pred) => {
    const f: FunnelFilter = { field: "geo_info_city", op, values: [...values] };
    expect(funnelSql(scope(), null, fdef({ f: [f] }), opts)).toContain(pred);
  });

  it("a field the stream lacks matches nothing instead of failing the query", () => {
    const schema = { ...FULL, geo_info_country: false };
    const sql = funnelSql(scope({ schema }), null, fdef({ f: [COUNTRY] }), opts);
    expect(x00(sql)).toContain(" AND (1 = 0) AND (");
    expect(sql).not.toContain("geo_info_country");
  });

  it("an identity filter flags the whole session and widens the rows to its field", () => {
    const sql = funnelSql(scope(), null, fdef({ f: [EMAIL] }), opts);
    expect(x00(sql)).toContain(EMAIL_KI);
    expect(x00(sql)).toContain(" OR usr_email IS NOT NULL)");
    expect(x00(sql)).not.toContain("ends_with(usr_email, '@acme.com')) AND (");
    expect(sql).toContain("MAX(ki1) OVER (PARTITION BY sid) AS ks1");
    expect(sql).toContain("WHERE ks1 = 1 AND (");
  });

  it("an attribute filter checks the whole session, quoted and compared as text", () => {
    const schema = { ...FULL, context_promo_variant: true };
    const f: FunnelFilter = { field: "context_promo_variant", op: "in", values: ["B"] };
    const sql = funnelSql(scope({ schema }), null, fdef({ f: [f] }), opts);
    expect(x00(sql)).toContain(
      `MAX(CASE WHEN ("context_promo_variant" IS NOT NULL AND CAST("context_promo_variant" AS VARCHAR) IN ('B')) THEN 1 ELSE 0 END) AS ki1`,
    );
    expect(x00(sql)).toContain(' OR "context_promo_variant" IS NOT NULL)');
    expect(sql).toContain("WHERE ks1 = 1 AND (");
  });

  it("a negated session filter keeps sessions where no event matched", () => {
    const sql = funnelSql(scope(), null, fdef({ f: [{ ...EMAIL, not: true }] }), opts);
    expect(x00(sql)).toContain(EMAIL_KI);
    expect(sql).toContain("WHERE ks1 = 0 AND (");
  });

  it("a negated row filter keeps rows that do not match, NULL included", () => {
    const sql = funnelSql(scope(), null, fdef({ f: [{ ...COUNTRY, not: true }] }), opts);
    expect(x00(sql)).toContain(` AND NOT ${COUNTRY_PRED} AND (`);
  });

  it("an identity filter and an identity app rule keep their own flags", () => {
    const rules = {
      ...NO_RULES,
      sessions: [{ field: "usr_id" as const, op: "eq" as const, values: ["bot"] }],
    };
    const sql = funnelSql(scope({ exclusions: rules }), null, fdef({ f: [EMAIL] }), opts);
    expect(x00(sql)).toContain(" AS xi, " + EMAIL_KI);
    expect(sql).toContain(
      "MAX(xi) OVER (PARTITION BY sid) AS xs, MAX(ki1) OVER (PARTITION BY sid) AS ks1",
    );
    expect(sql).toContain("WHERE xs = 0 AND ks1 = 1 AND (");
  });

  it("every funnel path applies the filters: funnel, breakdown, Users, panel, drop-off and cohort paths", () => {
    const d = fdef({ f: [COUNTRY, EMAIL] });
    const cohort = { funnel: d, stepIndex: 1, side: "dropped" as const };
    const sqls = [
      funnelSql(scope(), null, d, opts),
      funnelSql(scope(), null, { ...d, breakdown: "browser" }, opts),
      funnelSql(scope(), id, { ...d, unit: "users", window: "7d" }, opts),
      funnelPanelSql(scope(), d, opts),
      nextStepsSql(scope(), null, d, opts),
      dropoffNextSql(scope(), null, cohort, opts),
      dropoffHealthSql(scope(), null, d, 1, opts),
      cohortSessionsSql(scope(), null, cohort, 0, opts),
      pathsSql(
        scope(),
        null,
        { anchor: null, direction: "next", depth: 2, include: "all", cohort },
        opts,
      ),
    ];
    for (const sql of sqls) {
      expect(sql).toContain(COUNTRY_PRED);
      expect(sql).toContain("ks1 = 1");
      assertJoinFree(sql);
    }
  });

  it("a funnel without filters compiles exactly as before", () => {
    expect(funnelSql(scope(), null, fdef({ f: [] }), opts)).toBe(
      funnelSql(scope(), null, fdef(), opts),
    );
  });
});

describe("view conditions (vc) on page steps", () => {
  const PARAM: ViewCond = { t: "param", key: "utm_source", op: "eq", values: ["ads", "mail"] };
  const REF: ViewCond = { t: "ref", op: "eq", values: ["google.com"] };
  const m1 = (sql: string) => {
    const at = sql.indexOf(" AS m1");
    return sql.slice(sql.lastIndexOf("CASE WHEN", at), at);
  };

  it("a URL parameter condition reads the grouped url like a named-event param rule", () => {
    const sql = funnelSql(
      scope(),
      null,
      fdef({ steps: [p("/a", { vc: [PARAM] }), p("/b")] }),
      opts,
    );
    expect(m1(sql)).toContain(
      "AND ((regexp_like(url, '[?#&]utm_source=ads(&|#|$)')) OR (regexp_like(url, '[?#&]utm_source=mail(&|#|$)')))",
    );
    expect(sql).toContain("END AS k, url FROM x00");
  });

  it("a referrer condition is schema-gated like the named-event referrer rule", () => {
    const d = fdef({ steps: [p("/a", { vc: [REF] }), p("/b")] });
    const sql = funnelSql(scope(), null, d, opts);
    expect(m1(sql)).toContain("AND (regexp_like(ref, '^https?://([^/]*\\.)?google\\.com(/|:|$)'))");
    expect(sql).toContain("MIN(view_referrer) AS ref");
    const bare = funnelSql(scope({ schema: { ...FULL, view_referrer: false } }), null, d, opts);
    expect(m1(bare)).toContain(" AND (1 = 0)");
    expect(bare).toContain("MIN(CAST(NULL AS VARCHAR)) AS ref");
  });

  it("conditions reach the drop-off chain too", () => {
    const d = fdef({ steps: [p("/a"), p("/b", { vc: [PARAM] })] });
    const sql = dropoffHealthSql(scope(), null, d, 1, opts);
    expect(sql).toContain("regexp_like(url, '[?#&]utm_source=ads(&|#|$)')");
    assertJoinFree(sql);
  });
});

describe("Why N? query", () => {
  it("counts sessions that opened step 1 and those inside Filter all steps, in one scan", () => {
    const sql = whyEnteredSql(scope(), fdef({ f: [COUNTRY, EMAIL] }), opts);
    assertJoinFree(sql);
    expect(sql).toContain(
      "SELECT SUM(o1) AS opened, SUM(CASE WHEN k1 = 1 AND ki1 = 1 THEN 1 ELSE 0 END) AS kept FROM g LIMIT 1",
    );
    expect(sql).toContain(`AND ${COUNTRY_PRED} THEN 1 ELSE 0 END) AS k1`);
    expect(sql).toContain(EMAIL_KI);
    expect(sql).toContain(" OR usr_email IS NOT NULL) GROUP BY session_id");
  });

  it("step 1's view conditions count toward opening it, and identity app rules drop the session", () => {
    const rules = {
      ...NO_RULES,
      sessions: [{ field: "usr_id" as const, op: "eq" as const, values: ["bot"] }],
    };
    const steps = [
      p("/a", { vc: [{ t: "param", key: "plan", op: "eq", values: ["pro"] }] }),
      p("/b"),
    ];
    const sql = whyEnteredSql(scope({ exclusions: rules }), fdef({ steps }), opts);
    expect(sql).toContain(
      "strpos(view_url, 'plan=') > 0 AND regexp_like(view_url, '[?#&]plan=pro(&|#|$)')",
    );
    expect(sql).toMatch(/FROM g WHERE xi = 0 LIMIT 1$/);
  });
});

describe("filter value suggestions", () => {
  it("lists a field's top values with their sessions, shaped like identityTopSql", () => {
    const sql = filterValuesSql(scope(), "geo_info_country");
    assertJoinFree(sql);
    expect(sql).toContain("SELECT geo_info_country AS v, COUNT(DISTINCT session_id) AS sessions");
    expect(sql).toContain("geo_info_country IS NOT NULL AND geo_info_country <> ''");
    expect(() => filterValuesSql(scope({ schema: {} }), "geo_info_country")).toThrow();
  });

  it("lists an attribute's values as text, so numeric and boolean columns group alike", () => {
    const schema = { ...FULL, context_cart_value: true };
    const sql = filterValuesSql(scope({ schema }), "context_cart_value");
    expect(sql).toContain('SELECT CAST("context_cart_value" AS VARCHAR) AS v');
    expect(sql).toContain('"context_cart_value" IS NOT NULL');
  });
});

describe("stored SQL without page scope (D4)", () => {
  it("one definition saved under different page scopes stores identical SQL", () => {
    const d = fdef({ f: [COUNTRY] });
    const pages = [
      scope(),
      scope({ env: ["prod"], version: ["1.2"] }),
      scope({ apps: ["shop"], appExclusions: {}, xall: true }),
      scope({ newSince: 1790000000000 }),
    ];
    const stored = pages.map((s) =>
      funnelSql(storedFunnelScope(s), id, { ...d, unit: "users" }, opts),
    );
    expect(new Set(stored).size).toBe(1);
    expect(stored[0]).not.toContain("env IN");
    expect(stored[0]).not.toContain("'shop'");
    expect(stored[0]).not.toContain("first_t");
    expect(funnelSql(pages[1], null, d, opts)).toContain("env IN ('prod')");
  });

  it("keeps the app's own filters", () => {
    const rules = {
      ...NO_RULES,
      sessions: [{ field: "geo_info_city" as const, op: "eq" as const, values: ["X"] }],
    };
    expect(storedFunnelScope(scope({ exclusions: rules })).exclusions).toBe(rules);
  });
});
