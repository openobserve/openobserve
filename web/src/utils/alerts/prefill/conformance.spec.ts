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

/**
 * CONTRACT CONFORMANCE — runs every registered source adapter through the
 * invariants in ts/interfaces/alertPrefill.ts.
 *
 * Adding a surface means adding ONE row to ADAPTERS below; the invariant
 * assertions come free. That is the point: a future adapter cannot quietly
 * violate the contract, and the rules live in one readable place rather than
 * being re-litigated in each adapter's own spec.
 */

import { describe, it, expect } from "vitest";
import { MAX_PERIOD_MINUTES, isPrefillBlocked, normalizePrefill } from "../alertPrefill";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";
import { buildPrefillFromPanel } from "./fromPanel";
import { buildPrefillFromLogs } from "./fromLogs";
import { buildPrefillFromPatterns } from "./fromPatterns";
import { buildDbmPrefill } from "./fromDbm";
import { buildDbmLockPrefill } from "./fromDbmLocks";

interface AdapterCase {
  /** Registered source id. */
  name: string;
  /** A representative, healthy call — must produce an unblocked prefill. */
  healthy: () => AlertPrefill;
  /** The most degenerate input the surface could realistically hand over. */
  degenerate: () => AlertPrefill;
  /**
   * Whether degenerate input MUST produce a blocking prefill. Default true.
   *
   * False for surfaces whose stream and query shape are constants of the
   * feature rather than user input — those can always build something that
   * runs, so demanding a block would force an adapter to fail where degrading
   * is the better answer. Such an adapter must still WARN about what it
   * changed, which is asserted separately below.
   */
  blocks?: boolean;
}

const ADAPTERS: AdapterCase[] = [
  {
    name: "panel",
    healthy: () =>
      buildPrefillFromPanel({
        panelTitle: "Error rate",
        panelType: "line",
        queryType: "sql",
        queries: [
          {
            query: 'SELECT * FROM "k8s_logs"',
            customQuery: true,
            fields: { stream: "k8s_logs", stream_type: "logs" },
          },
        ],
        timeRange: { value_type: "relative", relative_value: 15, relative_period: "Minutes" },
      }),
    degenerate: () => buildPrefillFromPanel({}),
  },
  {
    name: "logs",
    healthy: () =>
      buildPrefillFromLogs({
        streamNames: ["k8s_logs"],
        streamType: "logs",
        sqlMode: true,
        rawQuery: 'SELECT * FROM "k8s_logs" WHERE code = 200',
        resolvedSql: 'SELECT * FROM "k8s_logs" WHERE code = 200',
        datetime: { type: "relative", relativeTimePeriod: "15m" },
      }),
    degenerate: () =>
      buildPrefillFromLogs({
        streamNames: [],
        streamType: "logs",
        sqlMode: false,
        rawQuery: "",
        resolvedSql: "",
      }),
  },
  {
    name: "patterns",
    healthy: () =>
      buildPrefillFromPatterns({
        streamName: "k8s_logs",
        streamType: "logs",
        templates: ["Connection refused to upstream <*>"],
        totalCount: 1,
        mode: "exclude",
        datetime: { type: "relative", relativeTimePeriod: "15m" },
      }),
    degenerate: () => buildPrefillFromPatterns({ streamName: "", templates: [] }),
  },
  {
    name: "dbm",
    healthy: () =>
      buildDbmPrefill({
        scope: "query",
        kind: "latency",
        fingerprint: "a1b2c3d4e5f60718",
        queryNorm: "SELECT * FROM orders WHERE customer_id = ?",
        fpVersion: 1,
        dbSystem: "postgresql",
        dbInstance: "orders-db",
        p95Ns: 380_000_000,
        rollupIntervalSecs: 900,
      }),
    // DBM's degenerate case is NOT a blocked prefill, and that is deliberate:
    // the stream and the aggregate query are known constants of the feature, so
    // even a row with no fingerprint still yields a working database-scoped
    // alert. It degrades scope instead of failing — see `blocks: false`.
    degenerate: () => buildDbmPrefill({ scope: "query", kind: "latency" }),
    blocks: false,
  },
  {
    name: "dbmlocks",
    healthy: () =>
      buildDbmLockPrefill({
        kind: "blocking",
        dbSystem: "postgresql",
        dbInstance: "orders-db",
        observedWaitSeconds: 40,
        periodMinutes: 15,
      }),
    // Like `dbm`, and for the same reason: the stream and the shape of the
    // aggregate are constants of the feature, so a row carrying no identity at
    // all still yields an alert that runs — a fleet-wide one. It degrades scope
    // rather than failing, and says so via `dbmNoInstance`.
    degenerate: () => buildDbmLockPrefill({ kind: "blocking" }),
    blocks: false,
  },
];

describe.each(ADAPTERS)("contract conformance — $name adapter", (adapterCase) => {
  it("never throws, even on degenerate input", () => {
    expect(() => adapterCase.degenerate()).not.toThrow();
  });

  it("returns an unblocked prefill for a healthy surface state", () => {
    expect(isPrefillBlocked(normalizePrefill(adapterCase.healthy()))).toBe(false);
  });

  it("reports a blocking warning rather than a broken prefill on degenerate input", () => {
    const result = normalizePrefill(adapterCase.degenerate());

    // An adapter that legitimately degrades instead of blocking still owes the
    // user an explanation of what it changed — silence would be the actual bug.
    if (adapterCase.blocks === false) {
      expect(isPrefillBlocked(result)).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      return;
    }

    expect(isPrefillBlocked(result)).toBe(true);
    // A block must be explained — an empty warnings list would leave the UI
    // with nothing to tell the user.
    expect(result.warnings.filter((w) => w.level === "blocking").length).toBeGreaterThan(0);
  });

  it("stamps the current contract version", () => {
    expect(adapterCase.healthy().version).toBe(ALERT_PREFILL_VERSION);
  });

  it("declares the source it came from", () => {
    const prefill = adapterCase.healthy();
    expect(prefill.source).toBe(adapterCase.name);
    expect(prefill.sourceLabel).toBeTruthy();
  });

  it("invariant 1 — hands over a resolved query, not source syntax", () => {
    const prefill = adapterCase.healthy();
    const query = prefill.sql ?? prefill.promql ?? "";
    expect(query).not.toMatch(/\[(WHERE_CLAUSE|INDEX_NAME|FIELD_LIST|QUERY_FUNCTIONS)\]/);
  });

  it("invariant 2 — resolves to exactly one stream", () => {
    const prefill = normalizePrefill(adapterCase.healthy());
    expect(prefill.streamName).toBeTruthy();
    expect(typeof prefill.streamName).toBe("string");
  });

  it("invariant 3 — period is clamped minutes, never a timestamp", () => {
    const prefill = adapterCase.healthy();
    if (prefill.periodMinutes === undefined) return;
    expect(Number.isInteger(prefill.periodMinutes)).toBe(true);
    expect(prefill.periodMinutes).toBeGreaterThanOrEqual(1);
    expect(prefill.periodMinutes).toBeLessThanOrEqual(MAX_PERIOD_MINUTES);
  });

  it("invariant 4 — always carries a warnings array to report losses through", () => {
    expect(Array.isArray(adapterCase.healthy().warnings)).toBe(true);
  });

  it("invariant 5 — is pure: the same input yields the same output", () => {
    expect(adapterCase.healthy()).toEqual(adapterCase.healthy());
  });

  it("invariant 5 — is synchronous, returning a plain object not a promise", () => {
    const prefill = adapterCase.healthy();
    expect(prefill).not.toBeInstanceOf(Promise);
    expect(typeof prefill).toBe("object");
  });

  it("declares a query type its payload actually supports", () => {
    const prefill = adapterCase.healthy();
    expect(["sql", "promql", "custom"]).toContain(prefill.queryType);
    if (prefill.queryType === "sql") expect(prefill.sql).toBeTruthy();
    if (prefill.queryType === "promql") expect(prefill.promql).toBeTruthy();
    if (prefill.queryType === "custom") expect(prefill.conditions).toBeTruthy();
  });
});

describe("contract conformance — coverage", () => {
  it("covers every adapter that ships a prefill builder", async () => {
    // Guards against a new adapter landing without a conformance row. The glob
    // is eager so a missing entry fails here rather than silently going untested.
    const modules = import.meta.glob("./from*.ts", { eager: true });
    const shipped = Object.keys(modules)
      .filter((path) => !path.endsWith(".spec.ts"))
      .map((path) => path.replace("./from", "").replace(".ts", "").toLowerCase())
      .sort();
    const covered = ADAPTERS.map((a) => a.name.toLowerCase()).sort();

    expect(shipped).toEqual(covered);
  });
});
