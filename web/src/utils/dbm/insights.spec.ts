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

import i18n from "@/locales";
import type { DbTotalsRow, QueryStatsRow } from "@/services/db_monitoring";
import {
  MAX_VISIBLE_INSIGHTS,
  deltaFor,
  detectAllFailing,
  callsDropPercent,
  detectCompletionBias,
  detectDrowningDatabases,
  detectInsights,
  detectNPlusOne,
  detectNewExpensive,
  detectRankChurn,
  detectRegression,
  detectVolumeShift,
  insightRuleParams,
  insightRuleText,
  BASELINE_COMPARED_RULES,
  DBM_TAIL_RULES,
  isCriticalErrorRate,
  splitLongTail,
  totalTimeDelta,
  type DbmInsightInput,
} from "./insights";

const MS = 1_000_000;

/** A row that passes every rule's floors, so each test changes ONE thing. */
const row = (over: Partial<QueryStatsRow> = {}): QueryStatsRow => ({
  fingerprint: "fp1",
  db_system: "postgresql",
  db_instance: "orders-db",
  query_norm: "SELECT * FROM orders WHERE id = ?",
  calls: 100,
  errors: 0,
  traces: 100,
  total_time_ns: 1000 * MS,
  p50_ns: 10 * MS,
  p95_ns: 20 * MS,
  fp_version: 1,
  ...over,
});

const input = (over: Partial<DbmInsightInput> = {}): DbmInsightInput => ({
  rows: [],
  previousRows: [],
  scopeTotalTimeNs: 10_000 * MS,
  previousScopeTotalTimeNs: 10_000 * MS,
  ...over,
});

describe("deltaFor — the three states", () => {
  it("reports a normal comparison as `changed` with a signed ratio", () => {
    expect(deltaFor(150, 100)).toEqual({
      state: "changed",
      current: 150,
      previous: 100,
      ratio: 0.5,
    });
    expect(deltaFor(50, 100)).toEqual({
      state: "changed",
      current: 50,
      previous: 100,
      ratio: -0.5,
    });
  });

  it("reports a row absent from the previous window as `new`, NOT -100%", () => {
    const delta = deltaFor(500, undefined);
    expect(delta.state).toBe("new");
    expect(delta.current).toBe(500);
    // The whole point: no ratio exists, so none is invented.
    expect(delta.ratio).toBeUndefined();
    expect(delta.previous).toBeUndefined();
  });

  it("distinguishes `new` from a genuine rise out of zero", () => {
    // Absent → present is `new`; 0 → present is `changed` with no ratio,
    // because dividing by zero is undefined rather than infinite.
    expect(deltaFor(500, undefined).state).toBe("new");

    const fromZero = deltaFor(500, 0);
    expect(fromZero.state).toBe("changed");
    expect(fromZero.previous).toBe(0);
    expect(fromZero.ratio).toBeUndefined();
  });

  it("reports a row that vanished as `gone`, keeping the previous value", () => {
    const delta = deltaFor(undefined, 900);
    expect(delta.state).toBe("gone");
    expect(delta.previous).toBe(900);
    expect(delta.current).toBeUndefined();
    expect(delta.ratio).toBeUndefined();
  });

  it("treats absent-in-both as `new` rather than throwing", () => {
    expect(deltaFor(undefined, undefined).state).toBe("new");
  });

  it("reports an unchanged value as a zero ratio, not as absent", () => {
    expect(deltaFor(100, 100)).toMatchObject({ state: "changed", ratio: 0 });
  });

  it("totalTimeDelta reads total_time_ns off both rows", () => {
    expect(totalTimeDelta(row({ total_time_ns: 200 }), row({ total_time_ns: 100 }))).toMatchObject({
      state: "changed",
      ratio: 1,
    });
    // A fingerprint with no previous row is the `new` case end-to-end.
    expect(totalTimeDelta(row({ total_time_ns: 200 }), undefined).state).toBe("new");
  });
});

describe("I1 · regression", () => {
  const previous = [row({ p95_ns: 100 * MS, calls: 100 })];

  it("fires when p95 more than triples at flat volume", () => {
    const insight = detectRegression(
      input({ rows: [row({ p95_ns: 400 * MS, calls: 100 })], previousRows: previous }),
    );
    expect(insight?.id).toBe("regression");
    expect(insight?.fingerprints).toEqual(["fp1"]);
    expect(insight?.evidence.ratio).toBe(4);
  });

  it("does not fire at exactly 3x (the rule is strictly greater)", () => {
    expect(
      detectRegression(
        input({ rows: [row({ p95_ns: 300 * MS, calls: 100 })], previousRows: previous }),
      ),
    ).toBeNull();
  });

  it("suppresses a p95 spike whose call volume collapsed — a sampling artifact", () => {
    expect(
      detectRegression(
        input({ rows: [row({ p95_ns: 900 * MS, calls: 30 })], previousRows: previous }),
      ),
    ).toBeNull();
  });

  it("ignores queries below the 20-call floor", () => {
    expect(
      detectRegression(
        input({
          rows: [row({ p95_ns: 900 * MS, calls: 5 })],
          previousRows: [row({ p95_ns: 100 * MS, calls: 5 })],
        }),
      ),
    ).toBeNull();
  });

  it("ignores micro-queries below the 5ms baseline floor", () => {
    expect(
      detectRegression(
        input({
          rows: [row({ p95_ns: 4 * MS })],
          previousRows: [row({ p95_ns: 1 * MS })],
        }),
      ),
    ).toBeNull();
  });

  it("never compares across an fp_version bump — that manufactures regressions", () => {
    expect(
      detectRegression(
        input({
          rows: [row({ p95_ns: 400 * MS, fp_version: 2 })],
          previousRows: [row({ p95_ns: 100 * MS, fp_version: 1 })],
        }),
      ),
    ).toBeNull();
  });

  it("ranks multiple regressions by total time and reports the count", () => {
    const insight = detectRegression(
      input({
        rows: [
          row({ fingerprint: "small", p95_ns: 400 * MS, total_time_ns: 10 * MS }),
          row({ fingerprint: "big", p95_ns: 400 * MS, total_time_ns: 900 * MS }),
        ],
        previousRows: [
          row({ fingerprint: "small", p95_ns: 100 * MS }),
          row({ fingerprint: "big", p95_ns: 100 * MS }),
        ],
      }),
    );
    expect(insight?.fingerprints).toEqual(["big", "small"]);
    expect(insight?.evidence.count).toBe(2);
  });
});

describe("I2 · new expensive query", () => {
  it("fires for a fingerprint absent previously that is >=5% of scope time", () => {
    const insight = detectNewExpensive(
      input({
        rows: [row({ fingerprint: "brand-new", total_time_ns: 600 * MS })],
        previousRows: [row({ fingerprint: "existing" })],
        scopeTotalTimeNs: 10_000 * MS,
      }),
    );
    expect(insight?.id).toBe("new-expensive");
    expect(insight?.evidence.share).toBeCloseTo(0.06);
  });

  it("ignores a new query too small to matter", () => {
    expect(
      detectNewExpensive(
        input({
          rows: [row({ fingerprint: "brand-new", total_time_ns: 100 * MS })],
          previousRows: [row({ fingerprint: "existing" })],
          scopeTotalTimeNs: 10_000 * MS,
        }),
      ),
    ).toBeNull();
  });

  it("ignores a new query below the 10-call floor", () => {
    expect(
      detectNewExpensive(
        input({
          rows: [row({ fingerprint: "brand-new", total_time_ns: 6000 * MS, calls: 3 })],
          previousRows: [row({ fingerprint: "existing" })],
        }),
      ),
    ).toBeNull();
  });

  it("suppresses the whole family when fp_version changed", () => {
    // A normalizer bump re-buckets traffic, making EVERY fingerprint look new.
    expect(
      detectNewExpensive(
        input({
          rows: [row({ fingerprint: "looks-new", total_time_ns: 6000 * MS, fp_version: 2 })],
          previousRows: [row({ fingerprint: "old", fp_version: 1 })],
        }),
      ),
    ).toBeNull();
  });

  it("does not treat a still-present fingerprint as new", () => {
    expect(
      detectNewExpensive(
        input({
          rows: [row({ total_time_ns: 6000 * MS })],
          previousRows: [row()],
        }),
      ),
    ).toBeNull();
  });
});

describe("I5 · N+1", () => {
  it("fires when calls-per-trace reaches 10 with enough traces and share", () => {
    const insight = detectNPlusOne(
      input({
        rows: [row({ calls: 470, traces: 20, total_time_ns: 400 * MS })],
        scopeTotalTimeNs: 10_000 * MS,
      }),
    );
    expect(insight?.id).toBe("n-plus-one");
    expect(insight?.evidence.callsPerTrace).toBeCloseTo(23.5);
  });

  it("ignores a chatty query seen in too few traces to be a pattern", () => {
    expect(
      detectNPlusOne(input({ rows: [row({ calls: 470, traces: 5, total_time_ns: 400 * MS })] })),
    ).toBeNull();
  });

  it("ignores a one-call-per-trace query", () => {
    expect(
      detectNPlusOne(input({ rows: [row({ calls: 100, traces: 100, total_time_ns: 400 * MS })] })),
    ).toBeNull();
  });

  it("ignores a chatty query below the 2% share floor", () => {
    expect(
      detectNPlusOne(
        input({
          rows: [row({ calls: 470, traces: 20, total_time_ns: 10 * MS })],
          scopeTotalTimeNs: 10_000 * MS,
        }),
      ),
    ).toBeNull();
  });
});

describe("I6 · volume shift, not slowness", () => {
  const previous = [row({ calls: 100, p95_ns: 100 * MS })];

  it("fires when calls quadruple while p95 stays flat", () => {
    const insight = detectVolumeShift(
      input({
        rows: [row({ calls: 400, p95_ns: 105 * MS, total_time_ns: 2000 * MS })],
        previousRows: previous,
        scopeTotalTimeNs: 10_000 * MS,
      }),
    );
    expect(insight?.id).toBe("volume-shift");
    expect(insight?.evidence.ratio).toBe(4);
  });

  it("does NOT fire when the query also got slower — that is a regression", () => {
    // The discriminator: this is the whole reason the insight exists.
    expect(
      detectVolumeShift(
        input({
          rows: [row({ calls: 400, p95_ns: 300 * MS, total_time_ns: 2000 * MS })],
          previousRows: previous,
          scopeTotalTimeNs: 10_000 * MS,
        }),
      ),
    ).toBeNull();
  });

  it("ignores a volume rise too small to matter", () => {
    expect(
      detectVolumeShift(
        input({
          rows: [row({ calls: 200, p95_ns: 100 * MS, total_time_ns: 2000 * MS })],
          previousRows: previous,
        }),
      ),
    ).toBeNull();
  });

  it("ignores a volume spike below the 10% share floor", () => {
    expect(
      detectVolumeShift(
        input({
          rows: [row({ calls: 400, p95_ns: 100 * MS, total_time_ns: 100 * MS })],
          previousRows: previous,
          scopeTotalTimeNs: 10_000 * MS,
        }),
      ),
    ).toBeNull();
  });
});

describe("I8 · rank churn", () => {
  /** 25 filler rows so a "from outside the top 20" move is expressible. */
  const filler = (prefix: string, count: number, base: number) =>
    Array.from({ length: count }, (_, i) =>
      row({ fingerprint: `${prefix}${i}`, total_time_ns: (base - i) * MS }),
    );

  it("fires when a query enters the top 5 from outside the top 20", () => {
    const previousRows = [
      ...filler("f", 25, 1000),
      row({ fingerprint: "climber", total_time_ns: 1 * MS }),
    ];
    const rows = [
      ...filler("f", 25, 1000),
      row({ fingerprint: "climber", total_time_ns: 5000 * MS }),
    ];
    const insight = detectRankChurn(
      input({
        rows,
        previousRows,
        scopeTotalTimeNs: 30_000 * MS,
        previousScopeTotalTimeNs: 10_000 * MS,
      }),
    );
    expect(insight?.id).toBe("rank-churn");
    expect(insight?.fingerprints).toContain("climber");
    expect(insight?.evidence.toRank).toBe(1);
  });

  it("stays quiet when total database time is flat — nobody cares who is #4", () => {
    const previousRows = [
      ...filler("f", 25, 1000),
      row({ fingerprint: "climber", total_time_ns: 1 * MS }),
    ];
    const rows = [
      ...filler("f", 25, 1000),
      row({ fingerprint: "climber", total_time_ns: 5000 * MS }),
    ];
    expect(
      detectRankChurn(
        input({
          rows,
          previousRows,
          scopeTotalTimeNs: 10_000 * MS,
          previousScopeTotalTimeNs: 10_000 * MS,
        }),
      ),
    ).toBeNull();
  });

  it("does not fire on movement within the mid-ranks", () => {
    const previousRows = filler("f", 25, 1000);
    // f10 moves up a little but never reaches the top 5.
    const rows = filler("f", 25, 1000).map((r) =>
      r.fingerprint === "f10" ? { ...r, total_time_ns: 992 * MS } : r,
    );
    expect(
      detectRankChurn(
        input({
          rows,
          previousRows,
          scopeTotalTimeNs: 30_000 * MS,
          previousScopeTotalTimeNs: 10_000 * MS,
        }),
      ),
    ).toBeNull();
  });
});

/**
 * Total failure is the one rule with NO comparison window, and that is the
 * point: every other rule here detects a CHANGE, so all of them go quiet on a
 * query that has been failing steadily since before the window opened — which
 * is exactly the query a DBA arrives looking for during a lock storm.
 */
describe("total failure", () => {
  it("fires when every call failed", () => {
    const insight = detectAllFailing(input({ rows: [row({ calls: 380, errors: 380 })] }));
    expect(insight?.id).toBe("all-failing");
    expect(insight?.tone).toBe("error");
  });

  it("carries the arithmetic the strip prints — 380 of 380", () => {
    const insight = detectAllFailing(input({ rows: [row({ calls: 380, errors: 380 })] }));
    expect(insight?.evidence.current).toBe(380);
    expect(insight?.evidence.baseline).toBe(380);
  });

  /**
   * The threshold is a SHARE, not a count, so a busy query failing a little
   * never masquerades as a total outage.
   */
  it("stays silent on a partial failure rate", () => {
    expect(detectAllFailing(input({ rows: [row({ calls: 380, errors: 379 })] }))).toBeNull();
  });

  it("stays silent when nothing failed", () => {
    expect(detectAllFailing(input({ rows: [row({ calls: 380, errors: 0 })] }))).toBeNull();
  });

  /** "All 3 of 3 failed" is a handful of calls, not a signal. */
  it("ignores a sample too small to mean anything", () => {
    expect(detectAllFailing(input({ rows: [row({ calls: 3, errors: 3 })] }))).toBeNull();
  });

  it("needs no previous window at all", () => {
    const insight = detectAllFailing(
      input({ rows: [row({ calls: 100, errors: 100 })], previousRows: [] }),
    );
    expect(insight).not.toBeNull();
  });

  it("reports the costliest failing row first when several fail", () => {
    const insight = detectAllFailing(
      input({
        rows: [
          row({ fingerprint: "cheap", calls: 50, errors: 50, total_time_ns: 10 * MS }),
          row({ fingerprint: "costly", calls: 60, errors: 60, total_time_ns: 900 * MS }),
        ],
      }),
    );
    expect(insight?.evidence.row.fingerprint).toBe("costly");
    expect(insight?.evidence.count).toBe(2);
    expect(insight?.fingerprints).toContain("cheap");
  });
});

describe("detectInsights — the cap and the ranking", () => {
  it("returns at most three cards however many rules fire", () => {
    const rows = [
      // regression + n+1 + volume shift all available at once
      row({ fingerprint: "a", p95_ns: 900 * MS, calls: 400, traces: 20, total_time_ns: 5000 * MS }),
      row({ fingerprint: "b", calls: 470, traces: 20, total_time_ns: 4000 * MS }),
      row({ fingerprint: "new", total_time_ns: 3000 * MS }),
    ];
    const previousRows = [
      row({ fingerprint: "a", p95_ns: 100 * MS, calls: 100 }),
      row({ fingerprint: "b", calls: 100, p95_ns: 100 * MS }),
    ];
    const result = detectInsights(
      input({
        rows,
        previousRows,
        scopeTotalTimeNs: 12_000 * MS,
        previousScopeTotalTimeNs: 1_000 * MS,
      }),
    );
    expect(result.length).toBeLessThanOrEqual(MAX_VISIBLE_INSIGHTS);
  });

  it("returns nothing when no rule is satisfied", () => {
    expect(detectInsights(input({ rows: [row()], previousRows: [row()] }))).toEqual([]);
  });

  it("never returns a card without the fingerprints that triggered it", () => {
    const result = detectInsights(
      input({
        rows: [row({ fingerprint: "brand-new", total_time_ns: 6000 * MS })],
        previousRows: [row({ fingerprint: "existing" })],
      }),
    );
    for (const insight of result) expect(insight.fingerprints.length).toBeGreaterThan(0);
  });
});

describe("completion-bias banner", () => {
  it("fires when call volume collapses while errors climb", () => {
    expect(detectCompletionBias([{ calls: 20, errors: 30 }], [{ calls: 100, errors: 5 }])).toBe(
      true,
    );
  });

  it("stays quiet when volume falls but errors do not", () => {
    // A quiet period is not a lock storm.
    expect(detectCompletionBias([{ calls: 20, errors: 0 }], [{ calls: 100, errors: 5 }])).toBe(
      false,
    );
  });

  it("stays quiet when volume held up", () => {
    expect(detectCompletionBias([{ calls: 95, errors: 50 }], [{ calls: 100, errors: 5 }])).toBe(
      false,
    );
  });

  it("treats any errors against a previously clean window as a rise", () => {
    // A multiplicative test against 0 could never trip, so this case is special-cased.
    expect(detectCompletionBias([{ calls: 10, errors: 3 }], [{ calls: 100, errors: 0 }])).toBe(
      true,
    );
  });

  it("cannot fire without a previous window", () => {
    expect(detectCompletionBias([{ calls: 10, errors: 10 }], [])).toBe(false);
  });

  // The banner headline quotes this number, so it has to come from the same
  // sums the detector tested rather than being recomputed at the call site.
  it("reports how far calls fell, as a whole percent", () => {
    expect(callsDropPercent([{ calls: 20 }], [{ calls: 100 }])).toBe(80);
    expect(callsDropPercent([{ calls: 33 }], [{ calls: 100 }])).toBe(67);
  });

  it("sums across rows rather than reading only the first", () => {
    expect(callsDropPercent([{ calls: 10 }, { calls: 10 }], [{ calls: 50 }, { calls: 50 }])).toBe(
      80,
    );
  });

  it("never reports a negative drop when volume rose", () => {
    expect(callsDropPercent([{ calls: 200 }], [{ calls: 100 }])).toBe(0);
  });

  it("reports no drop when there is no previous volume to fall from", () => {
    expect(callsDropPercent([{ calls: 10 }], [])).toBe(0);
    expect(callsDropPercent([{ calls: 10 }], [{ calls: 0 }])).toBe(0);
  });
});

describe("I3 · drowning databases", () => {
  const totals = (over: Partial<DbTotalsRow> = {}): DbTotalsRow => ({
    db_system: "postgresql",
    db_instance: "orders-db",
    db_namespace: "prod",
    calls: 1000,
    p95_ns: 150 * MS,
    total_time_ns: 5000 * MS,
    ...over,
  });

  it("fires when p95 more than doubles at real volume", () => {
    const result = detectDrowningDatabases(
      [totals({ p95_ns: 400 * MS })],
      [totals({ p95_ns: 150 * MS })],
    );
    expect(result).toHaveLength(1);
    expect(result[0].ratio).toBeCloseTo(400 / 150);
  });

  it("ignores a database below the 100-call floor", () => {
    expect(
      detectDrowningDatabases(
        [totals({ p95_ns: 400 * MS, calls: 10 })],
        [totals({ p95_ns: 150 * MS })],
      ),
    ).toEqual([]);
  });

  it("ignores a doubling that is still under 100ms", () => {
    expect(
      detectDrowningDatabases([totals({ p95_ns: 50 * MS })], [totals({ p95_ns: 10 * MS })]),
    ).toEqual([]);
  });

  it("shows at most two, ranked by total time", () => {
    const previous = [
      totals({ db_instance: "a", p95_ns: 150 * MS }),
      totals({ db_instance: "b", p95_ns: 150 * MS }),
      totals({ db_instance: "c", p95_ns: 150 * MS }),
    ];
    const current = [
      totals({ db_instance: "a", p95_ns: 400 * MS, total_time_ns: 10 * MS }),
      totals({ db_instance: "b", p95_ns: 400 * MS, total_time_ns: 9000 * MS }),
      totals({ db_instance: "c", p95_ns: 400 * MS, total_time_ns: 8000 * MS }),
    ];
    const result = detectDrowningDatabases(current, previous);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.row.db_instance)).toEqual(["b", "c"]);
  });

  it("cannot fire for a database with no previous window", () => {
    expect(detectDrowningDatabases([totals({ p95_ns: 400 * MS })], [])).toEqual([]);
  });
});

describe("splitLongTail — the fold", () => {
  /** A tail candidate: only the fields the split reads. */
  const tail = (fingerprint: string, share: number) => ({ fingerprint, share });

  /**
   * Filler that occupies head slots without tripping any rule, so a test can
   * clear the head floor and then exercise the ONE rule it is about.
   * Each carries 1% — at `maxRowShare`, so filler is informative and never folds.
   */
  const filler = (count: number, share = 0.01) =>
    Array.from({ length: count }, (_, i) => tail(`fill${i}`, share));

  it("folds the flat tail once the ranking has stopped mattering", () => {
    const heavy = [tail("a", 0.37), tail("b", 0.23), tail("c", 0.15), tail("d", 0.11)];
    const head = [...heavy, ...filler(10)];
    const light = Array.from({ length: 10 }, (_, i) => tail(`t${i}`, 0.0005));

    const result = splitLongTail([...head, ...light]);

    expect(result.head).toEqual(head);
    expect(result.tail).toHaveLength(10);
    expect(result.tailShare).toBeCloseTo(0.005, 5);
  });

  it("keeps a row at or above 1% even past the cut", () => {
    const head = [tail("a", 0.5), tail("b", 0.3), ...filler(12)];
    // Big enough to keep its own line however far down the list it sits.
    const big = tail("big", 0.02);
    const light = [tail("t1", 0.0005), tail("t2", 0.0005), tail("t3", 0.0005)];

    const result = splitLongTail([...head, big, ...light]);

    expect(result.head.map((r) => r.fingerprint)).toContain("big");
    expect(result.tail.map((r) => r.fingerprint)).toEqual(["t1", "t2", "t3"]);
  });

  it("does not fold a flat fleet where no single row is negligible", () => {
    // Twenty rows at 5% each: nothing here is small, so nothing folds.
    const rows = Array.from({ length: 20 }, (_, i) => tail(`f${i}`, 0.05));

    const result = splitLongTail(rows);

    expect(result.tail).toEqual([]);
    expect(result.head).toHaveLength(20);
  });

  it("shows the tail rather than trading a row for a click below the minimum", () => {
    // Only two rows would fold — and the fold row itself costs one of them back.
    const rows = [...filler(14, 0.05), tail("t1", 0.0005), tail("t2", 0.0005)];

    const result = splitLongTail(rows);

    expect(result.tail).toEqual([]);
    expect(result.head).toHaveLength(16);
    expect(result.tailShare).toBe(0);
  });

  it("never folds a row an insight named, however small it is", () => {
    const head = [tail("a", 0.5), ...filler(13)];
    const light = [
      tail("t1", 0.0005),
      tail("failing", 0.0005),
      tail("t2", 0.0005),
      tail("t3", 0.0005),
    ];

    const result = splitLongTail([...head, ...light], new Set(["failing"]));

    expect(result.head.map((r) => r.fingerprint)).toContain("failing");
    expect(result.tail.map((r) => r.fingerprint)).toEqual(["t1", "t2", "t3"]);
  });

  it("treats a non-finite share as zero rather than poisoning the running total", () => {
    const rows = [
      tail("a", 0.5),
      ...filler(13),
      tail("t1", Number.NaN),
      tail("t2", 0.0005),
      tail("t3", 0.0005),
    ];

    const result = splitLongTail(rows);

    expect(result.tail).toHaveLength(3);
    expect(Number.isFinite(result.tailShare)).toBe(true);
  });

  it("folds even when a large remainder keeps the listed rows short of 95%", () => {
    // The bug this pins: shares are measured against the whole scope, which
    // includes a remainder bucket we have no per-query numbers for. On real
    // data that bucket held 7.7%, so the ranked rows summed to ~92% and a
    // 95%-OF-SCOPE gate could never be reached — the fold silently never fired
    // on exactly the Pareto-shaped data it exists for. Normalising to the
    // listed rows' own total is what makes the cut reachable.
    const heavy = [
      tail("a", 0.3726),
      tail("b", 0.2296),
      tail("c", 0.1474),
      tail("d", 0.1127),
      tail("e", 0.0234),
      tail("f", 0.0114),
    ];
    const light = Array.from({ length: 28 }, (_, i) => tail(`t${i}`, 0.0011));

    const result = splitLongTail([...heavy, ...light]);

    // All six informative rows list; every indistinguishable row folds.
    expect(result.head).toEqual(heavy);
    expect(result.tail).toHaveLength(28);
  });

  it("puts the cut in the same place regardless of how big the remainder is", () => {
    const shape = [0.4, 0.25, 0.16, 0.12, 0.025, 0.012];
    const light = Array.from({ length: 20 }, () => 0.0012);
    const build = (scale: number) =>
      [...shape, ...light].map((share, i) => tail(`r${i}`, share * scale));

    const wide = splitLongTail(build(1));
    const narrow = splitLongTail(build(0.92));

    expect(wide.head).toHaveLength(narrow.head.length);
    expect(wide.tail).toHaveLength(narrow.tail.length);
  });

  it("returns everything as head for an empty list", () => {
    expect(splitLongTail([])).toEqual({ head: [], tail: [], tailShare: 0 });
  });

  /**
   * The screenshot review that produced these rules: five distinct queries, then
   * eight `SELECT cNN FROM table_? WHERE k = ?` rows at 0% and no other signal,
   * then a fold. The eight were indistinguishable at a glance and occupied the
   * prime rows above the fold — exactly the noise the fold exists to remove.
   */
  describe("folds on information, not on remaining screen space", () => {
    /** The five genuinely distinct queries from the reviewed screenshot. */
    const meaningful = [
      tail("orders", 0.23),
      tail("order_items", 0.15),
      tail("products", 0.11),
      tail("users", 0.02),
      { ...tail("inventory", 0.01), errors: 769 },
    ];
    /** The eight near-identical 0%-of-database rows behind them. */
    const identical = Array.from({ length: 8 }, (_, i) => tail(`c${i}`, 0.0009));

    it("folds a run of identical 0% rows even with room on screen for them", () => {
      const result = splitLongTail([...meaningful, ...identical]);

      expect(result.head).toEqual(meaningful);
      expect(result.tail).toHaveLength(8);
    });

    it("folds the dead run even when the 95% line has not been reached", () => {
      // Cumulative share never crosses `keepShare` here, so only the dead-run
      // test can fire — which is the point: a run the reader cannot tell apart
      // is noise regardless of where the whole list's curve has got to.
      const rows = [...filler(6, 0.15), ...Array.from({ length: 6 }, (_, i) => tail(`d${i}`, 0))];

      const result = splitLongTail(rows);

      expect(result.head).toHaveLength(6);
      expect(result.tail).toHaveLength(6);
    });

    it("does not fold a short run of quiet rows", () => {
      // Three uninformative rows is not a run: below `minDeadRun`, and with the
      // cumulative curve still climbing the whole-list cut has not fired either.
      const rows = [
        ...filler(6, 0.15),
        tail("d0", 0.005),
        tail("d1", 0.004),
        tail("d2", 0.003),
        ...filler(3, 0.02),
      ];

      const result = splitLongTail(rows);

      expect(result.tail).toEqual([]);
      expect(result.head).toHaveLength(12);
    });

    it("keeps a tiny row that is failing calls", () => {
      const failing = { ...tail("failing", 0.0009), errors: 3 };
      const result = splitLongTail([...meaningful, ...identical, failing]);

      expect(result.head.map((r) => r.fingerprint)).toContain("failing");
      expect(result.tail.map((r) => r.fingerprint)).not.toContain("failing");
    });

    it("keeps a tiny row that runs many times per request", () => {
      const looping = { ...tail("looping", 0.0009), callsPerTrace: 15 };
      const result = splitLongTail([...meaningful, ...identical, looping]);

      expect(result.head.map((r) => r.fingerprint)).toContain("looping");
    });

    it("keeps a tiny row whose time changed notably since the last window", () => {
      const spiked = { ...tail("spiked", 0.0009), deltaRatio: 1.4 };
      const collapsed = { ...tail("collapsed", 0.0009), deltaRatio: -0.8 };
      const result = splitLongTail([...meaningful, ...identical, spiked, collapsed]);

      expect(result.head.map((r) => r.fingerprint)).toEqual(
        expect.arrayContaining(["spiked", "collapsed"]),
      );
    });

    it("keeps a tiny row an insight named even inside the dead run", () => {
      const named = tail("named", 0.0009);
      const rows = [...meaningful, ...identical.slice(0, 4), named, ...identical.slice(4)];

      const result = splitLongTail(rows, new Set(["named"]));

      expect(result.head.map((r) => r.fingerprint)).toContain("named");
      expect(result.tail).toHaveLength(8);
    });

    it("keeps at least the Pareto head however lopsided the shares are", () => {
      // One query at 99% and eleven rounding errors. Folding to a single row
      // would leave the reader unable to tell "one query is hot" from "we only
      // found one query", so the floor holds the shape of the ranking on screen.
      const rows = [tail("hot", 0.99), ...Array.from({ length: 11 }, (_, i) => tail(`t${i}`, 0.0))];

      const result = splitLongTail(rows);

      expect(result.head).toHaveLength(DBM_TAIL_RULES.minHeadRows);
      expect(result.tail).toHaveLength(7);
    });

    it("does not fold when every row carries a signal", () => {
      // No real tail: few rows, each either big enough or carrying failures.
      const rows = [
        tail("a", 0.4),
        tail("b", 0.3),
        tail("c", 0.2),
        { ...tail("d", 0.0005), errors: 12 },
        { ...tail("e", 0.0005), callsPerTrace: 22 },
      ];

      const result = splitLongTail(rows);

      expect(result.tail).toEqual([]);
      expect(result.head).toHaveLength(5);
    });

    it("does not fold a dead run that sits in the middle of the list", () => {
      // A run that is interrupted before the end is a shape the reader can still
      // navigate by — only a run reaching the bottom of the ranking is tail.
      const rows = [
        ...filler(6, 0.15),
        ...Array.from({ length: 5 }, (_, i) => tail(`d${i}`, 0)),
        tail("big", 0.05),
      ];

      const result = splitLongTail(rows);

      expect(result.tail).toEqual([]);
      expect(result.head).toHaveLength(12);
    });
  });
});

describe("isCriticalErrorRate", () => {
  // The bug this exists for: one failed call in 26,000 reddened a whole
  // database row, so red stopped meaning "look here".
  it("does not redden a busy database over a single failure", () => {
    expect(isCriticalErrorRate(1, 26_000)).toBe(false);
  });

  it("reddens a meaningful failure rate", () => {
    expect(isCriticalErrorRate(300, 1_000)).toBe(true);
    expect(isCriticalErrorRate(10, 1_000)).toBe(true);
  });

  it("holds fire below the rate floor", () => {
    expect(isCriticalErrorRate(9, 1_000)).toBe(false);
  });

  // A rate over three calls is not a rate.
  it("holds fire below the call floor, however bad the ratio looks", () => {
    expect(isCriticalErrorRate(3, 3)).toBe(false);
    expect(isCriticalErrorRate(19, 19)).toBe(false);
    expect(isCriticalErrorRate(20, 20)).toBe(true);
  });

  it("treats missing counts as no failures", () => {
    expect(isCriticalErrorRate(undefined, 1_000)).toBe(false);
    expect(isCriticalErrorRate(null, null)).toBe(false);
  });
});

/**
 * W5/B12. The rule line is the insight engine's honesty surface: it states the
 * arithmetic that fired the card, so the numbers on screen cannot drift from
 * the numbers in the predicate. Once the baseline is SELECTABLE, a rule line
 * that says only "than earlier" no longer identifies which comparison produced
 * the number — the same 3x could be against the previous hour or against
 * yesterday, and a reader cannot tell them apart.
 *
 * So every rule that compares two windows must NAME its baseline, and every
 * rule that does not compare windows must not claim one.
 */
describe("insightRuleParams names the baseline it compared against", () => {
  const t = (key: string) => i18n.global.t(key);

  it("passes the chosen baseline through to every two-window rule", () => {
    for (const id of BASELINE_COMPARED_RULES) {
      const { params } = insightRuleParams(id, "yesterday");
      expect(params.baseline, `${id} must carry its baseline`).toBe(
        "dbm.insights.baseline.yesterday",
      );
    }
  });

  /**
   * The text must actually CHANGE with the baseline. A param that is threaded
   * through but never interpolated would leave two different comparisons
   * rendering the same sentence, which is the misattribution this guards.
   */
  it("renders a different sentence for a different baseline", () => {
    for (const id of BASELINE_COMPARED_RULES) {
      const previous = insightRuleParams(id, "previous");
      const yesterday = insightRuleParams(id, "yesterday");
      // Render the way the view does: the baseline param is a KEY, so the view
      // translates it before interpolating the sentence around it.
      const render = (r: ReturnType<typeof insightRuleParams>) =>
        i18n.global.t(
          r.key as never,
          {
            ...r.params,
            ...(r.params.baseline ? { baseline: t(String(r.params.baseline)) } : {}),
          } as never,
        );
      expect(render(previous), `${id} renders identically for both baselines`).not.toBe(
        render(yesterday),
      );
      expect(render(yesterday)).toContain(t("dbm.insights.baseline.yesterday"));
    }
  });

  /**
   * `n-plus-one` counts calls inside ONE window and `all-failing` reads the
   * current window's error rate. Neither compares against a baseline, so naming
   * one would assert a comparison that never happened — the exact
   * misattribution the honesty contract forbids.
   */
  it("does not name a baseline on rules that compare nothing", () => {
    for (const id of ["n-plus-one", "all-failing"] as const) {
      expect(BASELINE_COMPARED_RULES).not.toContain(id);
      const { params } = insightRuleParams(id, "yesterday");
      expect(
        params.baseline,
        `${id} compares one window and must claim no baseline`,
      ).toBeUndefined();
    }
  });

  /** Defaulting keeps every existing caller honest rather than blank. */
  it("names the default baseline when no choice is supplied", () => {
    const { params } = insightRuleParams("regression");
    expect(params.baseline).toBe("dbm.insights.baseline.previous");
  });
});

/**
 * W5. Both surfaces that print a rule — the strip's hover and the row chip's
 * tooltip — must resolve the baseline the SAME way. The key-to-prose step is
 * the one place the naming can be dropped, so it lives in one function rather
 * than being repeated at each call site.
 */
describe("insightRuleText", () => {
  const translate = (key: string, params?: Record<string, unknown>) =>
    i18n.global.t(key as never, (params ?? {}) as never);

  it("resolves the baseline key into the sentence", () => {
    const text = insightRuleText("regression", "yesterday", translate);
    expect(text).toContain(i18n.global.t("dbm.insights.baseline.yesterday"));
    // ...and not the raw key, which is what a missed translation looks like.
    expect(text).not.toContain("dbm.insights.baseline");
  });

  it("says something different for each baseline", () => {
    expect(insightRuleText("regression", "previous", translate)).not.toBe(
      insightRuleText("regression", "yesterday", translate),
    );
  });

  /** A single-window rule must come through with no baseline claim attached. */
  it("leaves a single-window rule unqualified", () => {
    const text = insightRuleText("all-failing", "yesterday", translate);
    expect(text).toBe(i18n.global.t("dbm.insights.all-failing.rule", { calls: 20 } as never));
    expect(text).not.toContain(i18n.global.t("dbm.insights.baseline.yesterday"));
  });
});
