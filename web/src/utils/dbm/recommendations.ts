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
 * W11 · Deterministic database recommendations.
 *
 * The same discipline as `insights.ts`, applied to a different question.
 * `insights.ts` asks "what CHANGED between two windows?"; this asks "what is
 * true right now that crosses a stated threshold?". Both are plain predicates
 * over fields we already hold — there is no model here, and deliberately so:
 *
 *   • **Not AI.** `DbmSuggestFixButton.vue` gates its AI action on
 *     `config.isEnterprise && zoConfig.ai_enabled`. Framing these as
 *     AI-driven would inherit that ENTERPRISE gate, and DBM is all-OSS. A
 *     threshold on a counter needs no model and must not be sold as one.
 *
 *   • **No cause, no promised outcome.** This is the line the whole module is
 *     built around. A rule may state WHAT WAS MEASURED and WHICH THRESHOLD it
 *     crossed. It may not say why, and it may not predict what happens if you
 *     act. "This index has not been scanned since the counters were last
 *     reset" is a fact about `pg_stat_user_indexes`. "Dropping this index will
 *     speed up writes" is a claim about a future we cannot see — the index may
 *     serve a nightly report, a replica, or a constraint.
 *
 *   • **Every rule states its arithmetic**, from the same constant the
 *     predicate evaluates, so the number on screen cannot drift from the
 *     number that fired.
 *
 * ## What the counters actually are
 *
 * `idx_scan` is CUMULATIVE since the last `pg_stat_reset()` — a point in time
 * the feed never observes. So the honest phrasing is "not scanned since the
 * counters were last reset", never "not scanned in the last hour". The page's
 * time range does not bound this number, and a rule that implied it did would
 * be making a strictly stronger claim than the data supports. That single fact
 * is why `recommendationRuleParams` carries a `cumulative` flag rather than a
 * range.
 *
 * ## Per-engine honesty
 *
 * The index feed is Postgres-only. On MySQL an empty list would read as "no
 * unused indexes" — an all-clear about a check that never ran — so
 * `recommendationEngineSupport` reports coverage per rule and
 * `recommendationsEmptyCause` keeps "nothing found" apart from "not collected
 * for your engine".
 */

import type { ActivitySession, BlockingSample } from "@/services/db_monitoring";
import { chainsFromSamples } from "./blocking";

/** Which recommendation fired. */
export type DbmRecommendationId =
  "unused-index" | "long-running-query" | "high-impact-blocker" | "high-row-count";

/**
 * Every rule, in one list so the contract tests can iterate it.
 *
 * `regression` is deliberately NOT here. It already exists as an insight rule
 * in `insights.ts` and is surfaced by the insight strip; re-deriving it would
 * put two predicates for one finding in two files, free to disagree.
 */
export const RECOMMENDATION_IDS = [
  "unused-index",
  "long-running-query",
  "high-impact-blocker",
  "high-row-count",
] as const satisfies readonly DbmRecommendationId[];

export type DbmRecommendationTone = "error" | "warning" | "info";

/**
 * Thresholds. Exported because the UI prints them: a card states the rule that
 * fired it, so these numbers and the predicate's numbers are the same numbers.
 */
export const DBM_RECOMMENDATION_RULES = {
  unusedIndex: {
    /**
     * Below this an unused index costs less than the effort of reviewing it.
     * 1 MiB: the rig's `accounts_pkey` is 16 KB, which is noise, while
     * `idx_orders_note_unused` is 2.8 MB of storage plus a write-time cost on
     * every INSERT.
     */
    minBytes: 1_048_576,
  },
  longRunning: {
    /** 60s. Past a minute an interactive statement is an outlier worth naming. */
    minRunningMs: 60_000,
  },
  highImpactBlocker: {
    /**
     * At least two sessions stuck behind one root. A single blocked session is
     * an ordinary lock wait — every write workload has them — while a root
     * holding up several is a pile-up one action clears.
     */
    minBlocked: 2,
  },
  highRowCount: {
    /** Mean rows per call at or above this is worth pointing at. */
    minRowsPerCall: 10_000,
    /** Below this call count a mean is too jumpy to quote. */
    minCalls: 20,
  },
} as const;

// ─── R1 · Unused index ───────────────────────────────────────────────────────

/** One index's size and usage, as `GET .../index_health` returns it. */
export interface IndexHealthRow {
  index_name: string | null;
  /** The table the index belongs to. */
  relation: string | null;
  schema: string | null;
  instance: string | null;
  engine: string | null;
  /** `pg_relation_size` of the index. EXACT, not an estimate. */
  index_bytes: number | null;
  /** LIFETIME total since the last stats reset. Zero is the finding. */
  idx_scan_count: number | null;
  idx_tup_read: number | null;
  idx_tup_fetch: number | null;
  last_seen: number | null;
  /**
   * Whether the index enforces a UNIQUE or PRIMARY KEY constraint.
   *
   * Optional because the shipped recipe does not report it yet. When it is
   * absent the rule cannot exclude constraint indexes, so the copy carries the
   * caveat rather than this module inventing a value.
   */
  is_unique?: boolean | null;
}

/** `GET /{org}/traces/db_monitoring/index_health`. */
export interface IndexHealthResponse {
  hits: IndexHealthRow[];
  stream: string;
  total: number;
  /**
   * The API's own statement that the scan counters are lifetime totals. Gated
   * on rather than assumed: a build whose response omits it has not made the
   * claim, and asserting it anyway would invent a disclosure.
   */
  counters_are_cumulative: boolean;
  /** Whether this signal is collected for the engine the caller filtered to. */
  engine_coverage: "supported" | "unsupported" | "unknown";
}

export interface UnusedIndexFinding {
  indexName: string;
  relation: string;
  schema: string;
  indexBytes: number;
  instance: string | null;
}

/**
 * Indexes the planner has not chosen since the counters were last reset.
 *
 * Three guards, each closing a different way this could mislead:
 *
 *  • **A missing counter is not a zero.** `null` means the column was never
 *    projected; reporting that as "never scanned" states a finding about a
 *    measurement that does not exist.
 *  • **A size floor**, so the list is worth reading. An unused 16 KB
 *    primary-key index is not a storage problem.
 *  • **Unique indexes are excluded.** `idx_scan = 0` on a UNIQUE index means
 *    the planner has not used it for a LOOKUP; the constraint it enforces is
 *    still doing work on every insert. Listing it beside an ordinary index
 *    invites dropping a constraint, which changes what the schema permits.
 */
export const detectUnusedIndexes = (rows: IndexHealthRow[]): UnusedIndexFinding[] => {
  const { minBytes } = DBM_RECOMMENDATION_RULES.unusedIndex;

  return rows
    .flatMap((row) => {
      const scans = row.idx_scan_count;
      // Absent is UNKNOWN, never zero.
      if (scans == null || scans !== 0) return [];
      // A constraint index is not a candidate; see the doc comment.
      if (row.is_unique === true) return [];
      const bytes = row.index_bytes ?? 0;
      if (bytes < minBytes) return [];
      if (!row.index_name) return [];
      return [
        {
          indexName: row.index_name,
          relation: row.relation ?? "",
          schema: row.schema ?? "",
          indexBytes: bytes,
          instance: row.instance ?? null,
        },
      ];
    })
    .sort((a, b) => b.indexBytes - a.indexBytes);
};

// ─── R2 · Long-running query ─────────────────────────────────────────────────

export interface LongRunningFinding {
  pid: number | null;
  runningMs: number;
  query: string | null;
  fingerprint: string | null;
  instance: string | null;
}

/**
 * Sessions that have been executing longer than the threshold.
 *
 * Scoped to sessions that are ACTUALLY EXECUTING. An idle session's
 * `exec_time_ms` is the age of the statement it last ran, so counting it would
 * report a finished query as "running for 20 minutes" — the state field is the
 * whole difference between a stuck query and a connection sitting in a pool.
 */
export const detectLongRunningQueries = (sessions: ActivitySession[]): LongRunningFinding[] => {
  const { minRunningMs } = DBM_RECOMMENDATION_RULES.longRunning;

  return sessions
    .flatMap((s) => {
      // Only a running statement has a running time. `active` is Postgres's
      // spelling; MySQL reports no `active` state, and a session there is
      // included when it carries a duration and is not explicitly idle.
      const state = (s.state ?? "").toLowerCase();
      if (state.startsWith("idle")) return [];
      const ms = s.exec_time_ms;
      if (ms == null || !Number.isFinite(ms)) return [];
      if (ms < minRunningMs) return [];
      return [
        {
          pid: s.session_pid ?? null,
          runningMs: ms,
          query: s.query ?? null,
          fingerprint: s.fingerprint ?? null,
          instance: s.db_instance ?? null,
        },
      ];
    })
    .sort((a, b) => b.runningMs - a.runningMs);
};

// ─── R3 · High-impact blocker ────────────────────────────────────────────────

export interface HighImpactBlockerFinding {
  rootPid: number | null;
  blockedCount: number;
  query: string | null;
  instance: string | null;
  maxWaitSeconds: number | null;
}

/**
 * Root blockers holding up several sessions at once.
 *
 * Chain assembly is `chainsFromSamples`, which already resolves transitive
 * `A→B→C` edges to one root and is the same function the Blocked-queries page
 * renders from — so this rule and that page can never disagree about who the
 * root is.
 *
 * The rule names the root because that is the actionable session: it is the one
 * waiting for nothing, so it is the one whose completion releases the subtree.
 * That is a statement about the lock graph's shape, not a claim about why the
 * root is slow.
 */
export const detectHighImpactBlockers = (samples: BlockingSample[]): HighImpactBlockerFinding[] => {
  const { minBlocked } = DBM_RECOMMENDATION_RULES.highImpactBlocker;

  return chainsFromSamples(samples)
    .flatMap((chain) => {
      if (chain.blocked_count < minBlocked) return [];
      return [
        {
          rootPid: chain.root_pid,
          blockedCount: chain.blocked_count,
          query: chain.root_query ?? null,
          // `chainsFromSamples` files the instance under `database` — the
          // samples carry `db_instance` and it is stored there.
          instance: chain.database ?? null,
          maxWaitSeconds: chain.max_wait_seconds ?? null,
        },
      ];
    })
    .sort((a, b) => b.blockedCount - a.blockedCount);
};

// ─── R5 · High row count ─────────────────────────────────────────────────────

export interface HighRowCountInput {
  fingerprint: string;
  /** Server-side call count (`pg_stat_statements.calls`). */
  calls: number | null;
  /** Server-side rows returned, summed across those calls. */
  rows: number | null;
  queryText: string;
}

export interface HighRowCountFinding {
  fingerprint: string;
  rowsPerCall: number;
  calls: number;
  rows: number;
  queryText: string;
}

/**
 * A statement whose MEAN rows per call crosses the threshold.
 *
 * A mean, and labelled as one: `pg_stat_statements` accumulates a total and a
 * count, so a quotient is the only central tendency this feed supports. One
 * call returning a million rows and a million calls returning one each produce
 * the same total and are different problems — the call floor is what stops the
 * second masquerading as the first.
 *
 * It reports the ratio; it does not claim the rows are unnecessary. A bulk
 * export legitimately returns a lot of rows.
 */
export const detectHighRowCount = (input: HighRowCountInput): HighRowCountFinding | null => {
  const { minRowsPerCall, minCalls } = DBM_RECOMMENDATION_RULES.highRowCount;
  const calls = input.calls;
  const rows = input.rows;
  if (calls == null || rows == null) return null;
  // The call floor also rules out zero and negatives, so the division below
  // cannot be by zero. An explicit `calls <= 0` clause here would be
  // unreachable — `minCalls` is 20 — and unreachable guards read as though
  // some caller reaches them.
  if (calls < minCalls) return null;

  const rowsPerCall = rows / calls;
  if (rowsPerCall < minRowsPerCall) return null;

  return { fingerprint: input.fingerprint, rowsPerCall, calls, rows, queryText: input.queryText };
};

// ─── Assembly ────────────────────────────────────────────────────────────────

export interface DbmRecommendation {
  id: DbmRecommendationId;
  tone: DbmRecommendationTone;
  /** What the finding is ABOUT — a qualified index, a pid, a fingerprint. */
  subject: string;
  evidence: DbmRecommendationEvidence;
}

export interface DbmRecommendationEvidence {
  indexBytes?: number;
  runningMs?: number;
  blockedCount?: number;
  rowsPerCall?: number;
  calls?: number;
  pid?: number | null;
  fingerprint?: string | null;
  instance?: string | null;
  /** How many rows in total tripped the same rule. */
  count?: number;
}

export interface DbmRecommendationInput {
  indexes: IndexHealthRow[];
  sessions: ActivitySession[];
  blocking: BlockingSample[];
  serverMetrics: HighRowCountInput | null;
}

/**
 * Severity order. It is a consequence of what the finding COSTS RIGHT NOW, not
 * a knob: a blocker is holding other sessions this second, a long-running query
 * is consuming a connection, and an unused index is a standing storage cost
 * nobody is waiting on.
 */
const TONE_OF: Record<DbmRecommendationId, DbmRecommendationTone> = {
  "high-impact-blocker": "error",
  "long-running-query": "warning",
  "high-row-count": "warning",
  "unused-index": "info",
};

const SEVERITY: Record<DbmRecommendationTone, number> = { error: 0, warning: 1, info: 2 };

/** Run every rule and rank what fired, most urgent first. */
export const buildRecommendations = (input: DbmRecommendationInput): DbmRecommendation[] => {
  const out: DbmRecommendation[] = [];

  const blockers = detectHighImpactBlockers(input.blocking);
  for (const b of blockers) {
    out.push({
      id: "high-impact-blocker",
      tone: TONE_OF["high-impact-blocker"],
      subject: b.rootPid == null ? "" : String(b.rootPid),
      evidence: {
        blockedCount: b.blockedCount,
        pid: b.rootPid,
        instance: b.instance,
        count: blockers.length,
      },
    });
  }

  const longRunning = detectLongRunningQueries(input.sessions);
  for (const l of longRunning) {
    out.push({
      id: "long-running-query",
      tone: TONE_OF["long-running-query"],
      subject: l.pid == null ? "" : String(l.pid),
      evidence: {
        runningMs: l.runningMs,
        pid: l.pid,
        fingerprint: l.fingerprint,
        instance: l.instance,
        count: longRunning.length,
      },
    });
  }

  if (input.serverMetrics) {
    const rowy = detectHighRowCount(input.serverMetrics);
    if (rowy) {
      out.push({
        id: "high-row-count",
        tone: TONE_OF["high-row-count"],
        subject: rowy.fingerprint,
        evidence: {
          rowsPerCall: rowy.rowsPerCall,
          calls: rowy.calls,
          fingerprint: rowy.fingerprint,
          count: 1,
        },
      });
    }
  }

  const unused = detectUnusedIndexes(input.indexes);
  for (const u of unused) {
    out.push({
      id: "unused-index",
      tone: TONE_OF["unused-index"],
      // Schema-qualified AND table-qualified: an index name alone is ambiguous
      // across schemas, and the table is what the reader needs to judge it.
      subject: [u.schema, u.relation, u.indexName].filter(Boolean).join("."),
      evidence: { indexBytes: u.indexBytes, instance: u.instance, count: unused.length },
    });
  }

  return out.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
};

// ─── Per-engine coverage ─────────────────────────────────────────────────────

export type DbmRecommendationCoverage = "supported" | "unsupported";

/**
 * Whether a rule's input is collected for this engine.
 *
 * The index feed reads `pg_stat_user_indexes` and is Postgres-only; activity
 * and blocking have recipes on every supported engine. Reporting this per RULE
 * rather than per page is what lets a MySQL user see their blocking findings
 * while being told, specifically, that the index check did not run.
 */
export const recommendationEngineSupport = (
  id: DbmRecommendationId,
  engine: string,
): DbmRecommendationCoverage => {
  if (id === "unused-index") {
    return engine === "postgresql" ? "supported" : "unsupported";
  }
  return "supported";
};

/**
 * Why the list is empty — the two states a reader must never confuse.
 *
 * `engine-partial` says some checks could not run on this engine, so an empty
 * list is not an all-clear. `all-clear` is the honest reading only when every
 * rule's input was actually collected.
 */
export type DbmRecommendationsEmptyCause = "engine-partial" | "all-clear";

export const recommendationsEmptyCause = (
  recommendations: DbmRecommendation[],
  engine: string,
): DbmRecommendationsEmptyCause | null => {
  if (recommendations.length > 0) return null;
  const anyUnsupported = RECOMMENDATION_IDS.some(
    (id) => recommendationEngineSupport(id, engine) === "unsupported",
  );
  return anyUnsupported ? "engine-partial" : "all-clear";
};

// ─── The rule, in words ──────────────────────────────────────────────────────

/**
 * The predicate that fired, built from the SAME constants the predicate
 * evaluates — so the threshold on screen cannot drift from the one that fired.
 *
 * No rule here takes a `baseline`. Every one is a single-observation test, and
 * naming a baseline would assert a window-over-window comparison that never
 * happened — the same exclusion `BASELINE_COMPARED_RULES` pins in `insights.ts`.
 */
export const recommendationRuleParams = (
  id: DbmRecommendationId,
): { key: string; params: Record<string, number | string | boolean> } => {
  const r = DBM_RECOMMENDATION_RULES;
  switch (id) {
    case "unused-index":
      return {
        key: "dbm.recommendations.unused-index.rule",
        params: {
          bytes: r.unusedIndex.minBytes,
          // The counter is a LIFETIME total. This flag is what makes the copy
          // say "since the counters were last reset" instead of naming the
          // page's time range, which the counter does not respect.
          cumulative: true,
        },
      };
    case "long-running-query":
      return {
        key: "dbm.recommendations.long-running-query.rule",
        params: { seconds: r.longRunning.minRunningMs / 1000 },
      };
    case "high-impact-blocker":
      return {
        key: "dbm.recommendations.high-impact-blocker.rule",
        params: { sessions: r.highImpactBlocker.minBlocked },
      };
    case "high-row-count":
      return {
        key: "dbm.recommendations.high-row-count.rule",
        params: { rows: r.highRowCount.minRowsPerCall, calls: r.highRowCount.minCalls },
      };
  }
};
