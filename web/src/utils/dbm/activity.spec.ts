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
import type {
  ActivitySession,
  ActivityStateBucket,
  ActivityWaitBucket,
} from "@/utils/dbm/activity";
import {
  ACTIVITY_ON_CPU,
  activityCountClaim,
  activityDisclosureLines,
  activityEmptyCause,
  activitySampleTotal,
  buildActivityRows,
  buildStateSummary,
  buildWaitBreakdown,
  durationKindOf,
  formatDurationMs,
  hasLockData,
  IDLE_BLOCKER_SECONDS,
  isNotableTransactionAge,
  isOnCpu,
  normaliseDbTimestamp,
  parseActivitySessions,
  sampleDisclosure,
  topWaitRows,
  transactionAgeSeconds,
  waitBucketKey,
  waitBucketLabel,
  waitBucketLabelParts,
  waitTotals,
} from "@/utils/dbm/activity";

/**
 * The REAL translator, not a fake that echoes keys back.
 *
 * These helpers exist to produce the copy a reader sees, so the assertions are
 * about English words ("on CPU", "sampled", "idle") — and a key-echoing stub
 * would satisfy those only by accident of how the key happens to be spelled.
 * Running the actual messages also fails the suite when a key is missing from
 * en-US.json, which is the other half of the contract.
 */
const translate = i18n.global.t as unknown as Parameters<typeof waitBucketLabel>[1];

/**
 * Fixtures are taken VERBATIM from the checked-in live captures under
 * `tests/dbm-server-vantage/captures/`, then passed through the shape
 * `activity_row_to_dto` emits (api.rs) — storage names never reach the browser,
 * and `str_or_null` turns the receiver's empty-string sentinels into `null`.
 *
 * The two timestamp formats below are the measured ones and they DIFFER:
 * `query_start` is Postgres-native (`2026-08-11 02:33:43.484605+00`, space
 * separator and a two-digit offset) while `xact_start`/`wait_start` are
 * ISO-8601 (`2026-08-11T02:33:43Z`). Both appear on the same record.
 */
const session = (over: Partial<ActivitySession> = {}): ActivitySession => ({
  timestamp: 1_754_880_823_000_000,
  session_pid: 81491,
  session_user: "postgres",
  session_app: "psql",
  state: "active",
  query: "SELECT * FROM orders WHERE id = $1",
  fingerprint: "311bbdbdf142596f",
  server_query_id: "-4306321503232432640",
  wait_event: "transactionid",
  wait_event_type: "Lock",
  query_start: "2026-08-11 02:33:43.484605+00",
  xact_start: "2026-08-11T02:33:43Z",
  wait_start: "2026-08-11T02:33:43Z",
  exec_time_ms: 1000.462,
  duration_ms: 11_000,
  blocking_pids: [],
  blocked: false,
  lock_mode: null,
  lock_type: null,
  lock_relation: null,
  client_address: "10.0.0.4",
  client_host: null,
  client_port: 54_112,
  db_system: "postgresql",
  db_instance: "orders-db.prod.internal",
  db_namespace: "orders",
  ...over,
});

describe("normaliseDbTimestamp", () => {
  /**
   * The decisive one. `query_start` and `xact_start` arrive in DIFFERENT
   * formats on the same record, so a renderer that assumes one of them
   * mis-parses the other. Both must land on the same instant.
   */
  it("parses the Postgres-native and the ISO-8601 forms to the same instant", () => {
    const pgNative = normaliseDbTimestamp("2026-08-11 02:33:43.484605+00");
    const iso = normaliseDbTimestamp("2026-08-11T02:33:43Z");
    expect(pgNative).not.toBeNull();
    expect(iso).not.toBeNull();
    // The PG form carries sub-second precision the ISO form does not, so they
    // agree to the second rather than exactly.
    expect(Math.floor((pgNative as number) / 1000)).toBe(Math.floor((iso as number) / 1000));
  });

  /**
   * `+00` is NOT a valid ISO-8601 offset — the grammar requires `+00:00` (or
   * `Z`). V8 happens to accept the Postgres spelling today, but that is an
   * implementation quirk of one engine and not something the wire format
   * guarantees, so the value is normalised explicitly rather than handed to
   * `new Date` as-is.
   */
  it("expands the two-digit Postgres offset to a real ISO offset", () => {
    const withOffset = normaliseDbTimestamp("2026-08-11 02:33:43.484605+05");
    const explicit = Date.parse("2026-08-11T02:33:43.484605+05:00");
    expect(withOffset).toBe(explicit);
  });

  /**
   * The sign must be carried, not just the digits. A parser that strips `-07`
   * to `07` lands the reading 14 hours away and the row's age reads as
   * plausible-but-wrong, which is worse than a visible failure.
   */
  it("reads a negative Postgres offset with the right sign", () => {
    const east = normaliseDbTimestamp("2026-08-11 02:33:43+07");
    const west = normaliseDbTimestamp("2026-08-11 02:33:43-07");
    expect(east).toBe(Date.parse("2026-08-11T02:33:43+07:00"));
    expect(west).toBe(Date.parse("2026-08-11T02:33:43-07:00"));
    // The same wall-clock reading west of UTC is 14 hours LATER in absolute time.
    expect((west as number) - (east as number)).toBe(14 * 3600 * 1000);
  });

  it("keeps an offset that is already fully specified", () => {
    expect(normaliseDbTimestamp("2026-08-11 02:33:43.484605+05:30")).toBe(
      Date.parse("2026-08-11T02:33:43.484605+05:30"),
    );
  });

  /**
   * A bare local timestamp has no zone — Postgres emits these from a
   * `timestamp without time zone` column. It must parse as LOCAL, not silently
   * acquire a UTC offset it never carried.
   *
   * The assertion is written against `new Date(y, m, d, …)`, the local-time
   * constructor, rather than a pinned epoch. Note the suite runs under a pinned
   * `TZ=UTC` (vitest.config.ts), where a local parse and an appended `Z` happen
   * to coincide — so this comparison is what keeps the test meaningful if that
   * pin is ever lifted, and it can never be satisfied by a hardcoded epoch.
   */
  it("parses a zoneless timestamp as local rather than inventing UTC", () => {
    expect(normaliseDbTimestamp("2026-08-11 02:33:43")).toBe(
      new Date(2026, 7, 11, 2, 33, 43).getTime(),
    );
  });

  /**
   * The zone-carrying form must NOT be read as local: `+00` is UTC, and a
   * parser that drops the offset before parsing shifts every Postgres timestamp
   * by the viewer's own offset.
   */
  it("does not read an offset-carrying timestamp as local time", () => {
    expect(normaliseDbTimestamp("2026-08-11 02:33:43+00")).toBe(Date.parse("2026-08-11T02:33:43Z"));
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a non-date string", "not a timestamp"],
  ])("returns null for %s rather than NaN", (_label, input) => {
    expect(normaliseDbTimestamp(input as string | null | undefined)).toBeNull();
  });

  /**
   * The failure this guards is a rendered `NaN`/`Invalid Date`, which is what a
   * bare `new Date(x).getTime()` produces. `null` is the only value the cells
   * can turn into an em dash — a finite-but-wrong epoch would render as a real
   * date, so "not NaN" is not enough.
   */
  it("returns null for an unparseable date rather than NaN or a guess", () => {
    expect(normaliseDbTimestamp("2026-13-45 99:99:99+00")).toBeNull();
  });
});

describe("isOnCpu / ACTIVITY_ON_CPU", () => {
  /**
   * Measured on the live rig: 292 of 820 active Postgres sessions (35.6%)
   * carry an EMPTY wait event. An empty wait event on an active backend means
   * it is running on CPU — a real answer, and the single biggest bucket after
   * ClientRead. Rendering it blank throws away a third of the picture.
   */
  it("treats an active session with no wait event as on CPU", () => {
    expect(isOnCpu("active", null)).toBe(true);
    expect(isOnCpu("active", "")).toBe(true);
    expect(isOnCpu("active", "   ")).toBe(true);
  });

  it("does not call a waiting session on CPU", () => {
    expect(isOnCpu("active", "transactionid")).toBe(false);
    expect(isOnCpu("active", "ClientRead")).toBe(false);
  });

  /**
   * The nuance the capture forces: 2 of the sampled sessions were `idle` with
   * an empty wait event. An idle backend is by definition NOT on CPU, so the
   * on-CPU reading is bound to the active state and never applied blindly to
   * "wait_event is empty".
   */
  it("does not call an IDLE session with no wait event on CPU", () => {
    expect(isOnCpu("idle", null)).toBe(false);
    expect(isOnCpu("idle in transaction", "")).toBe(false);
  });

  it("does not call a session on CPU when the state itself is unknown", () => {
    expect(isOnCpu(null, null)).toBe(false);
    expect(isOnCpu("", "")).toBe(false);
  });

  /**
   * MySQL has no `active` state, so the predicate must not be PG-only. Its
   * canonical running state is `running` (from `mysql.session.status`).
   */
  it("reads the MySQL running state as on CPU too", () => {
    expect(isOnCpu("running", null)).toBe(true);
    expect(isOnCpu("running", "")).toBe(true);
  });

  /**
   * `waiting` is LIVE but it is not on CPU — the session is blocked on a lock
   * or on IO. This is the trap in sharing one "is it running" predicate between
   * `durationKindOf` (where `waiting` IS running) and this one: doing so labels
   * a lock-blocked session "on CPU / no wait", which is the opposite of true
   * and points the reader away from the contention that is the actual problem.
   */
  it("does not call a MySQL waiting session on CPU, though its duration is live", () => {
    expect(isOnCpu("waiting", null)).toBe(false);
    expect(isOnCpu("waiting", "")).toBe(false);
    // The two predicates deliberately disagree on this state.
    expect(durationKindOf("waiting")).toBe("running");
  });

  /**
   * The sentinel has to be a key no ENGINE could ever emit, or a real Postgres
   * wait event named the same thing would silently merge into the on-CPU
   * bucket. Engine vocabularies are bare identifiers (`ClientRead`, `tuple`,
   * `wait/io/table/sql/handler`), so the sentinel is bracketed.
   */
  it("uses a sentinel key no engine vocabulary can collide with", () => {
    expect(ACTIVITY_ON_CPU).toBe("__on_cpu__");
    expect(waitBucketKey("Client", "ClientRead")).not.toBe(ACTIVITY_ON_CPU);
    // The literal string, arriving as a real event name, must not be mistaken
    // for the computed empty bucket.
    expect(waitBucketKey(null, "__on_cpu__")).not.toBe(ACTIVITY_ON_CPU);
  });
});

describe("waitBucketKey / waitBucketLabelParts", () => {
  it("keys a real wait event by type and event together", () => {
    // `Lock:transactionid` and `Lock:tuple` are different problems.
    expect(waitBucketKey("Lock", "transactionid")).not.toBe(waitBucketKey("Lock", "tuple"));
    expect(waitBucketKey("Lock", "tuple")).not.toBe(waitBucketKey("LWLock", "tuple"));
  });

  it("collapses every empty spelling onto the one on-CPU bucket", () => {
    const key = waitBucketKey(null, null);
    expect(key).toBe(ACTIVITY_ON_CPU);
    expect(waitBucketKey("", "")).toBe(key);
    expect(waitBucketKey(null, "")).toBe(key);
    expect(waitBucketKey("  ", "  ")).toBe(key);
  });

  /**
   * Never a blank label. This is the rendering half of the on-CPU fact: the
   * bucket has to NAME itself, or the biggest slice of the breakdown is an
   * unexplained gap in the bar.
   */
  it("labels the empty bucket rather than leaving it blank", () => {
    const parts = waitBucketLabelParts(null, null);
    expect(parts.onCpu).toBe(true);
    expect(parts.event).toBeNull();
    expect(parts.type).toBeNull();
  });

  it("hands back the engine's own vocabulary verbatim for a real event", () => {
    // Engine-native, never translated into a cross-engine taxonomy: the token
    // is what the DBA pastes into a search.
    const parts = waitBucketLabelParts("Lock", "transactionid");
    expect(parts.onCpu).toBe(false);
    expect(parts.type).toBe("Lock");
    expect(parts.event).toBe("transactionid");
  });

  it("renders a type with no event, and an event with no type", () => {
    expect(waitBucketLabelParts("Lock", null)).toMatchObject({ type: "Lock", event: null });
    expect(waitBucketLabelParts(null, "ClientRead")).toMatchObject({
      type: null,
      event: "ClientRead",
    });
    // Only ONE of them being empty is not the on-CPU case.
    expect(waitBucketLabelParts("Lock", null).onCpu).toBe(false);
    expect(waitBucketLabelParts(null, "ClientRead").onCpu).toBe(false);
  });

  it("trims incidental whitespace out of the label", () => {
    expect(waitBucketLabelParts(" Lock ", " tuple ")).toMatchObject({
      type: "Lock",
      event: "tuple",
    });
  });
});

describe("waitBucketLabel", () => {
  /**
   * `waitBucketLabelParts` returns two nulls for the on-CPU bucket, which NAMES
   * nothing. Deferring the naming to a `v-if` in the template is how the
   * largest slice of the breakdown ends up rendering blank — the exact failure
   * the on-CPU fact exists to prevent. So the label is produced here, where it
   * can be asserted, and it is never empty.
   */
  it("names the on-CPU bucket rather than returning an empty string", () => {
    const label = waitBucketLabel(waitBucketLabelParts(null, null), translate);
    expect(label).toBeTruthy();
    expect(String(label).trim()).not.toBe("");
    expect(String(label).toLowerCase()).toContain("cpu");
  });

  /**
   * A real wait event keeps the ENGINE'S OWN vocabulary verbatim — that token
   * is what the DBA pastes into a search, and translating it into a
   * cross-engine bucket erases it.
   */
  it("keeps the engine's own token for a real wait event", () => {
    const label = String(waitBucketLabel(waitBucketLabelParts("Lock", "transactionid"), translate));
    expect(label).toContain("transactionid");
  });

  it("never returns an empty label for any bucket shape", () => {
    const shapes: [string | null, string | null][] = [
      ["Lock", "tuple"],
      ["Lock", null],
      [null, "ClientRead"],
      [null, null],
    ];
    for (const [type, event] of shapes) {
      const label = String(waitBucketLabel(waitBucketLabelParts(type, event), translate));
      expect(label.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("buildWaitBreakdown", () => {
  const buckets: ActivityWaitBucket[] = [
    { wait_event_type: "Client", wait_event: "ClientRead", sessions: 4710, share: 0.813 },
    { wait_event_type: null, wait_event: null, sessions: 292, share: 0.0504 },
    { wait_event_type: "Lock", wait_event: "transactionid", sessions: 282, share: 0.0487 },
  ];

  it("keeps the server's ordering, which is already sessions DESC", () => {
    const rows = buildWaitBreakdown(buckets);
    expect(rows.map((r) => r.sessions)).toEqual([4710, 292, 282]);
  });

  /**
   * ...and does NOT re-sort. The server's ORDER BY carries its own tie-breaking,
   * and a defensive client-side sort would silently reorder equal counts. Fed
   * an ascending set, the output must still be ascending.
   */
  it("does not impose its own ordering on the server's rows", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Lock", wait_event: "tuple", sessions: 1, share: 0.01 },
      { wait_event_type: "Client", wait_event: "ClientRead", sessions: 99, share: 0.99 },
    ]);
    expect(rows.map((r) => r.sessions)).toEqual([1, 99]);
  });

  /**
   * The server's shares are passed through UNCHANGED. Recomputing them over
   * this fixture would give 0.8914 / 0.0553 / 0.0534 — plausible-looking and
   * wrong, because the server divided by the whole window's total (5791) while
   * these three buckets sum to 5284.
   */
  it("passes the whole fixture's shares through without recomputing any of them", () => {
    expect(buildWaitBreakdown(buckets).map((r) => r.share)).toEqual([0.813, 0.0504, 0.0487]);
  });

  it("marks the empty-wait bucket as on CPU instead of dropping it", () => {
    const rows = buildWaitBreakdown(buckets);
    const onCpu = rows.find((r) => r.onCpu);
    expect(onCpu).toBeDefined();
    expect(onCpu?.sessions).toBe(292);
  });

  /**
   * `share` is computed SERVER-side over the whole window (the rows are an
   * aggregate, not the row-limited sample), so the UI must pass it through and
   * never recompute it from the buckets it happens to have been sent.
   */
  it("passes the server's share through rather than recomputing it", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Lock", wait_event: "tuple", sessions: 3, share: 0.42 },
    ]);
    expect(rows[0].share).toBeCloseTo(0.42, 10);
  });

  /**
   * The server writes `share` on every bucket, computed over the WHOLE
   * window's GROUP BY total. A client-side re-derivation would divide by
   * whatever subset it happens to hold, so a top-3 slice of 40 buckets would
   * inflate an 81% bucket to 97% — a plausible-looking wrong number, which is
   * worse than none. When the server omitted the share, say so rather than
   * inventing one.
   */
  it("does not invent a share the server did not send", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Lock", wait_event: "tuple", sessions: 3 },
      { wait_event_type: "Client", wait_event: "ClientRead", sessions: 1 },
    ] as ActivityWaitBucket[]);
    expect(rows[0].share).toBeNull();
    expect(rows[1].share).toBeNull();
    // The counts are still real and still render.
    expect(rows.map((r) => r.sessions)).toEqual([3, 1]);
  });

  it("gives every row a unique, stable key", () => {
    const rows = buildWaitBreakdown(buckets);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(buildWaitBreakdown(buckets).map((r) => r.key)).toEqual(rows.map((r) => r.key));
  });

  it("survives an empty aggregate without throwing", () => {
    expect(buildWaitBreakdown([])).toEqual([]);
    expect(buildWaitBreakdown(undefined)).toEqual([]);
    expect(buildWaitBreakdown(null)).toEqual([]);
  });

  /** A genuine zero-session bucket may honestly report a zero share. */
  it("keeps an explicit zero share on a bucket with no sessions", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Lock", wait_event: "tuple", sessions: 0, share: 0 },
    ]);
    expect(rows[0].share).toBe(0);
  });

  /**
   * But `share: 0` beside a NON-ZERO session count is arithmetically
   * impossible: the backend emits `0.0` as its divide-by-zero fallback when the
   * aggregate total comes out zero (a column-alias regression makes every
   * `sessions` read as 0). Rendering that as a confident "0%" next to "4,710
   * sessions" is a wrong number stated with certainty, so it degrades to no
   * share at all.
   */
  it("refuses a zero share that contradicts a non-zero session count", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Client", wait_event: "ClientRead", sessions: 4710, share: 0 },
    ]);
    expect(rows[0].share).toBeNull();
    // The count itself is real and still renders.
    expect(rows[0].sessions).toBe(4710);
  });

  it("coerces a missing session count to zero rather than NaN", () => {
    const rows = buildWaitBreakdown([{ wait_event_type: "Lock" }] as ActivityWaitBucket[]);
    expect(rows[0].sessions).toBe(0);
    expect(Number.isNaN(rows[0].sessions)).toBe(false);
  });

  /**
   * The key must distinguish buckets that differ only in WHICH field is empty.
   * A naive `${type}${event}` concatenation collapses `{Lock, null}` and
   * `{null, Lock}` into one row and silently sums two unrelated wait classes.
   */
  it("does not collide buckets that differ only in which field is empty", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Lock", wait_event: null, sessions: 1, share: 0.5 },
      { wait_event_type: null, wait_event: "Lock", sessions: 1, share: 0.5 },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    // ...and neither is the on-CPU bucket, which needs BOTH empty.
    expect(rows.every((r) => r.key !== ACTIVITY_ON_CPU)).toBe(true);
  });
});

describe("buildStateSummary", () => {
  const states: ActivityStateBucket[] = [
    { state: "idle", sessions: 4710 },
    { state: "active", sessions: 820 },
    { state: "idle in transaction", sessions: 261 },
  ];

  it("keeps the server's ordering and counts", () => {
    const rows = buildStateSummary(states);
    expect(rows.map((r) => [r.state, r.sessions])).toEqual([
      ["idle", 4710],
      ["active", 820],
      ["idle in transaction", 261],
    ]);
  });

  it("computes each state's share of the sampled total", () => {
    const rows = buildStateSummary([
      { state: "active", sessions: 3 },
      { state: "idle", sessions: 1 },
    ]);
    expect(rows[0].share).toBeCloseTo(0.75, 10);
    expect(rows[1].share).toBeCloseTo(0.25, 10);
  });

  /**
   * `idle in transaction` is the alerting condition — a session holding a
   * transaction open holds back the xmin horizon and blocks autovacuum. It has
   * to be distinguishable from plain `idle`, which is harmless.
   */
  it("flags idle-in-transaction as the state that needs attention", () => {
    const rows = buildStateSummary(states);
    const byState = Object.fromEntries(rows.map((r) => [r.state, r]));
    expect(byState["idle in transaction"].tone).toBe("warning");
    // Asserted positively: `.not.toBe("warning")` would also accept `undefined`,
    // which is not a tone the strip can render.
    expect(byState["idle"].tone).toBe("neutral");
    expect(byState["active"].tone).toBe("neutral");
  });

  /**
   * The share denominator is this breakdown's OWN total (5791), which is not
   * the wait breakdown's total (5284). A shared helper dividing by the wrong
   * one lands within 0.001 of the right answer on this data, so the values are
   * pinned rather than spot-checked.
   */
  it("computes each state's share against the state total, not another breakdown's", () => {
    const rows = buildStateSummary(states);
    expect(rows.map((r) => Number((r.share as number).toFixed(4)))).toEqual([
      0.8133, 0.1416, 0.0451,
    ]);
  });

  it("gives every state row a unique, stable key", () => {
    const rows = buildStateSummary([
      { state: "idle", sessions: 1 },
      { state: null, sessions: 2 },
      { state: null, sessions: 3 },
    ]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("names a null state rather than rendering a blank row", () => {
    const rows = buildStateSummary([{ state: null, sessions: 5 }]);
    expect(rows[0].unknown).toBe(true);
    expect(rows[0].sessions).toBe(5);
  });

  it("survives an empty or absent aggregate", () => {
    expect(buildStateSummary([])).toEqual([]);
    expect(buildStateSummary(undefined)).toEqual([]);
    expect(buildStateSummary(null)).toEqual([]);
  });

  it("does not produce NaN shares over a zero total", () => {
    const rows = buildStateSummary([{ state: "idle", sessions: 0 }]);
    expect(rows[0].share).toBe(0);
  });
});

describe("durationKindOf", () => {
  /**
   * The state-dependent duration trap, straight out of the spec. The SAME
   * number means "running 40s and still going" for a live session and "last
   * query took 40s, now idle" for an idle one — opposite actions. This mirrors
   * `ActivitySample::duration_is_live` in server_vantage.rs; the two must agree
   * or the UI labels a row the opposite of how the server published it.
   */
  it("reads an active session's duration as still running", () => {
    expect(durationKindOf("active")).toBe("running");
  });

  it("reads an idle session's duration as the last completed query", () => {
    expect(durationKindOf("idle")).toBe("completed");
    expect(durationKindOf("idle in transaction")).toBe("completed");
    expect(durationKindOf("idle in transaction (aborted)")).toBe("completed");
  });

  /**
   * MySQL has no `active` state at all. Its canonical states come from
   * `mysql.session.status`, which the capture shows is `running` / `waiting`
   * (`mysql.threads.processlist_state`, which carries `executing`, is SHADOWED
   * by it in `canonicalize_activity`'s precedence list, so it never reaches the
   * wire as `state`).
   */
  it("reads the MySQL running state as still running", () => {
    expect(durationKindOf("running")).toBe("running");
  });

  /**
   * The counter-intuitive one, and the majority of real MySQL rows: `waiting`
   * is a LIVE state. The session is blocked on a lock or on IO, not idle, so
   * its duration is still ticking. Reading the English word rather than
   * `duration_is_live` puts it in the completed column and reports a stuck
   * session as one that already finished.
   */
  it("reads the MySQL waiting state as still running, not completed", () => {
    expect(durationKindOf("waiting")).toBe("running");
  });

  /**
   * `other` is MySQL's third observed state and is NOT live, so its figure is a
   * completed one. Asserted positively rather than as `not("running")`, which
   * would also accept "unknown" and leave the column blank on a real state the
   * engine does report.
   */
  it("reads the MySQL `other` state as a completed duration", () => {
    expect(durationKindOf("other")).toBe("completed");
  });

  /**
   * The two predicates must not drift apart: anything on CPU is by definition
   * still running. (The converse does NOT hold — `waiting` is running but not
   * on CPU — which is exactly why this is asserted in one direction only.)
   */
  it("agrees with isOnCpu: on CPU implies still running", () => {
    for (const state of ["active", "running", "waiting", "idle", "other", "", null]) {
      if (isOnCpu(state, null)) expect(durationKindOf(state)).toBe("running");
    }
  });

  /** An unfamiliar state is refused by BOTH predicates, not guessed by one. */
  it("refuses an unknown state consistently with isOnCpu", () => {
    expect(durationKindOf("some future state")).toBe("unknown");
    expect(isOnCpu("some future state", null)).toBe(false);
  });

  /**
   * An unknown state must NOT be guessed into either bucket: claiming a
   * finished query is still running (or the reverse) is the exact confusion
   * this function exists to prevent.
   */
  it("refuses to guess when the state is unknown", () => {
    expect(durationKindOf(null)).toBe("unknown");
    expect(durationKindOf("")).toBe("unknown");
    expect(durationKindOf("some future state")).toBe("unknown");
  });

  it("is case-insensitive about the state spelling", () => {
    expect(durationKindOf("ACTIVE")).toBe("running");
    expect(durationKindOf("Idle")).toBe("completed");
  });
});

describe("transactionAgeSeconds", () => {
  const now = Date.parse("2026-08-11T02:53:43Z");

  /**
   * Transaction age is a DIFFERENT clock from query age, and it is what
   * separates a 5ms idle-in-transaction from a 20-minute incident.
   */
  it("ages the transaction from xact_start, not from query_start", () => {
    const age = transactionAgeSeconds(
      { xact_start: "2026-08-11T02:33:43Z", query_start: "2026-08-11 02:53:42.000000+00" },
      now,
    );
    expect(age).toBeCloseTo(1200, 0);
  });

  it("reads the Postgres-native spelling of xact_start too", () => {
    // Whichever format the engine sends, the age must come out the same.
    const iso = transactionAgeSeconds({ xact_start: "2026-08-11T02:33:43Z" }, now);
    const native = transactionAgeSeconds({ xact_start: "2026-08-11 02:33:43+00" }, now);
    expect(native).toBeCloseTo(iso as number, 3);
  });

  it("returns null when the session is in no transaction", () => {
    expect(transactionAgeSeconds({ xact_start: null }, now)).toBeNull();
    expect(transactionAgeSeconds({}, now)).toBeNull();
    expect(transactionAgeSeconds({ xact_start: "" }, now)).toBeNull();
  });

  /** A clock-skewed future start must not render as a negative age. */
  it("clamps a future transaction start to zero", () => {
    expect(transactionAgeSeconds({ xact_start: "2026-08-11T03:00:00Z" }, now)).toBe(0);
  });

  /**
   * Production never passes `now` — every render uses the default. An
   * implementation defaulting it to 0 (or to the epoch) passes every test above
   * and then reports every transaction as decades old, so the default has to be
   * pinned to the real clock.
   */
  it("defaults to the current clock when the caller passes no `now`", () => {
    const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
    const age = transactionAgeSeconds({ xact_start: twoMinutesAgo });
    expect(age).not.toBeNull();
    expect(age as number).toBeGreaterThanOrEqual(119);
    expect(age as number).toBeLessThan(130);
  });
});

describe("isNotableTransactionAge", () => {
  /**
   * The spec's own framing: `idle in transaction` for 5ms is normal, for 20
   * minutes it is an incident. Flagging every open transaction would put a
   * warning on essentially every active row, which trains the reader to ignore
   * the one that matters.
   */
  it("does not flag a short, ordinary transaction", () => {
    expect(isNotableTransactionAge(0.005)).toBe(false);
    expect(isNotableTransactionAge(5)).toBe(false);
  });

  it("flags a transaction that has been open long enough to matter", () => {
    expect(isNotableTransactionAge(1200)).toBe(true);
  });

  /** Shares the threshold the blocking page already uses for an idle holder. */
  it("uses the same one-minute floor the blocking page uses", () => {
    expect(isNotableTransactionAge(IDLE_BLOCKER_SECONDS)).toBe(true);
    expect(isNotableTransactionAge(IDLE_BLOCKER_SECONDS - 1)).toBe(false);
  });

  it("does not flag a session that is in no transaction", () => {
    expect(isNotableTransactionAge(null)).toBe(false);
    expect(isNotableTransactionAge(undefined)).toBe(false);
  });
});

describe("parseActivitySessions", () => {
  it("passes a well-formed session through unchanged", () => {
    const rows = parseActivitySessions([session()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_pid).toBe(81491);
  });

  it("tolerates a null or absent hits array", () => {
    expect(parseActivitySessions(undefined)).toEqual([]);
    expect(parseActivitySessions(null)).toEqual([]);
    expect(parseActivitySessions([])).toEqual([]);
  });

  /**
   * `{}` is the unblocked sentinel and the server already parses it to an empty
   * ARRAY. A `[0]` or a stray null in the list would render a phantom blocker.
   */
  it("never reports a phantom blocker from an empty pid list", () => {
    const [row] = parseActivitySessions([session({ blocking_pids: [], blocked: false })]);
    expect(row.blocking_pids).toEqual([]);
    expect(row.blocked).toBe(false);
  });

  it("carries multiple blockers through, which is normal on a lock queue", () => {
    const [row] = parseActivitySessions([
      session({ blocking_pids: [82363, 81491], blocked: true }),
    ]);
    expect(row.blocking_pids).toEqual([82363, 81491]);
    expect(row.blocked).toBe(true);
  });

  /**
   * `blocking_pids` is the SOLE blocked-ness predicate (E2/E3) — the server
   * derives `blocked` from it in the adjacent line. So the pid list wins in
   * BOTH directions, and the consequential direction is this one: a non-empty
   * list with a falsy/absent flag must still read as blocked, or a genuinely
   * stuck session is filtered out of view.
   */
  it("reads a session with blockers as blocked even when the flag is absent", () => {
    const [row] = parseActivitySessions([
      session({ blocking_pids: [82363], blocked: undefined }) as ActivitySession,
    ]);
    expect(row.blocked).toBe(true);
  });

  it("does not report a blocker when the pid list is empty but the flag is set", () => {
    const [row] = parseActivitySessions([session({ blocking_pids: [], blocked: true })]);
    expect(row.blocked).toBe(false);
  });

  it("treats an absent pid list as unblocked rather than throwing", () => {
    const [row] = parseActivitySessions([
      session({ blocking_pids: undefined, blocked: undefined }) as ActivitySession,
    ]);
    expect(row.blocked).toBe(false);
    expect(row.blocking_pids).toEqual([]);
  });
});

describe("buildActivityRows", () => {
  /**
   * One pid appears in every poll inside the window, so pid alone is not a key.
   * The third row here is byte-identical to the second — `hits` is a flat row
   * list with no uniqueness guarantee — so the position has to participate in
   * the key or two real rows collapse into one in the table.
   */
  it("gives every row a unique key even when sessions are indistinguishable", () => {
    const rows = buildActivityRows([
      session({ session_pid: 81491, timestamp: 1 }),
      session({ session_pid: 81491, timestamp: 2 }),
      session({ session_pid: 81491, timestamp: 2 }),
    ]);
    expect(new Set(rows.map((r) => r.rowKey)).size).toBe(3);
  });

  /** Keys must be stable across renders, or the table loses row identity. */
  it("produces the same keys for the same input", () => {
    const input = [session({ session_pid: 1 }), session({ session_pid: 2 })];
    expect(buildActivityRows(input).map((r) => r.rowKey)).toEqual(
      buildActivityRows(input).map((r) => r.rowKey),
    );
  });

  /**
   * The split the spec demands, wired to the fields the server ACTUALLY sends.
   *
   * `to_record` writes `o2_dbm_duration_ms` only when `duration_is_live()`, so
   * on the wire `duration_ms` is non-null iff the session is running.
   * `exec_time_ms` is written unconditionally and is the SAME number — which
   * means for an idle session it is the last COMPLETED query's time, and it is
   * the only figure that row has. Reading `duration_ms` for the completed
   * column would leave it permanently blank.
   */
  it("takes the running duration from duration_ms on a live session", () => {
    const [running] = buildActivityRows([
      session({ state: "active", duration_ms: 40_000, exec_time_ms: 40_000 }),
    ]);
    expect(running.durationKind).toBe("running");
    expect(running.runningMs).toBe(40_000);
    expect(running.lastQueryMs).toBeNull();
  });

  it("takes the completed duration from exec_time_ms on an idle session", () => {
    // The producible shape: the server omits duration_ms entirely here.
    const [completed] = buildActivityRows([
      session({ state: "idle", duration_ms: null, exec_time_ms: 859.2 }),
    ]);
    expect(completed.durationKind).toBe("completed");
    expect(completed.lastQueryMs).toBe(859.2);
    expect(completed.runningMs).toBeNull();
  });

  /**
   * The two never share a column, which is the whole point: a live 40s and a
   * finished 40s demand opposite actions.
   */
  it("never fills both duration columns on one row", () => {
    for (const state of ["active", "idle", "idle in transaction", "running", "waiting", null]) {
      const [row] = buildActivityRows([
        session({ state, duration_ms: 40_000, exec_time_ms: 40_000 }),
      ]);
      expect(row.runningMs === null || row.lastQueryMs === null).toBe(true);
    }
  });

  it("puts an unknown-state duration in neither column", () => {
    const [row] = buildActivityRows([
      session({ state: null, duration_ms: null, exec_time_ms: 40_000 }),
    ]);
    expect(row.durationKind).toBe("unknown");
    expect(row.runningMs).toBeNull();
    expect(row.lastQueryMs).toBeNull();
  });

  it("leaves both duration columns empty when the sample carried no timing at all", () => {
    const [row] = buildActivityRows([session({ duration_ms: null, exec_time_ms: null })]);
    expect(row.runningMs).toBeNull();
    expect(row.lastQueryMs).toBeNull();
  });

  /**
   * A real zero is not a missing value. `exec_time_ms: 0` means "under a
   * millisecond", which a `|| null` coercion silently turns into an em dash.
   */
  it("keeps a genuine zero duration rather than blanking it", () => {
    const [row] = buildActivityRows([
      session({ state: "idle", duration_ms: null, exec_time_ms: 0 }),
    ]);
    expect(row.lastQueryMs).toBe(0);
  });

  /**
   * `buildActivityRows` must normalise its input itself. The page hands it
   * `response.hits` directly, so a row whose `blocked` flag is absent has to be
   * derived from the pid list here — not left to a `parseActivitySessions`
   * call the page might never make.
   */
  it("derives blocked-ness from the pid list on its own input", () => {
    const [row] = buildActivityRows([
      session({ blocking_pids: [82363], blocked: undefined }) as ActivitySession,
    ]);
    expect(row.blocked).toBe(true);
  });

  /**
   * A MySQL `waiting` session is live, so its ticking duration must land in the
   * running column — not be reported as a query that already finished.
   */
  it("puts a MySQL waiting session's duration in the running column", () => {
    const [row] = buildActivityRows([
      session({ db_system: "mysql", state: "waiting", duration_ms: 2400, exec_time_ms: 2400 }),
    ]);
    expect(row.runningMs).toBe(2400);
    expect(row.lastQueryMs).toBeNull();
  });

  it("marks the on-CPU rows so the cell never renders blank", () => {
    const [onCpu] = buildActivityRows([session({ state: "active", wait_event: null })]);
    expect(onCpu.onCpu).toBe(true);

    const [waiting] = buildActivityRows([session({ state: "active", wait_event: "tuple" })]);
    expect(waiting.onCpu).toBe(false);
  });

  it("normalises both timestamp formats onto epoch millis", () => {
    const [row] = buildActivityRows([session()]);
    expect(row.queryStartMs).not.toBeNull();
    expect(row.xactStartMs).not.toBeNull();
    // Same instant to the second, from two different spellings.
    expect(Math.floor((row.queryStartMs as number) / 1000)).toBe(
      Math.floor((row.xactStartMs as number) / 1000),
    );
  });

  it("leaves the normalised timestamps null when the engine sent none", () => {
    const [row] = buildActivityRows([session({ query_start: null, xact_start: null })]);
    expect(row.queryStartMs).toBeNull();
    expect(row.xactStartMs).toBeNull();
  });

  it("survives an empty session list", () => {
    expect(buildActivityRows([])).toEqual([]);
  });
});

describe("sampleDisclosure", () => {
  /**
   * The honesty requirement. The page must say (a) that this is SAMPLED rather
   * than continuous, (b) how often, and (c) that the receiver already FILTERED
   * the sample — idle sessions older than the newest query are dropped unless
   * they block someone, so this is not a faithful pg_stat_activity snapshot.
   */
  it("reports the interval when the server could infer one", () => {
    const d = sampleDisclosure(10);
    expect(d.intervalSeconds).toBe(10);
    expect(d.intervalKnown).toBe(true);
  });

  /**
   * `sample_interval_seconds` is null when the backend saw too few polls to
   * infer a spacing. The page must degrade to non-numeric copy rather than
   * printing "every null seconds".
   */
  it("degrades to non-numeric copy when the interval is unknown", () => {
    for (const missing of [null, undefined]) {
      const d = sampleDisclosure(missing);
      expect(d.intervalKnown).toBe(false);
      expect(d.intervalSeconds).toBeNull();
    }
  });

  it("treats a nonsense interval as unknown rather than printing it", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sampleDisclosure(bad).intervalKnown).toBe(false);
    }
  });

  /**
   * Our shipped default is 10s, NOT Datadog's 1 Hz. The disclosure must never
   * imply a fidelity we do not ship, so there is no default-to-1 anywhere.
   */
  it("never substitutes a default interval it did not measure", () => {
    expect(sampleDisclosure(null).intervalSeconds).toBeNull();
    expect(sampleDisclosure(undefined).intervalSeconds).toBeNull();
  });

  /** The filter disclosure is unconditional — it is true of every sample. */
  it("always discloses that the sample is filtered", () => {
    expect(sampleDisclosure(10).filtered).toBe(true);
    expect(sampleDisclosure(null).filtered).toBe(true);
  });

  /**
   * The backend clamps the inferred median to a minimum of 1 whole second
   * (`.round().max(1.0) as i64`), so 1 is a real value and must not be
   * mistaken for a falsy "unknown" by a truthiness check.
   */
  it("accepts the clamp floor of one second as a known interval", () => {
    expect(sampleDisclosure(1)).toMatchObject({ intervalKnown: true, intervalSeconds: 1 });
  });

  /**
   * A nonsense interval must not leak through as the NUMBER either — an
   * implementation that flags it unknown while still returning `NaN` renders
   * "every NaN seconds", which is the failure this guard exists for.
   */
  it("returns no number at all for a nonsense interval", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(sampleDisclosure(bad).intervalSeconds).toBeNull();
    }
  });
});

describe("activityDisclosureLines", () => {
  /**
   * THE honesty requirement, asserted as the copy the reader actually sees
   * rather than as a boolean nobody renders. The page must state (a) that this
   * is sampled rather than continuous, (b) how often, and (c) that the receiver
   * already filtered the sample.
   */
  it("states the interval and that the view is sampled, not continuous", () => {
    const text = activityDisclosureLines(sampleDisclosure(10), translate).join(" ").toLowerCase();
    expect(text).toContain("10");
    expect(text).toContain("sampl");
  });

  /**
   * The filter disclosure is unconditional: idle sessions older than the newest
   * query are excluded unless they block someone, so this is NOT a faithful
   * pg_stat_activity snapshot and the page may not imply that it is.
   */
  it("always discloses that the sample is filtered, interval known or not", () => {
    for (const interval of [10, null]) {
      const text = activityDisclosureLines(sampleDisclosure(interval), translate)
        .join(" ")
        .toLowerCase();
      expect(text).toContain("idle");
    }
  });

  /**
   * Our shipped default is 10s, not Datadog's 1 Hz. With no inferred interval
   * the copy must degrade to a non-numeric sentence rather than printing a
   * broken string or inventing a rate we do not ship.
   */
  it("degrades to non-numeric copy when the interval is unknown", () => {
    const lines = activityDisclosureLines(sampleDisclosure(null), translate);
    const text = lines.join(" ");
    expect(text).not.toMatch(/\bnull\b|\bNaN\b|\bundefined\b/);
    // Still says it is sampled — losing the interval must not lose the caveat.
    expect(text.toLowerCase()).toContain("sampl");
    // ...and does not assert a specific rate it never measured.
    expect(text).not.toMatch(/every \d/i);
  });

  it("never emits an empty line", () => {
    for (const interval of [10, 1, null]) {
      const lines = activityDisclosureLines(sampleDisclosure(interval), translate);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(String(line).trim()).not.toBe("");
    }
  });
});

describe("waitTotals", () => {
  const buckets: ActivityWaitBucket[] = [
    { wait_event_type: "Client", wait_event: "ClientRead", sessions: 4710, share: 0.813 },
    { wait_event_type: null, wait_event: null, sessions: 292, share: 0.0504 },
    { wait_event_type: "Lock", wait_event: "transactionid", sessions: 282, share: 0.0487 },
  ];

  /**
   * The summary tiles have to be ONE grain. These come from the same SQL
   * aggregate as the total beside them, so all of them count session SAMPLES.
   * Counting "on CPU" off the row-limited table instead would put an
   * undercount next to an aggregate and invite the reader to compare them.
   */
  it("counts the on-CPU bucket from the aggregate, not the row sample", () => {
    expect(waitTotals(buckets).onCpu).toBe(292);
  });

  it("counts every waiting session across the remaining buckets", () => {
    expect(waitTotals(buckets).waiting).toBe(4710 + 282);
  });

  it("reports zero for both when the breakdown is absent", () => {
    expect(waitTotals(undefined)).toEqual({ onCpu: 0, waiting: 0 });
    expect(waitTotals([])).toEqual({ onCpu: 0, waiting: 0 });
  });

  /** No bucket is both, so the two must partition the aggregate total. */
  it("partitions the aggregate total between the two tallies", () => {
    const { onCpu, waiting } = waitTotals(buckets);
    expect(onCpu + waiting).toBe(4710 + 292 + 282);
  });
});

describe("topWaitRows", () => {
  const many = (n: number): ActivityWaitBucket[] =>
    Array.from({ length: n }, (_, i) => ({
      wait_event_type: "LWLock",
      wait_event: `lock${i}`,
      sessions: 100 - i,
      share: (100 - i) / 5000,
    }));

  /**
   * A strip of 40 slivers is unreadable, so the tail is collapsed. But the
   * shares are computed by the SERVER over ALL buckets, so showing the top 6
   * alone leaves the visible percentages summing to well under 100% with no
   * explanation — the reader concludes the chart is broken or that a quarter of
   * the sample vanished. The remainder is stated instead.
   */
  it("collapses the tail into a remainder that accounts for what is not shown", () => {
    const rows = buildWaitBreakdown(many(40));
    const { shown, remainder } = topWaitRows(rows, 6);
    expect(shown).toHaveLength(6);
    expect(remainder).not.toBeNull();
    expect(remainder?.buckets).toBe(34);
    // Every session the strip does not show is accounted for in the remainder.
    const shownSessions = shown.reduce((sum, r) => sum + r.sessions, 0);
    const allSessions = rows.reduce((sum, r) => sum + r.sessions, 0);
    expect(shownSessions + (remainder?.sessions ?? 0)).toBe(allSessions);
  });

  it("has no remainder when everything already fits", () => {
    const { shown, remainder } = topWaitRows(buildWaitBreakdown(many(4)), 6);
    expect(shown).toHaveLength(4);
    expect(remainder).toBeNull();
  });

  it("has no remainder at exactly the limit", () => {
    expect(topWaitRows(buildWaitBreakdown(many(6)), 6).remainder).toBeNull();
  });

  /** The remainder's share is summed from the server's own shares, not re-derived. */
  it("sums the remainder's share from the server's shares", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Client", wait_event: "ClientRead", sessions: 80, share: 0.8 },
      { wait_event_type: "Lock", wait_event: "tuple", sessions: 10, share: 0.1 },
      { wait_event_type: "Lock", wait_event: "transactionid", sessions: 6, share: 0.06 },
      { wait_event_type: "IO", wait_event: "DataFileRead", sessions: 4, share: 0.04 },
    ]);
    const { remainder } = topWaitRows(rows, 2);
    expect(remainder?.share).toBeCloseTo(0.1, 10);
  });

  /** A missing share must not become a wrong number in the remainder. */
  it("reports no remainder share when a hidden bucket had none", () => {
    const rows = buildWaitBreakdown([
      { wait_event_type: "Client", wait_event: "ClientRead", sessions: 80, share: 0.8 },
      { wait_event_type: "Lock", wait_event: "tuple", sessions: 10 },
    ] as ActivityWaitBucket[]);
    expect(topWaitRows(rows, 1).remainder?.share).toBeNull();
  });

  it("survives an empty breakdown", () => {
    expect(topWaitRows([], 6)).toEqual({ shown: [], remainder: null });
  });
});

describe("formatDurationMs", () => {
  /**
   * The wire unit here is MILLISECONDS (`exec_time_ms`, `duration_ms`) — the
   * same attribute name carries SECONDS on the top_query feed, so a formatter
   * that assumes the wrong unit is off by 1000 and looks entirely plausible.
   */
  it("prints sub-second durations in milliseconds", () => {
    expect(formatDurationMs(859.2)).toBe("859ms");
    expect(formatDurationMs(1)).toBe("1ms");
  });

  /** A real zero is "under a millisecond", not "no value". */
  it("prints a measured zero rather than an em dash", () => {
    expect(formatDurationMs(0)).toBe("0ms");
  });

  it("switches to seconds once a duration passes one second", () => {
    expect(formatDurationMs(1000)).toBe("1.0s");
    expect(formatDurationMs(40_000)).toBe("40.0s");
  });

  /** A session running for half an hour must not read as "1800.0s". */
  it("switches to minutes and hours for a long-running session", () => {
    expect(formatDurationMs(90_000)).toBe("1.5m");
    expect(formatDurationMs(3_600_000)).toBe("1.0h");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
  ])("renders an em dash for %s", (_label, value) => {
    expect(formatDurationMs(value as number | null | undefined)).toBe("—");
  });
});

describe("activityCountClaim", () => {
  /**
   * `hits` is a row-limited SAMPLE; the breakdowns are the population. Printing
   * the sample size as if it were the population is what §W2.3 calls the worst
   * available failure, "because it looks like an answer".
   */
  it("reports an untruncated row count as a complete count", () => {
    expect(activityCountClaim(17, false)).toMatchObject({ count: 17, complete: true });
  });

  it("reports a truncated row count as a floor, not a total", () => {
    expect(activityCountClaim(1000, true)).toMatchObject({ count: 1000, complete: false });
  });

  /**
   * The aggregate is `COUNT(*) … GROUP BY` over ROWS, and activity writes one
   * row PER SESSION PER POLL. So the total counts session SAMPLES, not distinct
   * sessions: a 200-session instance polled every 10s for an hour yields ~72000.
   *
   * Nothing here may present that as a session count. The function is named for
   * what it actually returns, and its copy says "samples" — the alternative
   * would be a 360x overstatement rendered as the authoritative population.
   */
  it("totals the SAMPLES in the aggregate, which is not a distinct-session count", () => {
    const samples = activitySampleTotal([
      { state: "idle", sessions: 4710 },
      { state: "active", sessions: 820 },
      { state: "idle in transaction", sessions: 261 },
    ]);
    expect(samples).toBe(5791);
  });

  it("has no total to report when the breakdown is empty", () => {
    expect(activitySampleTotal([])).toBeNull();
    expect(activitySampleTotal(undefined)).toBeNull();
  });
});

describe("hasLockData", () => {
  /**
   * MySQL's query_sample carries NO blocking or lock attributes at all —
   * verified against the capture, which has no `mysql.*lock*` key. The UI must
   * degrade rather than render an empty lock section beside every row.
   */
  it("reports no lock data for a MySQL-only result", () => {
    expect(
      hasLockData([
        session({
          db_system: "mysql",
          lock_mode: null,
          lock_type: null,
          lock_relation: null,
          blocking_pids: [],
        }),
      ]),
    ).toBe(false);
  });

  it("reports lock data when a Postgres row carries a lock", () => {
    expect(hasLockData([session({ lock_mode: "ShareLock" })])).toBe(true);
  });

  /** A blocked session is lock data even without a named lock mode. */
  it("counts a blocked session as lock data", () => {
    expect(hasLockData([session({ lock_mode: null, blocking_pids: [82363] })])).toBe(true);
  });

  it("keeps the section for a mixed result where only Postgres reports locks", () => {
    expect(
      hasLockData([
        session({ db_system: "mysql", lock_mode: null, blocking_pids: [] }),
        session({ db_system: "postgresql", lock_mode: "ShareLock" }),
      ]),
    ).toBe(true);
  });

  it("reports nothing to show for an empty result", () => {
    expect(hasLockData([])).toBe(false);
  });
});

describe("activityEmptyCause", () => {
  /**
   * "No active sessions" is GENUINELY GOOD NEWS and must not read as breakage —
   * that is the whole reason DbmLockEmptyState distinguishes healthy from not
   * collecting.
   *
   * The proof that we LOOKED is a populated breakdown: the aggregates are
   * computed over the whole window by SQL, so a non-empty `by_state` means
   * sessions were sampled even when the row list came back empty under the
   * current filters.
   */
  it("calls an empty result healthy when sampling is demonstrably working", () => {
    expect(
      activityEmptyCause({ notCollecting: false, logLinesSeen: 4210, hasBreakdown: true }),
    ).toBe("healthy");
  });

  it("calls it not-collecting when the server says nothing was ever written", () => {
    expect(
      activityEmptyCause({ notCollecting: true, logLinesSeen: null, hasBreakdown: false }),
    ).toBe("not-collecting");
  });

  /**
   * THE DEFAULT DEPLOYMENT, and the reason this function takes the breakdown at
   * all. `ZO_DB_MONITORING_ACTIVITY_ENABLED` ships OFF, so a cluster with the
   * deadlock recipes running has records in `dbm_server` — the liveness probe
   * counts records of ANY kind, so `not_collecting` comes back FALSE — while no
   * activity row has ever been written and the breakdown SQL is skipped
   * entirely for want of the columns.
   *
   * Reading only `not_collecting` there reports "no active sessions, all good"
   * on a database nobody is sampling. That is the exact lie the healthy state
   * exists to avoid.
   */
  it("does not call it healthy when nothing has ever sampled a session", () => {
    const cause = activityEmptyCause({
      notCollecting: false,
      logLinesSeen: 4210,
      hasBreakdown: false,
    });
    expect(cause).not.toBe("healthy");
    expect(cause).toBe("not-collecting");
  });

  /**
   * `log_lines_seen` is the PROOF the pipeline carries traffic, but the
   * server's verdict is authoritative and a zero count does not overturn a
   * working sample.
   */
  it("does not let a zero line count overturn a working sample", () => {
    expect(activityEmptyCause({ notCollecting: false, logLinesSeen: 0, hasBreakdown: true })).toBe(
      "healthy",
    );
  });

  /**
   * The two inputs must BOTH be load-bearing. `not_collecting` is the server's
   * own verdict — `hits.is_empty() && records_seen == 0` — and it is reachable
   * alongside a populated breakdown: the aggregates run over the request
   * window while the probe scans a wider range, so a scope filter that empties
   * the window can leave the verdict true with buckets still in hand.
   *
   * Without this case the whole function collapses to `hasBreakdown ? …`, and
   * an explicit "nothing is collecting" verdict is silently discarded.
   */
  it("honours an explicit not-collecting verdict even with a breakdown in hand", () => {
    expect(
      activityEmptyCause({ notCollecting: true, logLinesSeen: null, hasBreakdown: true }),
    ).toBe("not-collecting");
  });

  /**
   * An absent verdict with a populated breakdown is healthy: the breakdown is
   * itself the evidence, so a missing field must not be read as breakage.
   */
  it("treats an absent verdict with evidence of sampling as healthy", () => {
    expect(activityEmptyCause({ hasBreakdown: true })).toBe("healthy");
    expect(
      activityEmptyCause({ notCollecting: undefined, logLinesSeen: null, hasBreakdown: true }),
    ).toBe("healthy");
  });

  /** No verdict and no evidence: we cannot claim we looked. */
  it("does not claim health with no evidence at all", () => {
    expect(activityEmptyCause({})).toBe("not-collecting");
  });
});
