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
 * useDbmTabCounts — ONE request behind all the DBM tab strips.
 *
 * ## What was wrong, in two rounds
 *
 * The six DBM views are separate ROUTES, and each one rendered the shared tab
 * strip itself. The strip takes all six badge counts, so every page fanned out
 * to the OTHER five endpoints to fill them in. The numbers are identical on
 * every tab — they describe the same org over the same window — so visiting all
 * six tabs issued each of the six reads about six times: ~36 requests to answer
 * six questions. And a count is not cheap: measured live, `/activity` costs
 * 1880ms for the full read and 1739ms at `?size=1`, because the price is the
 * SCAN (dbm_server holds 2.77M irrelevant rows beside ~22K DBM records), not
 * the rows returned. There is no cheaper count to fetch instead.
 *
 * Round one replaced the six per-page fan-outs with one shared browser
 * fan-out. Round two — the current shape — moved that fan-out server-side:
 * the strip now issues ONE `/badges` request, and the server runs the same
 * six endpoint pipelines concurrently (plus the zero-trace fallbacks below,
 * when the client answer is exactly zero) and returns their bodies in one
 * envelope. `DbmShell.vue` — which already survives tab switches, because it
 * owns the `<keep-alive>` — calls `load()`, and every page reads the
 * resulting snapshot. Seven tabs now cost one badges call per window, plus
 * each page's own table read (the Slowest-calls badge adds no extra read —
 * it is a second fold of the envelope's databases member).
 *
 * ## Why the shape is uniform, and why that is the whole design
 *
 * The predecessor (`useDbmCountCache`) was keyed per PAGE — `"activity"`,
 * `"deadlocks"`, … — not because the numbers differed but because the six pages
 * had each built their OWN payload shape around the same responses. Table
 * health alone carried `blockingSamples`. So when the key was shared, whichever
 * page loaded first decided what the others got: land on Deadlocks, switch to
 * Table health, and it read `badges.blockingSamples` as `undefined` and threw
 * `samples is not iterable` out of `chainsFromSamples`.
 *
 * The per-page key made that unlikely at the cost of making the cache nearly
 * useless — six scopes meant six fan-outs. Here there is ONE shape and EVERY
 * key is always present: counts default to `null`, array payloads to `[]`. A
 * reader cannot receive a snapshot missing the field it needs, because no such
 * snapshot can be constructed. The bug is unrepresentable rather than avoided.
 *
 * ## `null` is not `0`
 *
 * A failed read yields `null` for its count and `[]` for its payload. Never
 * `0` — "we could not count" and "there are none" are different answers, and
 * the badge renders `null` as blank precisely so it cannot claim the second
 * when it means the first. The `/badges` envelope carries this per member —
 * a slice whose server-side read failed arrives as `null` — so one dead read
 * still blanks only its own badges instead of abandoning the rest, exactly as
 * the browser fan-out's `allSettled` did.
 *
 * ## Keyed on the window, not on a clock
 *
 * There is no TTL. A TTL caches stale truth — it hands back a number that may
 * genuinely have changed and hopes the interval was short enough. The claim
 * here is narrower and actually true: the same window over the same org with
 * the same filters is the same question, so it has the same answer. Move the
 * window and the key changes and everything refetches; that is the design
 * working, not a miss.
 *
 * The key is built from the `DbmRange` — the window the reader CHOSE — and not
 * from resolved bounds. `useDbmScope.refresh()` re-pins its anchor at the top
 * of every load, so a relative window's microsecond bounds differ on every
 * single load (verified: two `refresh()` calls 5ms apart produce different
 * `endTime`s). A key built from those could never hit, and the cache would be
 * dead code that still looked correct.
 */

import { readonly, ref, type DeepReadonly, type Ref } from "vue";

import dbMonitoringService, {
  type ActivitySession,
  type ActivityStateBucket,
  type BadgesResponse,
  type BlockingSample,
} from "@/services/db_monitoring";
import type { DbmRange } from "@/composables/dbm/useDbmScope";
import { activitySampleTotal } from "@/utils/dbm/activity";
import { countClaim, type DbmCountClaim } from "@/utils/dbm/format";

/**
 * Everything the tab strips need, from one request.
 *
 * EVERY field is always present. The counts are `null` when their read failed,
 * the arrays are `[]` — never `undefined`, which is the shape that produced
 * `samples is not iterable`. See the module comment.
 */
export interface DbmTabCounts {
  /**
   * Overview's row count, from `hits.length` — `/databases` returns no `total`,
   * and inventing one would make this badge disagree with the table it counts.
   */
  databaseCount: number | null;
  /**
   * Distinct statements in the window: the client read's uncapped `total`, or
   * — when that is exactly zero and the databases are reporting — the
   * database-reported list as a capped claim (the zero-trace fallback below).
   */
  queryCount: DbmCountClaim | number | null;
  /**
   * FINISHED CALLS in the window, summed from the `/databases` rows' exact
   * `calls` totals — no extra request. This is the Slowest-calls badge, and it
   * is deliberately NOT that page's own row count: the page shows a capped
   * top-list (`limit`, default 100), and a badge of its length would render
   * the cap as a meaningless constant. The badge answers "how much is
   * happening" — the same grain rule the Activity and Deadlocks badges follow,
   * where the table then shows a different cut of that population. In the
   * zero-trace fallback (below) it becomes the database-reported list as a
   * capped claim instead — the number the tab actually renders there.
   */
  sampleCallsCount: DbmCountClaim | number | null;
  /**
   * SESSION SAMPLES in the window, from the SQL state breakdown — never
   * `total`/`hits.length`, which are a row-limited sample and would render a
   * constant cap as if it were the population.
   */
  activityCount: number | null;
  /**
   * A claim, not a number: `/deadlocks` caps at `limit` and discloses it with
   * `truncated`, so the badge can render `65+` rather than printing the cap as
   * the total. Building the claim HERE is what keeps the `+` alive for every
   * reader of the snapshot.
   */
  deadlockCount: DbmCountClaim | null;
  /** Sessions waiting on a lock. Capped like `deadlockCount`, so also a claim. */
  blockedCount: DbmCountClaim | null;
  /**
   * Relations reported in the window. POSTGRES-ONLY, so `null` on a fleet with
   * no Postgres is honest — the badge must not claim zero tables for an engine
   * the recipe never queries.
   */
  tableHealthCount: number | null;
  /**
   * The activity state breakdown, kept alongside `activityCount` because
   * DatabasesPage renders the buckets themselves and not only their sum.
   */
  activityStates: ActivityStateBucket[];
  /**
   * The activity sample's sessions, for TableHealthPage's long-running-query
   * rule. A PROJECTION of the same `/activity` response the counts came from,
   * served from this snapshot rather than refetched — a second request over the
   * same window could disagree with the badge beside it.
   */
  sessions: ActivitySession[];
  /** The blocking samples, for the high-impact-blocker rule. As `sessions`. */
  blockingSamples: BlockingSample[];
}

/**
 * What an unanswered fan-out looks like: nothing known, nothing claimed.
 *
 * Every reader gets this before the first load resolves and after a total
 * failure, so no page ever sees a partially-shaped snapshot. Returned from a
 * function rather than shared as a constant so a reader mutating an array
 * cannot corrupt the next fan-out's starting point.
 */
export const emptyDbmTabCounts = (): DbmTabCounts => ({
  databaseCount: null,
  queryCount: null,
  sampleCallsCount: null,
  activityCount: null,
  deadlockCount: null,
  blockedCount: null,
  tableHealthCount: null,
  activityStates: [],
  sessions: [],
  blockingSamples: [],
});

/** The window, as the endpoints take it. */
interface DbmCountWindow {
  startTime: number;
  endTime: number;
}

/**
 * The identity of a fan-out: which org, over which window, under which filters.
 *
 * Relative and absolute are tagged distinctly so a `1h` period and an absolute
 * range that happens to span an hour never collide — the first slides with the
 * clock and the second does not, so they are different questions.
 *
 * Filters are part of the QUESTION, so they are part of the key: the counts are
 * fetched with `system` applied, and a key without it would serve the
 * unfiltered numbers after a filter change. Absent and empty fold together —
 * both mean "no filter". Client-side filtering (the search box, which narrows
 * rows already in hand) must never appear here: it changes nothing about what
 * was fetched, and keying on it would miss on every keystroke.
 */
export const dbmTabCountsKey = (
  org: string,
  range: DbmRange,
  filters: readonly (string | null | undefined)[] = [],
): string => {
  const window =
    range.type === "absolute"
      ? `abs|${range.startTime}|${range.endTime}`
      : `rel|${range.relativeTimePeriod ?? ""}`;
  return [org, window, ...filters.map((f) => f ?? "")].join("|");
};

/**
 * Issue the one `/badges` request and fold its envelope into one snapshot.
 *
 * The server runs the six endpoint pipelines concurrently — the same bodies
 * their tabs render, so a badge cannot disagree with its page — and each
 * envelope member is that endpoint's body or `null` for a failed read. The
 * fold below is unchanged from the six-read era: it consumes the same
 * response shapes, member by member.
 *
 * Exported for the spec, which needs to assert the fold (a null member gives
 * `null` and `[]`) without standing up the caching layer around it. Never
 * rejects: a failed request folds to the empty snapshot, which
 * `worthKeeping` then declines to cache.
 */
export const fetchDbmTabCounts = async (
  org: string,
  window: DbmCountWindow,
  filters: { system?: string | null } = {},
): Promise<DbmTabCounts> => {
  let badges: BadgesResponse;
  try {
    // `system` narrows the slices that accept it (databases, queries and the
    // server fallbacks) — the server applies it exactly as the six-read
    // fan-out did, so it rides the one request rather than per-endpoint.
    const response = await dbMonitoringService.getBadges(
      org,
      filters.system ? { ...window, system: filters.system } : window,
    );
    badges = response.data;
  } catch {
    // The whole request failed, so nothing is known — every count `null`,
    // every payload `[]`. The six-read fan-out could lose members one at a
    // time; a one-request total failure is the all-members-lost case.
    return emptyDbmTabCounts();
  }

  const { databases, queries, activity, deadlocks, blocking, table_health: tableHealth } = badges;

  const counts: DbmTabCounts = {
    databaseCount: databases ? (databases.hits?.length ?? 0) : null,
    // The same databases member, summed instead of counted: its rows carry
    // the rollup's EXACT per-instance `calls` totals, and instances partition
    // calls, so the sum is the window's finished-call population. A row without
    // `calls` (a row from an idle instance) contributes 0 rather than poisoning
    // the sum into `NaN`.
    sampleCallsCount: databases
      ? (databases.hits ?? []).reduce(
          (sum: number, row: { calls?: number }) => sum + (row.calls ?? 0),
          0,
        )
      : null,
    queryCount: queries ? (queries.total ?? queries.hits?.length ?? 0) : null,
    // From `by_state`, the population. Note this is the ARRAY — passing the
    // whole member here silently yields `null` forever, because a response
    // object has no `.length` for `activitySampleTotal` to reduce over.
    activityCount: activity ? activitySampleTotal(activity.by_state) : null,
    deadlockCount: deadlocks
      ? countClaim(deadlocks.total ?? deadlocks.hits?.length ?? 0, deadlocks.truncated)
      : null,
    blockedCount: blocking
      ? countClaim(blocking.total ?? blocking.hits?.length ?? 0, blocking.truncated)
      : null,
    tableHealthCount: tableHealth ? (tableHealth.total ?? tableHealth.hits?.length ?? 0) : null,
    // `[]` on failure, never `undefined`. A consumer iterates these directly.
    activityStates: activity ? (activity.by_state ?? []) : [],
    sessions: activity ? (activity.hits ?? []) : [],
    blockingSamples: blocking ? (blocking.hits ?? []) : [],
  };

  // ── The zero-trace fallback ────────────────────────────────────────────────
  //
  // A client-vantage zero is truthful about TRACES and false about the ORG
  // when the databases themselves are reporting: the Top-queries and
  // Slowest-calls tabs render database-reported lists there, and the strip
  // must count what the tabs show — on every tab, from the first paint, not
  // only after a page's own read lands (which is what made the badges flash
  // `0` and disagree across tabs). The SERVER arms the fallback — it runs the
  // two extra reads only when the client answer was EXACTLY zero (a null is a
  // failed read, and unknown is not zero) and includes the members in the
  // envelope: present-and-null means fired-and-failed, absent means the
  // condition never fired.
  const fallbackFired = "server_queries" in badges || "server_samples" in badges;
  if (fallbackFired) {
    const sq = badges.server_queries ?? null;
    const ss = badges.server_samples ?? null;
    // The same claims the fallback pages put on their own badges: the list
    // length with the cap disclosed — a full page renders `50+`, never the
    // cap as a total. An empty server answer leaves the honest client zero.
    if (sq?.hits?.length) counts.queryCount = countClaim(sq.hits.length, sq.truncated);
    if (ss?.hits?.length) counts.sampleCallsCount = countClaim(ss.hits.length, ss.truncated);
    // Overview: identity only, no request at all — distinct instances the
    // server vantage NAMES, from rows already in hand (the same sources the
    // fleet page's own union reads). This can undercount an instance known
    // only to the metric streams; the Overview page's own exact union
    // overrides this the moment it loads.
    if (counts.databaseCount === 0) {
      const named = new Set<string>();
      for (const row of [
        ...counts.sessions,
        ...counts.blockingSamples,
        ...(sq?.hits ?? []),
        ...(ss?.hits ?? []),
      ]) {
        const { db_system, db_instance } = row as {
          db_system?: string | null;
          db_instance?: string | null;
        };
        if (db_system || db_instance) named.add(`${db_system ?? ""}|${db_instance ?? ""}`);
      }
      if (named.size) counts.databaseCount = named.size;
    }
  }

  return counts;
};

/**
 * Whether a fan-out is worth remembering.
 *
 * A snapshot in which EVERY count failed says nothing, and caching it would
 * remember "we could not count" as the answer for the whole window — serving
 * those blanks to every later tab switch. A snapshot with some counts is kept:
 * the failures are shown, and the next window change gives them a fresh
 * attempt anyway.
 *
 * The looser rule (keep unless total failure) rather than the predecessor's
 * (discard unless total success) is deliberate. With one shared fan-out, a
 * single flaky endpoint would otherwise re-fire all six reads on every tab
 * switch — reintroducing the storm this exists to remove, in exactly the
 * situation where the backend is already struggling.
 */
const worthKeeping = (counts: DbmTabCounts): boolean =>
  counts.databaseCount !== null ||
  counts.queryCount !== null ||
  counts.activityCount !== null ||
  counts.deadlockCount !== null ||
  counts.blockedCount !== null ||
  counts.tableHealthCount !== null;

/**
 * Snapshots already fetched, and fan-outs still in flight.
 *
 * Module scope, deliberately: `DbmShell` is not itself kept alive by anything,
 * so a full remount of the DBM section would otherwise re-fetch a window it had
 * already answered. Plain `Map`s rather than refs because nothing renders the
 * cache — the shell copies the resolved snapshot into its own reactive ref.
 */
const settled = new Map<string, DbmTabCounts>();
const inFlight = new Map<string, Promise<DbmTabCounts>>();

/** Drop everything. For tests, so one cannot seed the next. */
export const clearDbmTabCounts = () => {
  settled.clear();
  inFlight.clear();
};

export interface DbmTabCountsLoadOptions {
  /** Skip the cached snapshot and refetch. What a refresh button passes. */
  force?: boolean;
}

export interface DbmTabCountsSource {
  /** The snapshot every tab strip renders. Always fully shaped. */
  counts: DeepReadonly<Ref<DbmTabCounts>>;
  /** Whether a fan-out is in flight. */
  loading: DeepReadonly<Ref<boolean>>;
  /**
   * Fetch the counts for this org/window/filters, serving the cached snapshot
   * when one is held. Concurrent callers for one key share a single request.
   */
  load: (
    org: string,
    range: DbmRange,
    window: DbmCountWindow,
    filters?: { system?: string | null },
    options?: DbmTabCountsLoadOptions,
  ) => Promise<void>;
}

/**
 * The shell's owner of the shared counts.
 *
 * Called ONCE, by `DbmShell.vue`. Pages do not call this — they inject the
 * snapshot it publishes (see `dbmTabCounts.ts`), which is what makes the single
 * fan-out single.
 */
export function useDbmTabCounts(): DbmTabCountsSource {
  const counts = ref<DbmTabCounts>(emptyDbmTabCounts());
  const loading = ref(false);

  /**
   * Which load owns the snapshot.
   *
   * Same guard the pages use for their own reads (`useDbmRequestSeq`), inlined
   * here because this composable has exactly one writer and needs no shared
   * token: a superseded window's numbers must never be written over a newer
   * one's, and HTTP gives no ordering guarantee.
   */
  let latest = 0;

  const load = async (
    org: string,
    range: DbmRange,
    window: DbmCountWindow,
    filters: { system?: string | null } = {},
    options: DbmTabCountsLoadOptions = {},
  ): Promise<void> => {
    if (!org) return;
    const key = dbmTabCountsKey(org, range, [filters.system]);
    const token = (latest += 1);

    if (!options.force) {
      const held = settled.get(key);
      if (held) {
        counts.value = held;
        return;
      }
    }

    // A forced load still JOINS an in-flight fan-out for its key rather than
    // starting a second one — two refresh clicks a moment apart are one
    // question, and the `force` above has already bypassed the settled value.
    let request = options.force ? undefined : inFlight.get(key);
    if (!request) {
      request = fetchDbmTabCounts(org, window, filters)
        .then((value) => {
          // Only a snapshot that learned SOMETHING is remembered, so a total
          // outage is never cached as a row of blank badges. A forced load
          // overwrites, so what a refresh superseded cannot be served next.
          if (worthKeeping(value)) settled.set(key, value);
          return value;
        })
        .finally(() => {
          // Cleared on both paths, so a rejection leaves nothing behind — not a
          // value, not a zero, not a poisoned promise. (`fetchDbmTabCounts`
          // catches its own request failure and resolves with the empty
          // snapshot, so it cannot reject; the rejection path guards
          // transport-layer surprises only, and the cleanup must hold either
          // way.)
          if (inFlight.get(key) === request) inFlight.delete(key);
        });
      inFlight.set(key, request);
    }

    loading.value = true;
    try {
      const value = await request;
      // A newer window already owns the snapshot. Writing here would paint the
      // superseded window's numbers beside the current window's table.
      if (token !== latest) return;
      counts.value = value;
    } catch {
      // `fetchDbmTabCounts` resolves even on request failure, so it cannot
      // reject — this guards transport-layer surprises only. Leave the
      // previous snapshot alone rather than blanking every badge over one
      // error; the counts stay whatever the last successful answer was, and
      // nothing was cached.
    } finally {
      if (token === latest) loading.value = false;
    }
  };

  return { counts: readonly(counts), loading: readonly(loading), load };
}

/** The seven count fields, as distinct from the snapshot's array payloads. */
type DbmTabCountKey =
  | "databaseCount"
  | "queryCount"
  | "sampleCallsCount"
  | "activityCount"
  | "deadlockCount"
  | "blockedCount"
  | "tableHealthCount";

/**
 * A badge as `DbmSectionTabs` accepts it: a plain number, a claim that can
 * render `65+`, or `null` for a count we do not have.
 */
type BadgeCount = DbmCountClaim | number | null;

/** The seven badge props, as the tab strip takes them. */
export type DbmTabCountProps = Record<DbmTabCountKey, BadgeCount>;

/**
 * A page's view of the shared snapshot, with its OWN badge overridden.
 *
 * Each page counts its own tab from the rows it actually loaded — Activity from
 * its state breakdown, Databases from its traffic rows, Queries from
 * `rows.length`, Deadlocks from its event total — which is fresher and more
 * specific than the shared fan-out's number and can differ from it legitimately
 * (the page applies its own filters). That behaviour predates this refactor and
 * is preserved exactly: the shell supplies the shared badges, the page
 * supplies its own.
 *
 * `own` is a `BadgeCount` rather than the snapshot's field type because a page
 * may legitimately hold a bare number where the shared read holds a claim —
 * DeadlocksPage does, and has always rendered it without the `+`.
 *
 * `undefined` from `own` means "I have no better number", and the shared one
 * stands. `null` is NOT that — it is a real "unknown" the page is asserting, so
 * it wins and blanks the badge.
 */
export const withOwnCount = (
  counts: DbmTabCountProps,
  key: DbmTabCountKey,
  own: BadgeCount | undefined,
): DbmTabCountProps => (own === undefined ? counts : { ...counts, [key]: own });

/** The seven badge props, ready to `v-bind` onto `DbmSectionTabs`. */
export const tabCountProps = (counts: DbmTabCountProps): DbmTabCountProps => ({
  databaseCount: counts.databaseCount,
  queryCount: counts.queryCount,
  sampleCallsCount: counts.sampleCallsCount,
  activityCount: counts.activityCount,
  deadlockCount: counts.deadlockCount,
  blockedCount: counts.blockedCount,
  tableHealthCount: counts.tableHealthCount,
});
