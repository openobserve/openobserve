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
  funnelAlertSql,
  funnelSql,
  funnelTrendSql,
  whyEnteredSql,
  type AnalyticsScope,
  type FunnelDef,
  type FunnelFilter,
  type StepRef,
} from "@/utils/rum/productAnalyticsQueries";

const PAY = "context_payment_method";
const s: AnalyticsScope = {
  app: "web",
  env: [],
  version: [],
  schema: {
    action_target_name: true,
    usr_email: true,
    user_agent_user_agent_family: true,
    view_name: true,
    [PAY]: true,
    context_plan: true,
  },
};
const id = { field: "usr_email" as const, excluded: [] };
const opts = { events: [], sample: 1 as const };
const c = (key: string, f?: StepRef["f"]): StepRef => ({ kind: "c", key, ...(f ? { f } : {}) });
const steps = [c("product_viewed"), c("payment_info_submitted"), c("order_completed")];
const def = (patch: Partial<FunnelDef> = {}): FunnelDef => ({
  steps,
  unit: "sessions",
  window: "session",
  breakdown: null,
  ...patch,
});
const UPI: FunnelFilter = { field: PAY, op: "in", values: ["upi"] };
const cte = (sql: string, name: string): string => {
  const at = sql.indexOf(`${name} AS (`);
  const end = sql.indexOf("\n", at);
  return sql.slice(at, end < 0 ? undefined : end);
};
const tail = (sql: string): string => sql.slice(sql.lastIndexOf("\n") + 1);
const DIM_COL = `MIN(NULLIF(CAST("${PAY}" AS VARCHAR), '')) AS dim`;
const ANY = "m1 = 1 OR m2 = 1 OR m3 = 1";
const AUTO = `first_value(CASE WHEN ${ANY} THEN dim END ORDER BY CASE WHEN dim IS NOT NULL AND (${ANY}) THEN 0 ELSE 1 END, t) AS dim`;
const PINNED_2 =
  "first_value(CASE WHEN m2 = 1 THEN dim END ORDER BY CASE WHEN m2 = 1 AND dim IS NOT NULL THEN 0 ELSE 1 END, t) AS dim";
const H = [1, 2, 3].map(
  (i) => `MAX(CASE WHEN m${i} = 1 AND dim IS NOT NULL THEN 1 ELSE 0 END) AS h${i}`,
);
const DC = [1, 2, 3].map((i) => `SUM(CASE WHEN r${i} = 1 THEN h${i} ELSE 0 END) AS dc${i}`);

describe("attribute breakdown SQL", () => {
  it("reads the first value on any step's row, with coverage and median columns", () => {
    const sql = funnelSql(s, null, def({ breakdown: { f: PAY } }), opts);
    assertJoinFree(sql);
    expect(cte(sql, "x00")).toContain(DIM_COL);
    expect(cte(sql, "s")).toContain(
      `${AUTO}, MIN(CASE WHEN m1 = 1 THEN t END) AS t1, ${H.join(", ")}`,
    );
    expect(cte(sql, "ps")).toContain("dim, t1, h1, h2, h3");
    expect(tail(sql)).toBe(
      `SELECT dim, SUM(r1) AS c1, SUM(r2) AS c2, SUM(r3) AS c3, ${DC.join(", ")}, approx_percentile_cont(d3, 0.5) AS mt1, approx_percentile_cont(d3 - d2, 0.5) AS mt2 FROM ps GROUP BY dim ORDER BY c1 DESC, dim LIMIT 1000`,
    );
    expect(sql).toMatchSnapshot();
  });

  it("reads a pinned step's own rows only, with that step's median", () => {
    const sql = funnelSql(s, null, def({ breakdown: { f: PAY, s: 2 } }), opts);
    expect(cte(sql, "s")).toContain(PINNED_2);
    expect(tail(sql)).toContain(
      `${DC.join(", ")}, approx_percentile_cont(d3 - d2, 0.5) AS mt2 FROM ps`,
    );
    expect(tail(sql)).not.toContain("mt1");
    const last = funnelSql(s, null, def({ breakdown: { f: PAY, s: 3 } }), opts);
    expect(tail(last)).not.toContain("approx_percentile_cont");
    expect(sql).toMatchSnapshot();
  });

  it("takes a user's first non-empty value and any session's coverage in Users mode", () => {
    const sql = funnelSql(s, id, def({ unit: "users", breakdown: { f: PAY } }), opts);
    assertJoinFree(sql);
    expect(cte(sql, "pu")).toContain(
      "first_value(dim ORDER BY CASE WHEN dim IS NULL THEN 1 ELSE 0 END, t1) AS dim, MAX(h1) AS h1, MAX(h2) AS h2, MAX(h3) AS h3",
    );
    expect(tail(sql)).toContain(`${DC.join(", ")}, approx_percentile_cont(d3, 0.5) AS mt1`);
    expect(tail(sql)).toContain("FROM pu WHERE anon = 0 GROUP BY dim");
    expect(sql).toMatchSnapshot();
  });

  it("carries coverage through a windowed Users run", () => {
    const sql = funnelSql(
      s,
      id,
      def({ unit: "users", window: "1d", breakdown: { f: PAY, s: 2 } }),
      opts,
    );
    expect(cte(sql, "su")).toContain(`${PINNED_2}, ${H.join(", ")}`);
    expect(cte(sql, "pu")).toContain("dim, h1, h2, h3");
    expect(sql).toMatchSnapshot();
  });

  it("reads a pin past the last step as automatic", () => {
    const sql = funnelSql(s, null, def({ breakdown: { f: PAY, s: 4 } }), opts);
    expect(cte(sql, "s")).toContain(AUTO);
    expect(sql).not.toContain("m4");
  });

  it("drops the breakdown when the stream lacks the column", () => {
    const sql = funnelSql(s, null, def({ breakdown: { f: "context_missing" } }), opts);
    expect(sql).not.toContain("dim");
  });

  it("buckets a trend by the attribute value", () => {
    const sql = funnelTrendSql(
      s,
      null,
      def({ breakdown: { f: PAY } }),
      [0, 1, 2],
      { a: 1, b: 3 },
      opts,
    );
    expect(cte(sql, "s")).toContain(AUTO);
    expect(cte(sql, "tb")).toContain("SELECT dim,");
  });
});

describe("step property conditions (pc) SQL", () => {
  const MATCH = `("${PAY}" IS NOT NULL AND CAST("${PAY}" AS VARCHAR) IN ('upi'))`;

  it("flags a later step's own rows and tests the flag inside that step", () => {
    const d = def({ steps: [steps[0], c("payment_info_submitted", { pc: [UPI] }), steps[2]] });
    const sql = funnelSql(s, null, d, opts);
    assertJoinFree(sql);
    expect(cte(sql, "x00")).toContain(`MAX(CASE WHEN ${MATCH} THEN 1 ELSE 0 END) AS pc2_1`);
    expect(cte(sql, "x0")).toContain(", pc2_1");
    expect(cte(sql, "x1")).toContain(
      "k = 'payment_info_submitted' AND pc2_1 = 1 THEN 1 ELSE 0 END AS m2",
    );
    expect(cte(sql, "x1")).not.toContain("pc2_1 = 1 THEN 1 ELSE 0 END AS m1");
    expect(sql).toMatchSnapshot();
  });

  it("keeps step 1 to rows without the value when negated, and checks each rule", () => {
    const not: FunnelFilter = { field: "context_plan", op: "contains", values: ["pro"], not: true };
    const d = def({ steps: [c("product_viewed", { pc: [UPI, not] }), steps[1], steps[2]] });
    const sql = funnelSql(s, null, d, opts);
    expect(cte(sql, "x00")).toContain("AS pc1_1");
    expect(cte(sql, "x00")).toContain(
      `MAX(CASE WHEN ("context_plan" IS NOT NULL AND strpos(CAST("context_plan" AS VARCHAR), 'pro') > 0) THEN 1 ELSE 0 END) AS pc1_2`,
    );
    expect(cte(sql, "x1")).toContain("AND pc1_1 = 1 AND pc1_2 = 0 THEN 1 ELSE 0 END AS m1");
    expect(sql).toMatchSnapshot();
  });

  it("matches nothing on a column the stream lacks", () => {
    const d = def({
      steps: [
        steps[0],
        c("payment_info_submitted", { pc: [{ ...UPI, field: "context_missing" }] }),
        steps[2],
      ],
    });
    expect(cte(funnelSql(s, null, d, opts), "x00")).toContain(
      "MAX(CASE WHEN (1 = 0) THEN 1 ELSE 0 END) AS pc2_1",
    );
  });

  it("flows into the alert, the drill-ins and Why N", () => {
    const d = def({ steps: [c("product_viewed", { pc: [UPI] }), steps[1], steps[2]] });
    expect(funnelAlertSql(s, null, d, 50, opts)).toContain("AND pc1_1 = 1 THEN 1 ELSE 0 END AS m1");
    const cohort = { funnel: d, stepIndex: 1, side: "dropped" as const };
    expect(cohortSessionsSql(s, null, cohort, 0, opts)).toContain(
      "AND pc1_1 = 1 THEN 1 ELSE 0 END AS m1",
    );
    const why = whyEnteredSql(s, d, opts);
    assertJoinFree(why);
    expect(cte(why, "g0")).toContain(`MAX(CASE WHEN ${MATCH} THEN 1 ELSE 0 END) AS p1`);
    expect(cte(why, "g0")).toContain("GROUP BY session_id, type, CASE WHEN type = 'view'");
    expect(cte(why, "g")).toContain("MAX(CASE WHEN o0 = 1 AND p1 = 1 THEN 1 ELSE 0 END) AS o1");
    expect(cte(why, "g")).toContain("MAX(CASE WHEN k0 = 1 AND p1 = 1 THEN 1 ELSE 0 END) AS k1");
    expect(why).toMatchSnapshot();
  });
});
