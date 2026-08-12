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
 * The Activity page's logic, kept out of the SFC so it can be tested.
 *
 * Everything here exists because the sampled-session feed says two things that
 * a naive renderer gets backwards:
 *
 *   • An EMPTY wait event is not a missing value — an active backend with no
 *     wait event is running ON CPU, which was 36% of active Postgres sessions
 *     on the live rig. Rendered blank, the biggest bucket in the breakdown
 *     becomes an unexplained gap.
 *   • A DURATION means two different things by state. For a live session it is
 *     elapsed-so-far; for an idle one the same figure is the last COMPLETED
 *     query's time. "Running 40s and still going" and "finished 40s ago" demand
 *     opposite actions, so they never share a column.
 *
 * The engine's own wait vocabulary is passed through verbatim rather than
 * mapped into a cross-engine taxonomy: Postgres reports sampled states while
 * MySQL reports timed durations, so a shared bucket would sum two incomparable
 * things — and the raw token is what a DBA pastes into a search.
 */

import type {
  ActivitySession,
  ActivityStateBucket,
  ActivityWaitBucket,
} from "@/services/db_monitoring";
import { type I18nText, type useI18nTyped } from "@/types/i18n";
import { IDLE_BLOCKER_SECONDS } from "@/utils/dbm/blocking";
import { countClaim, type DbmCountClaim } from "@/utils/dbm/format";

export type { ActivitySession, ActivityStateBucket, ActivityWaitBucket };

/** The translator these copy-producing helpers take, so they stay unit-testable. */
type Translate = ReturnType<typeof useI18nTyped>["t"];

/**
 * The bucket key for "no wait event at all".
 *
 * Underscore-wrapped so it cannot collide with an engine's own vocabulary,
 * which is bare identifiers (`ClientRead`, `tuple`, `wait/io/table/sql/handler`).
 */
export const ACTIVITY_ON_CPU = "__on_cpu__";

const clean = (value: string | null | undefined): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
};

/**
 * States in which the engine considers a session to be executing.
 *
 * Mirrors `ActivitySample::duration_is_live` in server_vantage.rs and must stay
 * in step with it: MySQL has no `active` state at all, and its `waiting` is a
 * LIVE state — a session blocked on a lock or on IO is still running, so its
 * duration is still ticking.
 */
const LIVE_STATES = new Set(["active", "running", "waiting"]);

/** States in which the engine has finished, so its figure is a completed one. */
const COMPLETED_STATES = new Set(["idle", "other"]);

/** `idle in transaction`, `idle in transaction (aborted)`. */
const IDLE_PREFIX = "idle";

/**
 * A Postgres timestamp, whatever spelling it arrived in, as epoch millis.
 *
 * The feed carries TWO formats on the same record: `query_start` is
 * Postgres-native (`2026-08-11 02:33:43.484605+00` — space separator, and a
 * two-digit offset that is not valid ISO-8601) while `xact_start` and
 * `wait_start` are ISO-8601 (`2026-08-11T02:33:43Z`). Handing the first
 * straight to `new Date` relies on a V8 tolerance the format does not
 * guarantee, so the offset is expanded to `+00:00` and the separator
 * normalised before parsing.
 *
 * Returns `null`, never `NaN`: a cell can render `null` as an em dash, whereas
 * a NaN reaches the page as `Invalid Date`.
 */
export const normaliseDbTimestamp = (value: string | null | undefined): number | null => {
  const text = clean(value);
  if (!text) return null;

  // `2026-08-11 02:33:43+00` -> `2026-08-11T02:33:43+00:00`. A bare `Z`, an
  // already-complete `+05:30`, and a zoneless local reading all pass through
  // untouched — a zoneless value must stay local rather than acquire a UTC
  // offset it never carried.
  const iso = text.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Is this session burning CPU rather than waiting on anything?
 *
 * Gated on the STATE, not on the empty wait event alone: an idle backend also
 * reports no wait event (2 of the sampled sessions did) and is emphatically not
 * on CPU. `waiting` is excluded too — it is live, but it is live *blocked*, and
 * labelling it "on CPU / no wait" points the reader away from the contention
 * that is the actual problem.
 */
export const isOnCpu = (
  state: string | null | undefined,
  waitEvent: string | null | undefined,
): boolean => {
  if (clean(waitEvent)) return false;
  const s = clean(state)?.toLowerCase();
  return s === "active" || s === "running";
};

/** Which duration column this session's figure belongs in. */
export type ActivityDurationKind = "running" | "completed" | "unknown";

/**
 * Never guesses. An unfamiliar state returns `unknown` rather than being folded
 * into either column, because claiming a finished query is still running (or
 * the reverse) is the confusion this whole split exists to prevent.
 */
export const durationKindOf = (state: string | null | undefined): ActivityDurationKind => {
  const s = clean(state)?.toLowerCase();
  if (!s) return "unknown";
  if (LIVE_STATES.has(s)) return "running";
  if (COMPLETED_STATES.has(s) || s.startsWith(IDLE_PREFIX)) return "completed";
  return "unknown";
};

/**
 * The grouping key for one wait bucket.
 *
 * Both fields participate, so `{Lock, null}` and `{null, Lock}` stay distinct —
 * a plain concatenation would merge two unrelated wait classes into one row and
 * sum their counts. Only BOTH being empty is the on-CPU bucket.
 */
export const waitBucketKey = (
  type: string | null | undefined,
  event: string | null | undefined,
): string => {
  const t = clean(type);
  const e = clean(event);
  if (!t && !e) return ACTIVITY_ON_CPU;
  return `${t ?? ""}\u0000${e ?? ""}`;
};

export interface ActivityWaitLabelParts {
  type: string | null;
  event: string | null;
  onCpu: boolean;
}

export const waitBucketLabelParts = (
  type: string | null | undefined,
  event: string | null | undefined,
): ActivityWaitLabelParts => {
  const t = clean(type);
  const e = clean(event);
  return { type: t, event: e, onCpu: !t && !e };
};

/**
 * What the reader sees for a wait bucket. Never empty.
 *
 * The naming lives here rather than in a template `v-if` precisely because the
 * on-CPU bucket is the one most likely to be forgotten — and it is the biggest
 * one on a healthy Postgres.
 */
export const waitBucketLabel = (parts: ActivityWaitLabelParts, t: Translate): I18nText => {
  if (parts.onCpu) return t("dbm.activity.wait.onCpu");
  // The engine's own token, verbatim — that is what gets pasted into a search.
  if (parts.type && parts.event) {
    return t("dbm.activity.wait.qualified", { type: parts.type, event: parts.event });
  }
  return t("dbm.activity.wait.plain", { event: parts.event ?? parts.type ?? "" });
};

export interface ActivityWaitRow extends ActivityWaitLabelParts {
  key: string;
  sessions: number;
  /** `null` when the server sent none — never re-derived from a partial set. */
  share: number | null;
}

/**
 * The wait breakdown, in the server's own order.
 *
 * Deliberately does NOT sort and does NOT recompute `share`. The rows are a SQL
 * aggregate over the whole window; re-deriving a share from whatever subset
 * arrived would divide by the wrong denominator and produce a
 * plausible-but-wrong percentage, which is worse than showing none.
 */
export const buildWaitBreakdown = (
  buckets: ActivityWaitBucket[] | null | undefined,
): ActivityWaitRow[] =>
  (buckets ?? []).map((bucket) => {
    const raw = Number(bucket?.sessions);
    const sessions = Number.isFinite(raw) ? raw : 0;
    const share =
      typeof bucket?.share === "number" && Number.isFinite(bucket.share) ? bucket.share : null;
    return {
      ...waitBucketLabelParts(bucket?.wait_event_type, bucket?.wait_event),
      key: waitBucketKey(bucket?.wait_event_type, bucket?.wait_event),
      sessions,
      // A zero share against a non-zero count is arithmetically impossible, so
      // it is the server's divide-by-zero fallback rather than a measurement.
      // Showing "0%" beside "4,710" states a wrong number confidently.
      share: share === 0 && sessions > 0 ? null : share,
    };
  });

/**
 * On-CPU and waiting session counts at the POPULATION grain.
 *
 * Taken from the SQL breakdown rather than counted off `hits`, so these tiles
 * sit beside the population total at the same grain. Counting the row-limited
 * sample instead would put an undercount next to a total and invite the reader
 * to compare the two.
 */
export const waitTotals = (
  buckets: ActivityWaitBucket[] | null | undefined,
): { onCpu: number; waiting: number } =>
  (buckets ?? []).reduce(
    (totals, bucket) => {
      const sessions = Number(bucket?.sessions);
      const count = Number.isFinite(sessions) ? sessions : 0;
      const onCpu = waitBucketKey(bucket?.wait_event_type, bucket?.wait_event) === ACTIVITY_ON_CPU;
      return {
        onCpu: totals.onCpu + (onCpu ? count : 0),
        waiting: totals.waiting + (onCpu ? 0 : count),
      };
    },
    { onCpu: 0, waiting: 0 },
  );

export interface ActivityStateRow {
  key: string;
  state: string | null;
  sessions: number;
  share: number;
  tone: "warning" | "neutral";
  unknown: boolean;
}

/**
 * `idle in transaction` holds a transaction open, which holds back the xmin
 * horizon and blocks autovacuum. Plain `idle` is harmless, so the two must not
 * read the same.
 */
const isIdleInTransaction = (state: string | null): boolean =>
  !!state && state.trim().toLowerCase().startsWith("idle in transaction");

/**
 * The state summary. `share` is computed over THIS breakdown's own total, which
 * is not the wait breakdown's total — the two aggregate different columns.
 */
export const buildStateSummary = (
  buckets: ActivityStateBucket[] | null | undefined,
): ActivityStateRow[] => {
  const rows = buckets ?? [];
  const total = rows.reduce((sum, bucket) => {
    const sessions = Number(bucket?.sessions);
    return sum + (Number.isFinite(sessions) ? sessions : 0);
  }, 0);

  return rows.map((bucket, index) => {
    const sessions = Number.isFinite(Number(bucket?.sessions)) ? Number(bucket.sessions) : 0;
    const state = clean(bucket?.state);
    return {
      // The index participates so two null-state rows cannot collide.
      key: `${state ?? ACTIVITY_ON_CPU}#${index}`,
      state,
      sessions,
      share: total > 0 ? sessions / total : 0,
      tone: isIdleInTransaction(state) ? "warning" : "neutral",
      unknown: state === null,
    };
  });
};

/**
 * How long this session's transaction has been open, in seconds.
 *
 * A DIFFERENT clock from query age, and the one that separates a 5ms
 * idle-in-transaction from a 20-minute incident. Clamped at zero so a
 * clock-skewed future start never renders as a negative age.
 */
export const transactionAgeSeconds = (
  session: Pick<Partial<ActivitySession>, "xact_start" | "query_start">,
  now: number = Date.now(),
): number | null => {
  const started = normaliseDbTimestamp(session?.xact_start);
  if (started === null) return null;
  return Math.max(0, (now - started) / 1000);
};

/**
 * Above this, an open transaction is worth pointing at.
 *
 * `idle in transaction` for 5ms is ordinary; for twenty minutes it is holding
 * back the xmin horizon and blocking autovacuum. Marking every open transaction
 * would put a warning on essentially every active row and train the reader to
 * ignore the one that matters. Same floor the blocking page uses for an idle
 * lock holder, so the two pages agree on what "long enough to care" means.
 */
export { IDLE_BLOCKER_SECONDS };

export const isNotableTransactionAge = (ageSeconds: number | null | undefined): boolean =>
  ageSeconds != null && Number.isFinite(ageSeconds) && ageSeconds >= IDLE_BLOCKER_SECONDS;

/**
 * Normalise the wire rows. `blocking_pids` is the SOLE blocked-ness predicate,
 * so `blocked` is always re-derived from it rather than trusted.
 */
export const parseActivitySessions = (
  hits: ActivitySession[] | null | undefined,
): ActivitySession[] =>
  (hits ?? []).map((hit) => {
    const pids = Array.isArray(hit?.blocking_pids) ? hit.blocking_pids : [];
    return { ...hit, blocking_pids: pids, blocked: pids.length > 0 };
  });

export interface ActivityRow extends ActivitySession {
  rowKey: string;
  onCpu: boolean;
  durationKind: ActivityDurationKind;
  /** Elapsed so far — a LIVE session only. */
  runningMs: number | null;
  /** The last completed query's time — an IDLE session only. */
  lastQueryMs: number | null;
  queryStartMs: number | null;
  xactStartMs: number | null;
}

/** A finite number, or null. Keeps a real `0` (a sub-millisecond query). */
const finite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The table's rows.
 *
 * Takes the raw `hits` and normalises them itself, so a caller that hands the
 * response straight over still gets derived blocked-ness.
 *
 * The two duration figures come from DIFFERENT wire fields, because the server
 * publishes them that way: `duration_ms` is written only for a live session,
 * while `exec_time_ms` is always written and — for an idle session — IS the
 * last completed query's time. Reading `duration_ms` for the completed column
 * would leave it permanently blank.
 */
export const buildActivityRows = (sessions: ActivitySession[]): ActivityRow[] =>
  parseActivitySessions(sessions).map((session, index) => {
    const durationKind = durationKindOf(session.state);
    const live = finite(session.duration_ms);
    const completed = finite(session.exec_time_ms);
    return {
      ...session,
      // The index participates: `hits` is a flat list with no uniqueness
      // guarantee, and one pid appears in every poll in the window.
      rowKey: `${session.session_pid ?? "?"}#${session.timestamp ?? 0}#${index}`,
      onCpu: isOnCpu(session.state, session.wait_event),
      durationKind,
      runningMs: durationKind === "running" ? live : null,
      lastQueryMs: durationKind === "completed" ? completed : null,
      queryStartMs: normaliseDbTimestamp(session.query_start),
      xactStartMs: normaliseDbTimestamp(session.xact_start),
    };
  });

/**
 * A duration that arrived in MILLISECONDS.
 *
 * The unit is in the name because the wire is ambiguous by inheritance: the
 * same receiver attribute is milliseconds on `query_sample` and seconds on
 * `top_query`. A formatter that guesses is silently off by 1000.
 *
 * `0` is a measurement ("under a millisecond"), not a missing value, so only
 * a genuinely absent figure becomes an em dash.
 */
export const formatDurationMs = (ms: number | null | undefined): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  return minutes < 60 ? `${minutes.toFixed(1)}m` : `${(minutes / 60).toFixed(1)}h`;
};

export interface ActivitySampleDisclosure {
  /** `null` when the server could not infer one — never a made-up default. */
  intervalSeconds: number | null;
  intervalKnown: boolean;
  /** Always true: the receiver filters every sample. */
  filtered: boolean;
}

/**
 * What the page is allowed to claim about its own fidelity.
 *
 * There is deliberately no fallback interval. Our shipped default is 10s, not
 * Datadog's 1 Hz, and substituting a number we did not measure would imply a
 * fidelity we do not ship.
 */
export const sampleDisclosure = (
  intervalSeconds: number | null | undefined,
): ActivitySampleDisclosure => {
  const known =
    typeof intervalSeconds === "number" && Number.isFinite(intervalSeconds) && intervalSeconds > 0;
  return {
    intervalSeconds: known ? intervalSeconds : null,
    intervalKnown: known,
    filtered: true,
  };
};

/**
 * The disclosure as sentences.
 *
 * Two claims, always both: this view is SAMPLED rather than continuous, and the
 * sample was already FILTERED by the receiver (idle sessions older than the
 * newest query are dropped unless they block someone), so it is not a faithful
 * `pg_stat_activity` snapshot.
 */
export const activityDisclosureLines = (
  disclosure: ActivitySampleDisclosure,
  t: Translate,
): I18nText[] => [
  disclosure.intervalKnown
    ? t("dbm.activity.disclosure.sampled", { interval: disclosure.intervalSeconds ?? 0 })
    : t("dbm.activity.disclosure.sampledUnknown"),
  t("dbm.activity.disclosure.filtered"),
  // No grain caveat here any more: the breakdowns used to be COUNT(*) over
  // rows, and since every poll writes one row per session those totals were
  // session-SAMPLES, which had to be disclosed. They are now
  // COUNT(DISTINCT session pid), so the tiles really do count sessions and the
  // old warning would itself be the misleading statement.
];

/**
 * What the row count is allowed to claim. A count off a capped read is a FLOOR,
 * not a total — the sample is not the population.
 */
export const activityCountClaim = (count: number, truncated?: boolean): DbmCountClaim =>
  countClaim(count, truncated);

/**
 * Total SESSION SAMPLES in the aggregate — NOT a distinct-session count.
 *
 * The backend computes the breakdowns as `COUNT(*) … GROUP BY` over rows, and
 * activity ingest writes one row per session per poll. A 200-session instance
 * polled every 10s for an hour therefore aggregates to ~72,000, not 200.
 *
 * Naming and copy both say "samples" for that reason: calling this a session
 * count would render a ~360x overstatement as the page's authoritative figure.
 * A true distinct-session count needs `COUNT(DISTINCT session_pid)` server-side.
 */
export const activitySampleTotal = (
  buckets: ActivityStateBucket[] | null | undefined,
): number | null => {
  if (!buckets?.length) return null;
  return buckets.reduce((sum, bucket) => {
    const sessions = Number(bucket?.sessions);
    return sum + (Number.isFinite(sessions) ? sessions : 0);
  }, 0);
};

/** What the strip could not fit, stated rather than silently dropped. */
export interface ActivityWaitRemainder {
  /** How many buckets are hidden. */
  buckets: number;
  sessions: number;
  /** `null` when any hidden bucket lacked a server share — never re-derived. */
  share: number | null;
}

/**
 * The strip's visible buckets plus an explicit remainder.
 *
 * `share` is computed SERVER-side over every bucket, so rendering only the top
 * few leaves the visible percentages summing to well under 100% with nothing
 * explaining the gap. The tail is collapsed into one accounted-for remainder
 * instead of vanishing.
 */
// Generic over the row so a caller that has already attached its rendered
// label gets it back. Typed to the bare `ActivityWaitRow` the slice silently
// erased that label, and the template's `bucket.label` failed to typecheck.
export const topWaitRows = <T extends ActivityWaitRow>(
  rows: T[],
  limit: number,
): { shown: T[]; remainder: ActivityWaitRemainder | null } => {
  const shown = rows.slice(0, limit);
  const hidden = rows.slice(limit);
  if (!hidden.length) return { shown, remainder: null };

  // One missing share makes the whole remainder share unknowable — reporting a
  // partial sum as the remainder would understate it.
  const shareKnown = hidden.every((row) => row.share !== null);
  return {
    shown,
    remainder: {
      buckets: hidden.length,
      sessions: hidden.reduce((sum, row) => sum + row.sessions, 0),
      share: shareKnown ? hidden.reduce((sum, row) => sum + (row.share ?? 0), 0) : null,
    },
  };
};

/**
 * Whether any row carries lock information at all.
 *
 * MySQL's `query_sample` has no blocking or lock attributes whatsoever, so on a
 * MySQL-only result those columns are null on every row. The section is hidden
 * rather than rendered empty.
 */
export const hasLockData = (sessions: ActivitySession[]): boolean =>
  (sessions ?? []).some(
    (session) =>
      !!clean(session?.lock_mode) ||
      !!clean(session?.lock_type) ||
      !!clean(session?.lock_relation) ||
      (session?.blocking_pids?.length ?? 0) > 0,
  );

export type ActivityEmptyCause = "healthy" | "not-collecting";

/**
 * Why the table is empty — and these two mean OPPOSITE things.
 *
 * "No active sessions" is genuinely good news, but only if something actually
 * looked. The proof that it did is a populated breakdown: the aggregates are
 * computed by SQL over the whole window, so a non-empty `by_state` means
 * sessions were sampled even when the row list came back empty.
 *
 * That evidence is required because `not_collecting` alone cannot answer this.
 * The liveness probe counts records of ANY kind in the shared `dbm_server`
 * stream, so on the shipped default (`ZO_DB_MONITORING_ACTIVITY_ENABLED` off)
 * a cluster running the deadlock recipes reports `not_collecting: false` while
 * nothing has ever sampled a session — and reading only that flag would render
 * "no active sessions, all good" over a database nobody is watching.
 */
export const activityEmptyCause = (input: {
  notCollecting?: boolean | null;
  logLinesSeen?: number | null;
  hasBreakdown?: boolean;
}): ActivityEmptyCause => {
  // The server's explicit verdict wins outright.
  if (input?.notCollecting) return "not-collecting";
  return input?.hasBreakdown ? "healthy" : "not-collecting";
};

/** The route query for the Query Detail hop, or null when the row cannot make it. */
export interface ActivityQueryDetailTarget {
  fingerprint: string;
  system: string;
  instance?: string;
  namespace?: string;
}

/**
 * Where an Activity row goes when it is clicked (W4/B13).
 *
 * The page had no row navigation at all, so an operator watching one session
 * saturate an instance had no way through to what that statement costs over
 * the window — the move was to retype the fingerprint into the Queries search.
 * The `fingerprint` is precisely what joins a live session to a Top-queries
 * row, so it is the whole of the hop.
 *
 * Two refusals, both deliberate:
 *
 *  • A session with NO fingerprint does not navigate. An idle backend running
 *    no statement is the ordinary case — the wire marks the field optional —
 *    and a detail page keyed on nothing is the broken link that the fleet
 *    page's trafficless early-return exists to prevent. Returning null lets
 *    the caller decline rather than push a dead route.
 *
 *  • No `stream`. A server-vantage sample knows its database, not which trace
 *    stream the client spans landed in, and `/query/endpoints` requires stream
 *    AND fingerprint together — so a guessed one 400s where an omitted one
 *    degrades into the detail page's own resolution chain. Same reasoning, and
 *    the same omission, as the deadlocks page's hop to this route.
 */
export const activityQueryDetailTarget = (
  session: Pick<Partial<ActivitySession>, "fingerprint" | "db_system" | "db_instance"> & {
    db_namespace?: string | null;
  },
): ActivityQueryDetailTarget | null => {
  const fingerprint = clean(session?.fingerprint);
  if (!fingerprint) return null;
  const instance = clean(session?.db_instance);
  const namespace = clean(session?.db_namespace);
  return {
    fingerprint,
    system: session?.db_system ?? "",
    ...(instance ? { instance } : {}),
    ...(namespace ? { namespace } : {}),
  };
};
