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

import { foldCallingServices, showsCallingServices } from "./callingServices";

/**
 * The live shape, org `default`, fp `69219a9c7fc5039d` — the fingerprint that
 * runs on BOTH engines, which is why every scope below names one.
 */
const PG_SCOPE = {
  fingerprint: "69219a9c7fc5039d",
  engine: "postgresql",
  database: "dbmlab",
};

/** mysql/mariadb `top_query` records carry no database, so the key drops it. */
const MYSQL_SCOPE = { fingerprint: "69219a9c7fc5039d", engine: "mysql", database: null };

const CALLER = (
  service_name: string | null,
  calls: number,
  extra: Partial<{ endpoint: string; errors: number; p95_ns: number | null }> = {},
) => ({
  service_name,
  endpoint: extra.endpoint ?? "/checkout",
  calls,
  errors: extra.errors ?? 0,
  total_time_ns: calls * 1_000,
  // `??` would swallow an explicit `null`, which is exactly the case the
  // absent-p95 test needs to construct.
  p95_ns: "p95_ns" in extra ? extra.p95_ns : 60_891_247,
});

describe("foldCallingServices — the join guard", () => {
  /**
   * The guard D5 turns on. A fingerprint hashes statement TEXT ONLY, so nine of
   * them run under two engines at once on the live fleet; without an engine
   * there is no key, and attaching the callers anyway attributes MySQL services
   * to a Postgres row's counters.
   */
  it("refuses to attribute when no engine is known", () => {
    const result = foldCallingServices(
      [CALLER("dbm-sv-workload", 3728)],
      { fingerprint: "69219a9c7fc5039d", engine: null, database: "dbmlab" },
      465_105,
    );
    expect(result.state).toBe("unjoinable");
    expect(result.services).toEqual([]);
    // No fabricated coverage from a refused join.
    expect(result.coverage).toBeNull();
  });

  it("refuses a per-database engine that names no database", () => {
    // Postgres counters are PER-DATABASE. Quoting one database's callers for a
    // statement that runs in several is a wrong attribution.
    const result = foldCallingServices(
      [CALLER("dbm-sv-workload", 3728)],
      { fingerprint: "69219a9c7fc5039d", engine: "postgresql", database: null },
      465_105,
    );
    expect(result.state).toBe("unjoinable");
  });

  it("joins mysql without a database, because its records carry none", () => {
    const result = foldCallingServices([CALLER("dbm-sv-workload", 219_713)], MYSQL_SCOPE, 195_751);
    expect(result.state).toBe("attributed");
    expect(result.services.map((s) => s.name)).toEqual(["dbm-sv-workload"]);
  });

  /**
   * A refusal must still be VISIBLE. Hiding it would look identical to having
   * no data, and the reader would never learn why nobody is named.
   */
  it("keeps the section visible on a refusal, and hides it only on no trace vantage", () => {
    const unjoinable = foldCallingServices([CALLER("svc", 1)], { fingerprint: "fp" }, 10);
    expect(unjoinable.state).toBe("unjoinable");
    expect(showsCallingServices(unjoinable)).toBe(true);
  });
});

describe("foldCallingServices — hide when there is no trace vantage", () => {
  /**
   * D3. An empty caller list under a 5,581,260-execution row reads as "nothing
   * calls this statement", which is false: it means nothing INSTRUMENTED calls
   * it. The section hides rather than rendering the empty list.
   */
  it("hides on an answered, empty trace read", () => {
    const result = foldCallingServices([], PG_SCOPE, 5_581_260);
    expect(result.state).toBe("noTraceVantage");
    expect(showsCallingServices(result)).toBe(false);
    expect(result.coverage).toBeNull();
    // Never 0 for "we saw none" — a 0 invites the reader to conclude zero
    // callers, which is the exact claim this state refuses to make.
    expect(result.coverage).not.toBe(0);
  });

  it("hides when the trace read never answered", () => {
    // `null` rows is "no stream resolved / the read broke", not an observation
    // of absence. Same hidden section; the caller keeps its own error state.
    expect(showsCallingServices(foldCallingServices(null, PG_SCOPE, 5_581_260))).toBe(false);
    expect(showsCallingServices(foldCallingServices(undefined, PG_SCOPE, 5_581_260))).toBe(false);
  });

  /**
   * Rows arrived and every one was unattributed — the live shape of fp
   * `69219a9c7fc5039d`, whose heaviest endpoints row has a null service. The
   * vantage IS present, so the section stays and reports the honest answer.
   */
  it("stays visible when calls were traced but no service could be named", () => {
    const result = foldCallingServices([CALLER(null, 341_169)], PG_SCOPE, 465_105);
    expect(result.state).toBe("attributed");
    expect(result.services).toEqual([]);
    expect(result.unattributedCalls).toBe(341_169);
    expect(showsCallingServices(result)).toBe(true);
  });
});

describe("foldCallingServices — the coverage math", () => {
  /**
   * The whole honesty requirement in one number: three services seen in
   * 1,495,679 of 5,581,260 executions. The server count is the denominator
   * because it is the only one that counts EVERY client.
   */
  it("divides traced calls by the SERVER count, not by the traced total", () => {
    const result = foldCallingServices(
      [CALLER("checkout", 900_000), CALLER("billing", 400_000), CALLER("reports", 195_679)],
      PG_SCOPE,
      5_581_260,
    );
    expect(result.tracedCalls).toBe(1_495_679);
    expect(result.serverCalls).toBe(5_581_260);
    expect(result.coverage).toBeCloseTo(1_495_679 / 5_581_260, 12);
    // The residual is the finding — the attributed traffic is NOT normalised
    // to 100%, which would claim these three services made all 5.5M calls.
    expect(result.coverage).toBeLessThan(0.27);
  });

  it("counts unattributed calls into coverage but never into a service", () => {
    // The call WAS traced — it just names no caller. Dropping it from the
    // numerator would understate how much of the row the trace vantage saw.
    const result = foldCallingServices(
      [CALLER("dbm-sv-workload", 3_728), CALLER(null, 341_169)],
      PG_SCOPE,
      465_105,
    );
    expect(result.tracedCalls).toBe(3_728);
    expect(result.unattributedCalls).toBe(341_169);
    expect(result.coverage).toBeCloseTo((3_728 + 341_169) / 465_105, 12);
    expect(result.services.map((s) => s.name)).toEqual(["dbm-sv-workload"]);
  });

  it("renders coverage as absent, never 0 or 100%, when the server did not match", () => {
    const result = foldCallingServices([CALLER("checkout", 1_000)], PG_SCOPE, null);
    expect(result.state).toBe("attributed");
    expect(result.serverCalls).toBeNull();
    expect(result.coverage).toBeNull();
    expect(result.coverage).not.toBe(0);
    expect(result.coverage).not.toBe(1);
  });

  it("treats a zero server count as no denominator rather than dividing by it", () => {
    const result = foldCallingServices([CALLER("checkout", 10)], PG_SCOPE, 0);
    expect(result.coverage).toBeNull();
  });

  /**
   * Coverage above 1 is left as measured. It means the two vantages disagree
   * (different windows, a sampled server scrape) and clamping it to 100% would
   * hide exactly the disagreement the reader needs to see.
   */
  it("does not clamp coverage to 100%", () => {
    const result = foldCallingServices([CALLER("checkout", 200)], PG_SCOPE, 100);
    expect(result.coverage).toBe(2);
  });
});

describe("foldCallingServices — the client-observed latency", () => {
  /**
   * Every latency this module emits is ROUND-TRIP: it includes network time and
   * connection-pool wait, which the server's figure does not. It is carried on
   * `p95Ns` — a field name distinct from anything the server row exposes — so a
   * consumer cannot pick it up believing it to be the engine's own measurement.
   */
  it("carries a client-observed p95 for every named service", () => {
    const result = foldCallingServices(
      [
        CALLER("checkout", 3_728, { p95_ns: 104_184_383 }),
        CALLER("billing", 100, { p95_ns: 60_891_247 }),
      ],
      PG_SCOPE,
      465_105,
    );
    expect(result.services.every((s) => s.p95Ns !== null)).toBe(true);
    expect(result.services[0]).toMatchObject({ name: "checkout", p95Ns: 104_184_383 });
  });

  it("takes the worst endpoint's p95 rather than averaging percentiles", () => {
    // There is no stored sketch, so a weighted mean of two p95s measures
    // nothing. The max is a real measurement of a real endpoint.
    const result = foldCallingServices(
      [
        CALLER("checkout", 1_000, { endpoint: "/cart", p95_ns: 10_000_000 }),
        CALLER("checkout", 9_000, { endpoint: "/pay", p95_ns: 90_000_000 }),
      ],
      PG_SCOPE,
      465_105,
    );
    expect(result.services).toHaveLength(1);
    expect(result.services[0].calls).toBe(10_000);
    expect(result.services[0].p95Ns).toBe(90_000_000);
  });

  it("leaves an unreported p95 absent rather than zero", () => {
    const result = foldCallingServices(
      [CALLER("checkout", 10, { p95_ns: null })],
      PG_SCOPE,
      465_105,
    );
    expect(result.services[0].p95Ns).toBeNull();
  });
});

describe("foldCallingServices — folding", () => {
  it("folds a service's endpoints together, heaviest service first", () => {
    const result = foldCallingServices(
      [
        CALLER("billing", 50, { endpoint: "/invoice", errors: 2 }),
        CALLER("checkout", 30, { endpoint: "/cart", errors: 1 }),
        CALLER("checkout", 40, { endpoint: "/pay", errors: 3 }),
      ],
      PG_SCOPE,
      1_000,
    );
    expect(result.services.map((s) => [s.name, s.calls, s.errors])).toEqual([
      ["checkout", 70, 4],
      ["billing", 50, 2],
    ]);
  });

  it("survives rows with no counters rather than emitting NaN", () => {
    const result = foldCallingServices(
      [{ service_name: "checkout" }, { service_name: "checkout", calls: 5 }],
      PG_SCOPE,
      100,
    );
    expect(result.services[0].calls).toBe(5);
    expect(Number.isNaN(result.coverage ?? 0)).toBe(false);
  });
});
