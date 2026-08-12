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
 * Lock-contention alerting — the blocking and deadlock surfaces.
 *
 * These are a SEPARATE adapter from `fromDbm`, and the split is the point
 * rather than an accident of organisation. `fromDbm` alerts on the rollup of
 * CLIENT-OBSERVED spans: latency and errors as the application experienced
 * them. Blocking and deadlocks are SERVER-VANTAGE records the engine itself
 * reported, in a different stream (`dbm_server`) with a different schema. One
 * builder emitting both would have to switch stream, columns and provenance on
 * a `kind` field, and the first person to add a third kind would get the
 * pairing wrong.
 */

import { describe, it, expect } from "vitest";
import {
  buildDbmLockPrefill,
  suggestedWaitSeconds,
  suggestedDeadlockEvents,
  DBM_SERVER_STREAM,
  type DbmLockPrefillInput,
} from "./fromDbmLocks";
import { normalizePrefill, isPrefillBlocked } from "../alertPrefill";

const BLOCKING_ROW: DbmLockPrefillInput = {
  kind: "blocking",
  dbSystem: "postgresql",
  dbInstance: "orders-db",
  observedWaitSeconds: 40,
  periodMinutes: 15,
};

const DEADLOCK_ROW: DbmLockPrefillInput = {
  kind: "deadlocks",
  dbSystem: "mysql",
  dbInstance: "billing-db",
  observedEvents: 12,
  periodMinutes: 15,
};

describe("suggestedWaitSeconds", () => {
  /**
   * Headroom for the same reason `suggestedLatencyMs` has it: an alert armed at
   * exactly the wait we just watched fires on the next ordinary lock and gets
   * muted. 1.5x matches the sibling so the two surfaces behave alike.
   */
  it("suggests 1.5x the observed wait, in whole seconds", () => {
    expect(suggestedWaitSeconds(40)).toBe(60);
    // Derived, not a constant that happens to clear one fixture.
    expect(suggestedWaitSeconds(120)).toBe(180);
    expect(suggestedWaitSeconds(7)).toBe(11);
  });

  it("falls back to a usable default when nothing was observed", () => {
    expect(suggestedWaitSeconds(null)).toBe(30);
    expect(suggestedWaitSeconds(0)).toBe(30);
  });

  /**
   * A sub-second wait must not arm the alert at zero, which would fire on every
   * lock the engine ever reports — including the healthy microsecond ones.
   */
  it("never suggests a zero threshold", () => {
    expect(suggestedWaitSeconds(0.2)).toBeGreaterThanOrEqual(1);
  });
});

describe("buildDbmLockPrefill — blocking", () => {
  it("reads the server-vantage stream, not the client-span rollup", () => {
    const prefill = buildDbmLockPrefill(BLOCKING_ROW);
    expect(prefill.streamName).toBe(DBM_SERVER_STREAM);
    expect(prefill.streamType).toBe("logs");
    expect(prefill.queryType).toBe("sql");
  });

  /**
   * `o2_dbm_kind` is the discriminator that makes `dbm_server` readable: the
   * one stream carries deadlocks, blocking, activity and top-query records
   * side by side. Without the predicate a "blocking" alert counts every
   * server-vantage record the collector ever wrote.
   */
  it("filters to blocking records by kind", () => {
    const sql = buildDbmLockPrefill(BLOCKING_ROW).sql!;
    expect(sql).toContain("o2_dbm_kind = 'blocking'");
    expect(sql).toContain("o2_dbm_engine = 'postgresql'");
    expect(sql).toContain("o2_dbm_instance = 'orders-db'");
  });

  it("thresholds on the longest wait, with headroom", () => {
    const sql = buildDbmLockPrefill(BLOCKING_ROW).sql!;
    expect(sql).toContain("MAX(o2_dbm_wait_seconds)");
    // 40s observed -> 60s armed.
    expect(sql).toContain("60");
  });

  it("produces a usable, unblocked prefill", () => {
    expect(isPrefillBlocked(normalizePrefill(buildDbmLockPrefill(BLOCKING_ROW)))).toBe(false);
  });
});

describe("buildDbmLockPrefill — deadlocks", () => {
  /**
   * A deadlock has no duration to threshold — the engine has already resolved
   * it by killing a victim. What matters is how OFTEN it happens, so this
   * counts records rather than reading a wait column that would be null.
   */
  it("counts events rather than reading a duration that does not exist", () => {
    const sql = buildDbmLockPrefill(DEADLOCK_ROW).sql!;
    expect(sql).toContain("o2_dbm_kind = 'deadlock'");
    expect(sql).toContain("COUNT(*)");
    expect(sql).not.toContain("o2_dbm_wait_seconds");
  });

  /**
   * One deadlock is a fact of concurrent life; a rate is the incident. The
   * alert fires above the observed count so a single retry-and-recover does
   * not page anyone.
   */
  it("arms above the observed event count rather than at one", () => {
    const sql = buildDbmLockPrefill(DEADLOCK_ROW).sql!;
    expect(sql).toMatch(/COUNT\(\*\) > 1[0-9]/);
  });

  /**
   * The threshold must be DERIVED from the observation, not a constant that
   * happens to clear the fixture. A storm of 100 deadlocks in the window has to
   * arm proportionally higher, or the alert re-fires immediately on the very
   * traffic the user just looked at and decided was the baseline.
   */
  it("scales the threshold with the observed count", () => {
    expect(suggestedDeadlockEvents(100)).toBe(150);
    expect(suggestedDeadlockEvents(40)).toBe(60);
  });

  /**
   * ...but never below a floor. Scaling alone would arm a 2-deadlock window at
   * 3, which pages somebody for concurrency working as designed.
   */
  it("holds a floor so a quiet window does not arm a hair-trigger", () => {
    expect(suggestedDeadlockEvents(2)).toBe(10);
    expect(suggestedDeadlockEvents(null)).toBe(10);
  });
});

describe("buildDbmLockPrefill — scoping is derived, not assumed", () => {
  /**
   * An alert that watches a database the user was not looking at is worse than
   * no alert: it is silent about the real one and noisy about a stranger. Both
   * identifiers must come from the input on every kind, so this walks
   * instances the rest of the suite never mentions.
   */
  it.each([
    ["postgresql", "shipping-db"],
    ["mysql", "analytics-primary"],
    ["sqlserver", "reporting-01"],
  ])("scopes a blocking alert to the %s instance it was given", (system, instance) => {
    const sql = buildDbmLockPrefill({
      kind: "blocking",
      dbSystem: system,
      dbInstance: instance,
    }).sql!;
    expect(sql).toContain(`o2_dbm_engine = '${system}'`);
    expect(sql).toContain(`o2_dbm_instance = '${instance}'`);
  });

  it("scopes a deadlock alert to the instance it was given", () => {
    const sql = buildDbmLockPrefill({
      kind: "deadlocks",
      dbSystem: "postgresql",
      dbInstance: "shipping-db",
    }).sql!;
    expect(sql).toContain("o2_dbm_engine = 'postgresql'");
    expect(sql).toContain("o2_dbm_instance = 'shipping-db'");
  });

  /**
   * The evaluation window follows the window the user was reading. Pinning it
   * to a constant would arm an alert over a span they never looked at.
   */
  it("evaluates over the window the surface was showing", () => {
    const prefill = buildDbmLockPrefill({ ...BLOCKING_ROW, periodMinutes: 60 });
    expect(prefill.periodMinutes).toBe(60);
    expect(prefill.frequencyMinutes).toBe(60);
  });
});

describe("buildDbmLockPrefill — provenance honesty", () => {
  /**
   * THE HONESTY CONTRACT. Client-observed span latency and server-reported lock
   * waits are different measurements from different vantages. An alert that
   * fires saying only "orders-db is slow" invites the reader to compare it with
   * the span-latency alert next to it in the list, and those two numbers do not
   * belong on the same axis. The name has to carry the vantage.
   */
  it("names the server vantage in the alert name", () => {
    expect(buildDbmLockPrefill(BLOCKING_ROW).name).toContain("server");
    expect(buildDbmLockPrefill(DEADLOCK_ROW).name).toContain("server");
  });

  /**
   * And says so in a warning the form renders, so the vantage survives even
   * when the user renames the alert.
   */
  it("warns that this is a server-side measurement", () => {
    const keys = buildDbmLockPrefill(BLOCKING_ROW).warnings.map((w) => w.key);
    expect(keys).toContain("dbmServerVantage");
  });

  /**
   * The blocking/deadlock surfaces are POLLED SAMPLES, not a continuous record:
   * the collector wakes on an interval and writes whatever it finds. A lock
   * that opened and closed between two samples was never recorded, so the
   * alert can miss real contention and the user has to know that.
   */
  it("warns that sampling can miss short-lived contention", () => {
    const keys = buildDbmLockPrefill(BLOCKING_ROW).warnings.map((w) => w.key);
    expect(keys).toContain("dbmLockSampling");
  });

  /**
   * The rollup-lag warning belongs to the OTHER adapter. Claiming a 15-minute
   * aggregation window on a stream that is written per sample would describe a
   * pipeline this alert does not run through.
   */
  it("does not borrow the rollup adapter's lag warning", () => {
    const keys = buildDbmLockPrefill(BLOCKING_ROW).warnings.map((w) => w.key);
    expect(keys).not.toContain("dbmRollupLag");
  });
});

describe("buildDbmLockPrefill — degradation", () => {
  /**
   * With no instance the alert still runs — it watches the whole fleet for
   * that engine, which is a coarser but honest thing to watch. It must SAY it
   * widened, or the user believes they armed an alert on one database.
   */
  it("widens to the engine and says so when there is no instance", () => {
    const prefill = buildDbmLockPrefill({ ...BLOCKING_ROW, dbInstance: null });
    expect(prefill.sql).not.toContain("o2_dbm_instance =");
    expect(prefill.warnings.map((w) => w.key)).toContain("dbmNoInstance");
  });

  it("never throws on empty input", () => {
    expect(() => buildDbmLockPrefill({ kind: "blocking" })).not.toThrow();
  });

  /**
   * A negative reading is not a small one — it is a broken one, and the guards
   * must reject it rather than scale it. Letting one through produces a
   * NEGATIVE evaluation window, which is not a window at all, and a threshold
   * below zero that fires on every record forever.
   *
   * Reachable in practice: a clock skew between the collector and the database
   * makes a computed wait go negative, and a surface handing over the wrong
   * field is a one-character mistake.
   */
  it("treats a negative reading as no reading, not as a small one", () => {
    expect(suggestedWaitSeconds(-100)).toBe(30);
    expect(suggestedDeadlockEvents(-100)).toBe(10);

    const prefill = buildDbmLockPrefill({ ...BLOCKING_ROW, periodMinutes: -30 });
    expect(prefill.periodMinutes).toBe(15);
    expect(prefill.frequencyMinutes).toBe(15);
  });

  /**
   * Same class: a non-numeric reading arriving from an untyped API response
   * must fall back rather than be coerced into a threshold.
   */
  it("treats a non-numeric reading as no reading", () => {
    expect(suggestedWaitSeconds("40" as unknown as number)).toBe(30);
    expect(suggestedDeadlockEvents("12" as unknown as number)).toBe(10);
  });

  it("still resolves a stream and a query on empty input", () => {
    const prefill = normalizePrefill(buildDbmLockPrefill({ kind: "blocking" }));
    expect(prefill.streamName).toBe(DBM_SERVER_STREAM);
    expect(isPrefillBlocked(prefill)).toBe(false);
  });
});

describe("buildDbmLockPrefill — naming", () => {
  it("builds a name that survives being an identifier", () => {
    const name = buildDbmLockPrefill(BLOCKING_ROW).name!;
    expect(name).toContain("orders-db");
    expect(name).not.toMatch(/[\s:#?&%'"]/);
  });

  it("distinguishes a blocking alert from a deadlock alert on one database", () => {
    const blocking = buildDbmLockPrefill(BLOCKING_ROW).name;
    const deadlocks = buildDbmLockPrefill({ ...BLOCKING_ROW, kind: "deadlocks" }).name;
    expect(blocking).not.toBe(deadlocks);
  });
});

describe("buildDbmLockPrefill — SQL safety", () => {
  it("escapes quotes in identifiers rather than breaking the statement", () => {
    const sql = buildDbmLockPrefill({ ...BLOCKING_ROW, dbInstance: "o'brien-db" }).sql!;
    expect(sql).toContain("o2_dbm_instance = 'o''brien-db'");
  });
});
