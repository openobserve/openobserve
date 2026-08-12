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

import { describe, it, expect } from "vitest";

import {
  DBM_RECOMMENDATION_RULES,
  detectUnusedIndexes,
  detectLongRunningQueries,
  detectHighImpactBlockers,
  detectHighRowCount,
  buildRecommendations,
  recommendationEngineSupport,
  recommendationsEmptyCause,
  recommendationRuleParams,
  collapseRecommendations,
  RECOMMENDATION_IDS,
  type IndexHealthRow,
} from "./recommendations";
import type { ActivitySession, BlockingSample } from "@/services/db_monitoring";

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// Values are transcribed from the live rig, and every group uses at least TWO
// materially different rows: a suite where one fixture carries every assertion
// cannot tell a parser from a hard-coded lookup, which is how two stub attacks
// survived W10.

/** The real never-scanned index on the rig: 2.8 MB, `idx_scan = 0`. */
const unusedIndex = (over: Partial<IndexHealthRow> = {}): IndexHealthRow => ({
  index_name: "idx_orders_note_unused",
  relation: "orders",
  schema: "public",
  instance: "pg-primary:5432",
  engine: "postgresql",
  index_bytes: 2_859_008,
  idx_scan_count: 0,
  idx_tup_read: 0,
  idx_tup_fetch: 0,
  last_seen: 1_786_505_777_063_921,
  ...over,
});

/** The real heavily-used index — inverted in every numeric field. */
const usedIndex = (over: Partial<IndexHealthRow> = {}): IndexHealthRow => ({
  index_name: "demo_orders_status_idx",
  relation: "demo_orders",
  schema: "public",
  instance: "pg-primary:5432",
  engine: "postgresql",
  index_bytes: 2_301_952,
  idx_scan_count: 44_916,
  idx_tup_read: 2_937_877_460,
  idx_tup_fetch: 2_222_646_612,
  last_seen: 1_786_505_777_063_921,
  ...over,
});

const session = (over: Partial<ActivitySession> = {}): ActivitySession =>
  ({
    timestamp: 1_786_505_777_063_921,
    session_pid: 12_993,
    state: "active",
    query: "SELECT * FROM orders WHERE note LIKE ?",
    fingerprint: "a346773c73151347",
    exec_time_ms: 1_000,
    db_system: "postgresql",
    db_instance: "pg-primary:5432",
    ...over,
  }) as ActivitySession;

const blockingSample = (over: Partial<BlockingSample> = {}): BlockingSample =>
  ({
    timestamp: 1_786_505_607_069_012,
    blocked_pid: 56,
    blocking_pid: 63,
    blocked_query: "UPDATE accounts SET balance = balance - ? WHERE id = ?",
    blocking_query: "UPDATE accounts SET balance = balance + ? WHERE id = ?",
    blocked_fingerprint: "680a493eab2a0967",
    blocking_fingerprint: "76189e109e4c494c",
    wait_seconds: 30,
    db_system: "postgresql",
    db_instance: "pg-primary:5432",
    ...over,
  }) as BlockingSample;

// ─── R1 · Unused index ───────────────────────────────────────────────────────

describe("detectUnusedIndexes", () => {
  it("fires on an index whose lifetime scan count is zero", () => {
    const found = detectUnusedIndexes([unusedIndex(), usedIndex()]);

    expect(found).toHaveLength(1);
    expect(found[0].indexName).toBe("idx_orders_note_unused");
    expect(found[0].relation).toBe("orders");
    expect(found[0].indexBytes).toBe(2_859_008);
  });

  it("never fires on an index that HAS been scanned", () => {
    expect(detectUnusedIndexes([usedIndex()])).toEqual([]);
  });

  it("ignores an index below the size floor, so a finding is worth acting on", () => {
    const tiny = unusedIndex({ index_name: "accounts_pkey", index_bytes: 16_384 });
    expect(tiny.index_bytes).toBeLessThan(DBM_RECOMMENDATION_RULES.unusedIndex.minBytes);
    expect(detectUnusedIndexes([tiny])).toEqual([]);
  });

  /**
   * A UNIQUE index is a CONSTRAINT. `idx_scan = 0` on it means the planner has
   * not chosen it for a lookup — it does NOT mean the constraint is unused, and
   * dropping it changes what the schema permits. Reporting it beside an
   * ordinary index would invite exactly that mistake.
   */
  it("excludes unique/primary-key indexes, which enforce a constraint", () => {
    const pk = unusedIndex({
      index_name: "accounts_pkey",
      index_bytes: 5_000_000,
      is_unique: true,
    });
    expect(detectUnusedIndexes([pk])).toEqual([]);
  });

  /**
   * Verified on the live rig: three of the six largest indexes there are
   * `*_pkey`, so an explicit `false` must still fire — otherwise the guard
   * would exclude every ordinary index and the rule would report nothing.
   */
  it("still fires on an index explicitly marked NOT unique", () => {
    const ordinary = unusedIndex({ is_unique: false });
    expect(detectUnusedIndexes([ordinary])).toHaveLength(1);
  });

  /**
   * A recipe that predates the `is_unique` column reports nothing for it. The
   * rule cannot exclude constraints then, so it still fires — but the copy
   * carries the caveat rather than this module inventing a uniqueness value.
   */
  it("fires when uniqueness is unknown, rather than silently reporting nothing", () => {
    const unknown = unusedIndex({ is_unique: null });
    expect(detectUnusedIndexes([unknown])).toHaveLength(1);
  });

  it("ranks the largest index first, so the biggest reclaim leads", () => {
    // Above the size floor, so this test measures ORDER and not the floor.
    const small = unusedIndex({ index_name: "small_idx", index_bytes: 2_000_000 });
    const big = unusedIndex({ index_name: "big_idx", index_bytes: 9_000_000 });
    const found = detectUnusedIndexes([small, big]);
    expect(found.map((f) => f.indexName)).toEqual(["big_idx", "small_idx"]);
  });

  /**
   * A missing counter is NOT a zero. `idx_scan_count = null` means the column
   * was never projected, and calling that "never scanned" reports a finding
   * about a measurement that does not exist.
   */
  it("treats a missing scan count as unknown, never as zero", () => {
    expect(detectUnusedIndexes([unusedIndex({ idx_scan_count: null })])).toEqual([]);
  });
});

// ─── R2 · Long-running query ─────────────────────────────────────────────────

describe("detectLongRunningQueries", () => {
  it("fires on a session running longer than the threshold", () => {
    const slow = session({ session_pid: 999, exec_time_ms: 120_000 });
    const found = detectLongRunningQueries([slow, session({ exec_time_ms: 5 })]);

    expect(found).toHaveLength(1);
    expect(found[0].pid).toBe(999);
    expect(found[0].runningMs).toBe(120_000);
  });

  it("does not fire below the threshold", () => {
    const under = DBM_RECOMMENDATION_RULES.longRunning.minRunningMs - 1;
    expect(detectLongRunningQueries([session({ exec_time_ms: under })])).toEqual([]);
  });

  /**
   * An IDLE session is not running anything. Its `exec_time_ms` is the age of
   * the statement it last ran, so reporting it as "running for 20 minutes"
   * describes a query that finished.
   */
  it("only counts sessions that are actually executing", () => {
    const idle = session({ state: "idle", exec_time_ms: 600_000 });
    expect(detectLongRunningQueries([idle])).toEqual([]);
  });

  it("ranks the longest-running first", () => {
    const a = session({ session_pid: 1, exec_time_ms: 60_000 });
    const b = session({ session_pid: 2, exec_time_ms: 600_000 });
    expect(detectLongRunningQueries([a, b]).map((f) => f.pid)).toEqual([2, 1]);
  });

  it("ignores a session with no duration measurement", () => {
    expect(detectLongRunningQueries([session({ exec_time_ms: null })])).toEqual([]);
  });
});

// ─── R3 · High-impact blocker ────────────────────────────────────────────────

describe("detectHighImpactBlockers", () => {
  it("fires on a root blocker holding up at least the minimum sessions", () => {
    // One root (63) blocking three sessions.
    const samples = [
      blockingSample({ blocked_pid: 56, blocking_pid: 63 }),
      blockingSample({ blocked_pid: 57, blocking_pid: 63 }),
      blockingSample({ blocked_pid: 58, blocking_pid: 63 }),
    ];
    const found = detectHighImpactBlockers(samples);

    expect(found).toHaveLength(1);
    expect(found[0].rootPid).toBe(63);
    expect(found[0].blockedCount).toBe(3);
  });

  it("does not fire on a blocker below the blocked-session floor", () => {
    // A single blocked session is an ordinary lock wait, not a pile-up.
    expect(detectHighImpactBlockers([blockingSample()])).toEqual([]);
  });

  /** Transitive depth counts: A→B→C is C blocking two, not two unrelated pairs. */
  it("counts sessions blocked transitively through the chain", () => {
    const samples = [
      blockingSample({ blocked_pid: 10, blocking_pid: 11 }),
      blockingSample({ blocked_pid: 11, blocking_pid: 12 }),
      blockingSample({ blocked_pid: 13, blocking_pid: 12 }),
    ];
    const found = detectHighImpactBlockers(samples);
    expect(found).toHaveLength(1);
    expect(found[0].rootPid).toBe(12);
    expect(found[0].blockedCount).toBe(3);
  });

  it("ranks the widest pile-up first", () => {
    const samples = [
      // root 63 blocks 2
      blockingSample({ blocked_pid: 56, blocking_pid: 63 }),
      blockingSample({ blocked_pid: 57, blocking_pid: 63 }),
      // root 99 blocks 4
      blockingSample({ blocked_pid: 70, blocking_pid: 99, db_instance: "pg2" }),
      blockingSample({ blocked_pid: 71, blocking_pid: 99, db_instance: "pg2" }),
      blockingSample({ blocked_pid: 72, blocking_pid: 99, db_instance: "pg2" }),
      blockingSample({ blocked_pid: 73, blocking_pid: 99, db_instance: "pg2" }),
    ];
    expect(detectHighImpactBlockers(samples).map((f) => f.rootPid)).toEqual([99, 63]);
  });
});

// ─── R5 · High row count ─────────────────────────────────────────────────────

describe("detectHighRowCount", () => {
  it("fires when mean rows per call crosses the threshold", () => {
    const found = detectHighRowCount({
      fingerprint: "abc",
      calls: 100,
      rows: 5_000_000,
      queryText: "SELECT * FROM order_lines",
    });

    expect(found).not.toBeNull();
    expect(found?.rowsPerCall).toBe(50_000);
    expect(found?.calls).toBe(100);
  });

  it("does not fire on a query returning few rows per call", () => {
    expect(
      detectHighRowCount({ fingerprint: "abc", calls: 100, rows: 100, queryText: "SELECT 1" }),
    ).toBeNull();
  });

  /** A ratio over a handful of calls is noise, not a pattern. */
  it("requires a minimum call count before quoting a mean", () => {
    const belowFloor = DBM_RECOMMENDATION_RULES.highRowCount.minCalls - 1;
    expect(
      detectHighRowCount({
        fingerprint: "abc",
        calls: belowFloor,
        rows: belowFloor * 1_000_000,
        queryText: "SELECT *",
      }),
    ).toBeNull();
  });

  it("returns null rather than dividing by zero or by a missing count", () => {
    expect(detectHighRowCount({ fingerprint: "a", calls: 0, rows: 10, queryText: "x" })).toBeNull();
    expect(
      detectHighRowCount({ fingerprint: "a", calls: null, rows: 10, queryText: "x" }),
    ).toBeNull();
    expect(
      detectHighRowCount({ fingerprint: "a", calls: 100, rows: null, queryText: "x" }),
    ).toBeNull();
  });
});

// ─── Assembly, engine coverage and the honesty contract ──────────────────────

describe("buildRecommendations", () => {
  it("collects every fired rule, most severe first", () => {
    const out = buildRecommendations({
      indexes: [unusedIndex()],
      sessions: [session({ exec_time_ms: 600_000 })],
      blocking: [
        blockingSample({ blocked_pid: 56, blocking_pid: 63 }),
        blockingSample({ blocked_pid: 57, blocking_pid: 63 }),
      ],
      serverMetrics: null,
    });

    const ids = out.map((r) => r.id);
    expect(ids).toContain("unused-index");
    expect(ids).toContain("long-running-query");
    expect(ids).toContain("high-impact-blocker");
    // Blocking holds up other sessions right now; an unused index does not.
    expect(ids.indexOf("high-impact-blocker")).toBeLessThan(ids.indexOf("unused-index"));
  });

  it("returns nothing when no rule's threshold is crossed", () => {
    expect(
      buildRecommendations({
        indexes: [usedIndex()],
        sessions: [session({ exec_time_ms: 5 })],
        blocking: [],
        serverMetrics: null,
      }),
    ).toEqual([]);
  });

  it("carries the evidence each rule measured, so a card can show its arithmetic", () => {
    const [rec] = buildRecommendations({
      indexes: [unusedIndex()],
      sessions: [],
      blocking: [],
      serverMetrics: null,
    });
    expect(rec.evidence.indexBytes).toBe(2_859_008);
    expect(rec.subject).toBe("public.orders.idx_orders_note_unused");
  });
});

describe("engine coverage", () => {
  /**
   * The index and table feeds are Postgres-only. A MySQL user seeing an empty
   * list would read it as "no unused indexes", which is an all-clear about a
   * check that never ran — the single most dangerous empty state here.
   */
  it("reports index-derived rules as uncollected on non-Postgres engines", () => {
    expect(recommendationEngineSupport("unused-index", "postgresql")).toBe("supported");
    expect(recommendationEngineSupport("unused-index", "mysql")).toBe("unsupported");
    expect(recommendationEngineSupport("unused-index", "mssql")).toBe("unsupported");
  });

  /** Activity and blocking are collected on every engine with a recipe. */
  it("reports session-derived rules as supported across engines", () => {
    for (const engine of ["postgresql", "mysql", "mariadb", "mssql"]) {
      expect(recommendationEngineSupport("long-running-query", engine)).toBe("supported");
      expect(recommendationEngineSupport("high-impact-blocker", engine)).toBe("supported");
    }
  });

  it("distinguishes 'nothing found' from 'not collected for this engine'", () => {
    expect(recommendationsEmptyCause([], "mysql")).toBe("engine-partial");
    expect(recommendationsEmptyCause([], "postgresql")).toBe("all-clear");
    // A non-empty list has no empty state at all.
    expect(
      recommendationsEmptyCause(
        buildRecommendations({
          indexes: [unusedIndex()],
          sessions: [],
          blocking: [],
          serverMetrics: null,
        }),
        "postgresql",
      ),
    ).toBeNull();
  });
});

describe("the honesty contract", () => {
  /**
   * Every rule states the ARITHMETIC it applied. The threshold printed on
   * screen is read from the same constant the predicate evaluates, so the two
   * cannot drift.
   */
  it("names its threshold from the constant the predicate uses", () => {
    const unused = recommendationRuleParams("unused-index");
    expect(unused.params.bytes).toBe(DBM_RECOMMENDATION_RULES.unusedIndex.minBytes);

    const long = recommendationRuleParams("long-running-query");
    expect(long.params.seconds).toBe(DBM_RECOMMENDATION_RULES.longRunning.minRunningMs / 1000);

    const blocker = recommendationRuleParams("high-impact-blocker");
    expect(blocker.params.sessions).toBe(DBM_RECOMMENDATION_RULES.highImpactBlocker.minBlocked);
  });

  /**
   * The scan counters are LIFETIME totals since the last `pg_stat_reset()`.
   * "Not scanned in this window" would be a strictly stronger claim than a
   * cumulative counter can support, so the unused-index rule must name the
   * counter's lifetime and must NOT name the page's time range.
   */
  it("phrases the unused-index rule against the counter lifetime, not the window", () => {
    const { key, params } = recommendationRuleParams("unused-index");
    expect(key).toBe("dbm.recommendations.unused-index.rule");
    expect(params.cumulative).toBe(true);
  });

  /**
   * These are single-observation rules. Naming a baseline would assert a
   * window-over-window comparison that never happened — the same exclusion
   * `BASELINE_COMPARED_RULES` pins for the insight rules.
   */
  it("never names a baseline on a rule that compared no windows", () => {
    // Guard the loop itself: an empty id list makes every assertion below
    // vacuously true, which is how a "green" contract test hides a dropped rule.
    expect(RECOMMENDATION_IDS.length).toBe(4);
    for (const id of RECOMMENDATION_IDS) {
      const { params } = recommendationRuleParams(id);
      expect(params.baseline).toBeUndefined();
    }
  });

  /**
   * A recommendation may state what was measured and what threshold it crossed.
   * It may not assert a CAUSE or promise an OUTCOME: "dropping this index will
   * speed up writes" is unsupportable from a scan counter.
   */
  it("keeps every rule id free of outcome-promising vocabulary", () => {
    expect(RECOMMENDATION_IDS.length).toBe(4);
    for (const id of RECOMMENDATION_IDS) {
      expect(id).not.toMatch(/drop|delete|fix|improve|faster|speed|optimi[sz]e/i);
    }
  });
});

// ─── Volume · collapsing a per-item list into a per-rule one ─────────────────

describe("collapseRecommendations", () => {
  /**
   * The volume problem this exists to solve. `buildRecommendations` emits ONE
   * ENTRY PER DETECTED ITEM — one per blocker, one per long-running query — so
   * a busy database renders dozens of list items and the strip stops being
   * readable. There are only four RULES, so the collapsed list is bounded at
   * four rows no matter how many items fired.
   */
  it("emits one row per rule, not one per detected item", () => {
    const built = buildRecommendations({
      indexes: [],
      sessions: [
        session({ session_pid: 1, exec_time_ms: 600_000 }),
        session({ session_pid: 2, exec_time_ms: 300_000 }),
        session({ session_pid: 3, exec_time_ms: 120_000 }),
      ],
      blocking: [],
      serverMetrics: null,
    });
    // Precondition: the uncollapsed list really is one-per-item.
    expect(built).toHaveLength(3);

    const collapsed = collapseRecommendations(built);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].rec.id).toBe("long-running-query");
  });

  /**
   * Which item survives is not arbitrary. `buildRecommendations` sorts each
   * rule's findings worst-first (longest running, most sessions blocked), so
   * the retained row must be the FIRST of its rule — collapsing to the mildest
   * example would understate the finding.
   */
  it("keeps the worst item of each rule as the representative", () => {
    const collapsed = collapseRecommendations(
      buildRecommendations({
        indexes: [],
        sessions: [
          session({ session_pid: 7, exec_time_ms: 90_000 }),
          session({ session_pid: 9, exec_time_ms: 900_000 }),
        ],
        blocking: [],
        serverMetrics: null,
      }),
    );

    expect(collapsed).toHaveLength(1);
    // pid 9 ran for 15 minutes; pid 7 for 90 seconds.
    expect(collapsed[0].rec.subject).toBe("9");
    expect(collapsed[0].rec.evidence.runningMs).toBe(900_000);
  });

  /**
   * THE HONESTY CLAUSE. Hiding entries is only acceptable if the reader can
   * SEE that entries are hidden. `hiddenCount` is how the strip says "and 2
   * more" — a collapse that silently dropped them would present the list as
   * more complete than it is, which is exactly what this feature's contract
   * forbids.
   */
  it("reports how many items each row stands for, so nothing is hidden silently", () => {
    const collapsed = collapseRecommendations(
      buildRecommendations({
        indexes: [],
        sessions: [
          session({ session_pid: 1, exec_time_ms: 600_000 }),
          session({ session_pid: 2, exec_time_ms: 300_000 }),
          session({ session_pid: 3, exec_time_ms: 120_000 }),
        ],
        blocking: [],
        serverMetrics: null,
      }),
    );

    expect(collapsed[0].totalCount).toBe(3);
    // Three matched, one is shown, so two are represented but not rendered.
    expect(collapsed[0].hiddenCount).toBe(2);
  });

  /** A rule that matched exactly once hides nothing and must not claim to. */
  it("hides nothing when a rule matched a single item", () => {
    const collapsed = collapseRecommendations(
      buildRecommendations({
        indexes: [unusedIndex()],
        sessions: [],
        blocking: [],
        serverMetrics: null,
      }),
    );

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].totalCount).toBe(1);
    expect(collapsed[0].hiddenCount).toBe(0);
  });

  /**
   * Collapsing must not reorder the rules. `buildRecommendations` ranks by what
   * the finding costs right now; a blocker holding sessions has to stay above a
   * standing storage cost after the collapse.
   */
  it("preserves the severity ranking across rules", () => {
    const collapsed = collapseRecommendations(
      buildRecommendations({
        indexes: [unusedIndex()],
        sessions: [session({ exec_time_ms: 600_000 })],
        blocking: [
          blockingSample({ blocked_pid: 56, blocking_pid: 63 }),
          blockingSample({ blocked_pid: 57, blocking_pid: 63 }),
        ],
        serverMetrics: null,
      }),
    );

    expect(collapsed.map((c) => c.rec.id)).toEqual([
      "high-impact-blocker",
      "long-running-query",
      "unused-index",
    ]);
  });

  /** Four rules is the ceiling, however many items fired. */
  it("never exceeds one row per rule id", () => {
    const collapsed = collapseRecommendations(
      buildRecommendations({
        indexes: Array.from({ length: 12 }, (_, i) =>
          unusedIndex({ index_name: `idx_${i}`, index_bytes: 2_000_000 + i }),
        ),
        sessions: Array.from({ length: 30 }, (_, i) =>
          session({ session_pid: i, exec_time_ms: 100_000 + i }),
        ),
        blocking: [
          blockingSample({ blocked_pid: 56, blocking_pid: 63 }),
          blockingSample({ blocked_pid: 57, blocking_pid: 63 }),
        ],
        serverMetrics: null,
      }),
    );

    expect(collapsed.length).toBeLessThanOrEqual(RECOMMENDATION_IDS.length);
    expect(new Set(collapsed.map((c) => c.rec.id)).size).toBe(collapsed.length);
    // 12 unused indexes collapse to one row that says so.
    const unusedRow = collapsed.find((c) => c.rec.id === "unused-index");
    expect(unusedRow?.totalCount).toBe(12);
    expect(unusedRow?.hiddenCount).toBe(11);
  });

  it("returns an empty list unchanged", () => {
    expect(collapseRecommendations([])).toEqual([]);
  });
});
