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

import { ALERT_LIST_CAP, coverageOf, type CoverageAlert } from "./homeCoverage";

const sql = (text: string, extra: Partial<CoverageAlert> = {}): CoverageAlert => ({
  name: "a",
  enabled: true,
  stream_type: "logs",
  condition: { type: "sql", sql: text },
  ...extra,
});
const promql = (text: string): CoverageAlert => ({
  name: "p",
  enabled: true,
  stream_type: "metrics",
  condition: { type: "promql", promql: text },
});
const custom = (conditions: unknown, streamType = "traces"): CoverageAlert => ({
  name: "c",
  enabled: true,
  stream_type: streamType,
  condition: { type: "custom", conditions },
});

describe("coverageOf", () => {
  it("is none with no alerts and unknown with no list", () => {
    expect(coverageOf([], "api")).toBe("none");
    expect(coverageOf(null, "api")).toBe("unknown");
  });

  it("covers from a logs, a metrics and a traces alert", () => {
    expect(coverageOf([sql(`SELECT count(*) FROM "default" WHERE service = 'api'`)], "api")).toBe(
      "covered",
    );
    expect(coverageOf([promql(`rate(http_total{service_name="api"}[5m])`)], "api")).toBe("covered");
    expect(
      coverageOf([custom([{ column: "service_name", operator: "=", value: "api" }])], "api"),
    ).toBe("covered");
  });

  it("covers the stored proposal of board 21.5 (a ListAlertsResponseBodyItem)", () => {
    const item: CoverageAlert & Record<string, unknown> = {
      alert_id: "2vK1",
      folder_id: "default",
      folder_name: "Default",
      name: "search errors",
      alert_type: "scheduled",
      stream_type: "logs",
      stream_name: "default",
      enabled: true,
      condition: {
        type: "sql",
        sql: `SELECT count(*) AS errors FROM "default" WHERE service = 'search' AND level = 'error'`,
      },
      last_triggered_at: null,
      is_real_time: false,
    };
    expect(coverageOf([item], "search")).toBe("covered");
  });

  describe("custom conditions", () => {
    const leaf = { column: "service_name", operator: "=", value: "api" };
    const other = { column: "level", operator: "=", value: "error" };

    it("covers through V1 AND nodes and a legacy array", () => {
      expect(coverageOf([custom({ and: [other, { and: [leaf] }] })], "api")).toBe("covered");
      expect(coverageOf([custom([other, leaf])], "api")).toBe("covered");
    });

    it("is unknown under a V1 OR or NOT", () => {
      expect(coverageOf([custom({ or: [other, leaf] })], "api")).toBe("unknown");
      expect(coverageOf([custom({ not: leaf })], "api")).toBe("unknown");
    });

    it("covers through a V2 AND group and is unknown under OR", () => {
      const group = (op: string) => ({
        version: 2,
        conditions: {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [
            { filterType: "condition", ...other, logicalOperator: "AND" },
            { filterType: "condition", ...leaf, logicalOperator: op },
          ],
        },
      });
      expect(coverageOf([custom(group("AND"))], "api")).toBe("covered");
      expect(coverageOf([custom(group("OR"))], "api")).toBe("unknown");
    });

    it("never covers from another column, operator or value", () => {
      expect(
        coverageOf([custom([{ column: "other_service", operator: "=", value: "api" }])], "api"),
      ).toBe("none");
      expect(
        coverageOf([custom([{ column: "service", operator: "!=", value: "api" }])], "api"),
      ).toBe("none");
    });
  });

  describe("sql", () => {
    it("covers an IN list and a quoted dotted column", () => {
      expect(coverageOf([sql(`SELECT * FROM d WHERE service IN ('x', 'api')`)], "api")).toBe(
        "covered",
      );
      expect(coverageOf([sql(`SELECT * FROM d WHERE "service.name" = 'api'`)], "api")).toBe(
        "covered",
      );
    });

    it("is none for another column and for a commented condition", () => {
      expect(coverageOf([sql(`SELECT * FROM d WHERE other_service = 'api'`)], "api")).toBe("none");
      expect(
        coverageOf([sql(`SELECT * FROM d WHERE level = 'error' -- service = 'api'`)], "api"),
      ).toBe("none");
    });

    it("is unknown under OR or NOT", () => {
      expect(coverageOf([sql(`SELECT * FROM d WHERE level = 'e' OR service = 'api'`)], "api")).toBe(
        "unknown",
      );
      expect(coverageOf([sql(`SELECT * FROM d WHERE NOT (service = 'api')`)], "api")).toBe(
        "unknown",
      );
    });

    it("is unknown for unparseable SQL that quotes the name, else says nothing", () => {
      expect(coverageOf([sql(`SELEKT ((( 'api'`)], "api")).toBe("unknown");
      expect(coverageOf([sql(`SELEKT ((( 'other'`)], "api")).toBe("none");
    });

    it("does not read api as checkout-api", () => {
      expect(coverageOf([sql(`SELECT * FROM d WHERE service = 'checkout-api'`)], "api")).toBe(
        "none",
      );
      expect(coverageOf([sql(`SELECT * FROM d WHERE service = 'api'`)], "checkout-api")).toBe(
        "none",
      );
    });
  });

  describe("promql", () => {
    it("is unknown for a regex matcher that matches", () => {
      expect(coverageOf([promql(`up{service_name=~"api|web"}`)], "api")).toBe("unknown");
      expect(coverageOf([promql(`up{service_name=~"web"}`)], "api")).toBe("none");
    });

    it("answers a backtracking pattern unknown without running it", () => {
      const started = performance.now();
      const verdict = coverageOf([promql(`up{service_name=~"(a+)+b"}`)], "a".repeat(28));
      expect(verdict).toBe("unknown");
      expect(performance.now() - started).toBeLessThan(50);
    });

    it("reads a dotted pattern as unknown, since a dot matches any name", () => {
      expect(coverageOf([promql(`up{service_name=~"api.v1"}`)], "apixv1")).toBe("unknown");
    });

    it("skips strings and comments", () => {
      expect(coverageOf([promql(`# up{service="api"}\nup{job="x"}`)], "api")).toBe("none");
      expect(coverageOf([promql(`label_replace(up, "service", "api", "", "")`)], "api")).toBe(
        "none",
      );
    });

    it("never counts a service excluded by `unless` or a negative matcher as covered", () => {
      const right = `up{job="backend"} unless up{service_name="api"}`;
      expect(coverageOf([promql(right)], "api")).toBe("unknown");
      expect(coverageOf([promql(`up{service_name="api"} UNLESS up{env="dev"}`)], "api")).toBe(
        "unknown",
      );
      expect(coverageOf([promql(`up{service_name!="api"}`)], "api")).toBe("none");
      expect(coverageOf([promql(`up{service_name!~"api|web"}`)], "api")).toBe("none");
      expect(coverageOf([promql(`unless_total{service_name="api"}`)], "api")).toBe("covered");
    });

    it("is unknown when the scan fails and the name appears", () => {
      expect(coverageOf([promql(`up{service="api"`)], "api")).toBe("unknown");
    });
  });

  it("ignores disabled alerts and other stream types", () => {
    const covering = `SELECT * FROM d WHERE service = 'api'`;
    expect(coverageOf([sql(covering, { enabled: false })], "api")).toBe("none");
    expect(coverageOf([sql(covering, { stream_type: "enrichment_tables" })], "api")).toBe("none");
  });

  it("turns none into unknown when the list is full", () => {
    const full = Array.from({ length: ALERT_LIST_CAP }, () => sql(`SELECT 1 FROM d`));
    expect(coverageOf(full, "api")).toBe("unknown");
    expect(coverageOf([...full, sql(`SELECT * FROM d WHERE service = 'api'`)], "api")).toBe(
      "covered",
    );
  });

  it("parses each alert once per list, so 1000 alerts over 12 services stay fast", () => {
    const where = Array.from({ length: 40 }, (_, i) => `level = 'l${i}'`).join(" AND ");
    const alerts = Array.from({ length: ALERT_LIST_CAP - 1 }, (_, i) =>
      sql(`SELECT count(*) FROM d${i} WHERE ${where} AND service_name = 'svc-${i}'`),
    );
    coverageOf(alerts, "warm-up");
    const started = performance.now();
    const verdicts = Array.from({ length: 12 }, (_, i) => coverageOf(alerts, `svc-${i}`));
    expect(performance.now() - started).toBeLessThan(100);
    expect(verdicts.every((v) => v === "covered")).toBe(true);
  });

  it("never counts the alert name", () => {
    expect(coverageOf([sql(`SELECT 1 FROM d`, { name: "api" })], "api")).toBe("none");
  });
});
