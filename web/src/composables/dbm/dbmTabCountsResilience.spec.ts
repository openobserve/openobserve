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
 * The badges must survive TAB SWITCHING.
 *
 * The reported symptom: a count that renders while you stand on its own tab
 * is blank when you look at the same tab's badge from a sibling. Measured
 * live on a zero-trace org (`/badges` answers `server_queries: 50`), the
 * shared snapshot is correct on every tab — so every way the strip can go
 * blank is a way the SNAPSHOT is lost, not a way it was never fetched.
 *
 * There are three, and they are what this suite pins:
 *
 *  1. A failed fan-out REPLACED the good snapshot with a row of blanks.
 *     `fetchDbmTabCounts` catches its own request failure and resolves with
 *     `emptyDbmTabCounts()`, so `load`'s own `catch` — the one whose comment
 *     promises to "leave the previous snapshot alone" — was unreachable, and
 *     the all-`null` value was written straight to `counts`.
 *
 *  2. A slice that FAILED inside an otherwise-good envelope blanked its badge
 *     even though the previous window had counted it. `null` means "we could
 *     not count", which is honest — but it must not erase a number we DID
 *     have moments ago on an unchanged window.
 *
 *  3. What a PAGE learns is invisible from its siblings. Each page overrides
 *     only its own badge into its own copy, so Overview's exact fleet count
 *     shows `6` on Overview and the shell's rawer number everywhere else —
 *     the same badge reading two ways depending on where you stand, which is
 *     precisely the reported bug.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/db_monitoring", () => ({
  // `getInstances` is stubbed alongside `getBadges` because the scope filters
  // now read the org's fleet for their instance picker (see
  // `useDbmFleetInstances`). The TDZ test below mounts a REAL page-shaped
  // component, so an unmocked method there is not a type error — it is an
  // undefined call that hangs the mount until the test times out.
  default: {
    getBadges: vi.fn(),
    getInstances: vi.fn().mockResolvedValue({ data: { hits: [] } }),
  },
}));

// `useDbmListPage` reads the selected org from the store; the TDZ test below
// mounts a real page-shaped component, so it needs one.
vi.mock("vuex", () => ({
  useStore: () => ({ state: { selectedOrganization: { identifier: "acme" }, zoConfig: {} } }),
}));

const { default: dbMonitoringService } = await import("@/services/db_monitoring");
const service = dbMonitoringService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const { useDbmTabCounts, clearDbmTabCounts, fetchDbmTabCounts } =
  await import("@/composables/dbm/useDbmTabCounts");
// The scope filters' instance picker reads the org's fleet through its own
// module-scoped cache, so one test's in-flight read would otherwise be served
// to the next.
const { clearDbmFleetInstances } = await import("@/composables/dbm/useDbmFleetInstances");
const { badgeCount, claimedCount } = await import("@/utils/dbm/format");

/**
 * A real envelope from a zero-trace org, captured live: the client vantage is
 * empty, the databases' own list carries 50 statements, and the three
 * enterprise slices answer.
 */
const envelope = () => ({
  databases: { hits: [] },
  queries: { total: 0, hits: [] },
  activity: { by_state: [{ state: "active", sessions: 137 }], hits: [] },
  deadlocks: { total: 100, truncated: true },
  blocking: { total: 100, truncated: true },
  table_health: { total: 8 },
  server_queries: { hits: new Array(50).fill({ db_system: "postgresql" }), truncated: true },
  server_samples: { hits: [], truncated: false },
});

const RANGE = { type: "relative", relativeTimePeriod: "12h", startTime: 0, endTime: 0 } as const;
const OTHER_RANGE = {
  type: "relative",
  relativeTimePeriod: "6h",
  startTime: 0,
  endTime: 0,
} as const;
const WINDOW = { startTime: 1_000, endTime: 2_000 };

describe("a failed fan-out must not blank badges that were already answered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDbmTabCounts();
    clearDbmFleetInstances();
  });

  it("keeps the previous window's numbers when the next fan-out fails", async () => {
    service.getBadges.mockResolvedValueOnce({ data: envelope() });
    const { counts, load } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { system: "postgresql" });
    expect(badgeCount(counts.value.queryCount)).toBe("50+");

    // The reader switches tab; the arriving page re-keys the window and the
    // new fan-out dies (backend blip, network drop, a 500 on one hop).
    service.getBadges.mockRejectedValueOnce(new Error("gateway"));
    await load("acme", OTHER_RANGE, WINDOW, { system: "postgresql" });

    expect(
      badgeCount(counts.value.queryCount),
      "a dead request must not erase a number we already had",
    ).toBe("50+");
    expect(badgeCount(counts.value.activityCount)).toBe("137");
    expect(badgeCount(counts.value.tableHealthCount)).toBe("8");
  });

  it("still shows nothing when the very first fan-out fails", async () => {
    service.getBadges.mockRejectedValueOnce(new Error("gateway"));
    const { counts, load } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW);

    // Nothing was ever known, so nothing may be claimed.
    expect(badgeCount(counts.value.queryCount)).toBeNull();
    expect(badgeCount(counts.value.activityCount)).toBeNull();
  });
});

// ── the Overview tile and the fallback badge count ONE list ──────────────────
//
// N1: on an OSS build `/blocking` is a 403 stub and there are no activity
// sessions, so a tile derived from those two arrays alone read 0 while the
// badge beside it counted the statement lists — working data one tab away,
// denied on the Overview. Both now consume `serverInstanceRefs`, one deduped
// derivation over every `dbm_server`-fed member of the envelope.
describe("the databases fallback counts the same refs the fleet union renders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDbmTabCounts();
    clearDbmFleetInstances();
  });

  it("derives instance refs from the statement lists, not only sessions and blocking", async () => {
    service.getBadges.mockResolvedValueOnce({
      data: {
        databases: { hits: [] },
        queries: { total: 0, hits: [] },
        activity: null,
        deadlocks: null,
        blocking: null,
        table_health: null,
        // The OSS shape: only the statement feeds answered. Their rows name
        // the engine but no instance.
        server_queries: {
          hits: new Array(50).fill({ db_system: "postgresql", db_instance: null }),
          truncated: true,
        },
        server_samples: { hits: [], truncated: false },
      },
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    // One engine, unnamed: one ref, and the badge is its length — never 0
    // above a rendered row, never 50 (one row per statement).
    expect(counts.serverInstanceRefs).toEqual([{ db_system: "postgresql", db_instance: null }]);
    expect(counts.databaseCount).toBe(1);
  });

  it("folds every named source onto one identity list", async () => {
    service.getBadges.mockResolvedValueOnce({
      data: {
        databases: { hits: [] },
        queries: { total: 0, hits: [] },
        activity: {
          by_state: [],
          hits: [{ db_system: "postgresql", db_instance: "pg-1" }],
        },
        deadlocks: null,
        blocking: { hits: [{ db_system: "postgresql", db_instance: "PG-1:5432" }] },
        table_health: null,
        server_queries: {
          // Engine-only rows collapse into the named pg-1 evidence.
          hits: [{ db_system: "postgresql", db_instance: null }],
          truncated: false,
        },
        server_samples: { hits: [{ db_system: "mysql", db_instance: "my-1" }], truncated: false },
      },
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.serverInstanceRefs).toHaveLength(2);
    expect(counts.databaseCount).toBe(2);
  });

  it("still derives refs outside the fallback, for the Overview union", async () => {
    // A traced org: databases answered, so the fallback never fires — but the
    // Overview still unions the server-known instances into its fleet.
    service.getBadges.mockResolvedValueOnce({
      data: {
        databases: { hits: [{ db_system: "postgresql", db_instance: "pg-1" }] },
        queries: { total: 3, hits: [] },
        activity: { by_state: [], hits: [{ db_system: "mysql", db_instance: "my-1" }] },
        deadlocks: null,
        blocking: null,
        table_health: null,
      },
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.serverInstanceRefs).toEqual([{ db_system: "mysql", db_instance: "my-1" }]);
    // The client vantage answered 1; the fallback must not override it.
    expect(counts.databaseCount).toBe(1);
  });
});

describe("one dead slice must not blank a badge the last window answered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDbmTabCounts();
    clearDbmFleetInstances();
  });

  it("carries the previous count for a slice that came back null", async () => {
    service.getBadges.mockResolvedValueOnce({ data: envelope() });
    const { counts, load } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW);
    expect(badgeCount(counts.value.tableHealthCount)).toBe("8");
    expect(badgeCount(counts.value.deadlockCount)).toBe("100+");

    // Same org, next window: table health's read failed, everything else answered.
    const degraded = { ...envelope(), table_health: null };
    service.getBadges.mockResolvedValueOnce({ data: degraded });
    await load("acme", OTHER_RANGE, WINDOW);

    expect(
      badgeCount(counts.value.tableHealthCount),
      "a single failed slice must not blank a badge we counted a moment ago",
    ).toBe("8");
    // The slices that DID answer are the new window's numbers, not the old ones.
    expect(badgeCount(counts.value.queryCount)).toBe("50+");
  });

  it("does not invent a count for a slice that has never answered", async () => {
    const neverAnswered = { ...envelope(), table_health: null };
    service.getBadges.mockResolvedValueOnce({ data: neverAnswered });
    const { counts, load } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW);

    expect(badgeCount(counts.value.tableHealthCount)).toBeNull();
  });

  it("lets a genuine zero replace a previous non-zero", async () => {
    service.getBadges.mockResolvedValueOnce({ data: envelope() });
    const { counts, load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW);
    expect(badgeCount(counts.value.tableHealthCount)).toBe("8");

    // A real, measured zero is an ANSWER and must win — this is not a failure.
    service.getBadges.mockResolvedValueOnce({
      data: { ...envelope(), table_health: { total: 0 } },
    });
    await load("acme", OTHER_RANGE, WINDOW);

    expect(badgeCount(counts.value.tableHealthCount)).toBe("0");
  });
});

describe("what one page learns is visible from every tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDbmTabCounts();
    clearDbmFleetInstances();
  });

  it("publishes a page's own refined count into the shared snapshot", async () => {
    service.getBadges.mockResolvedValue({ data: envelope() });
    const { counts, load, publishOwnCount } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { system: "postgresql" });
    // The shell's own databases slice is empty on a zero-trace org, so the
    // fallback names the instances the rows in hand mention — one, here.
    expect(claimedCount(counts.value.databaseCount)).toBe(1);

    // Overview loads and learns the EXACT fleet count from its metrics union.
    publishOwnCount("databaseCount", 6);

    expect(
      badgeCount(counts.value.databaseCount),
      "every tab must now read Overview's better number",
    ).toBe("6");
  });

  it("drops published counts when the window moves", async () => {
    service.getBadges.mockResolvedValue({ data: envelope() });
    const { counts, load, publishOwnCount } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { system: "postgresql" });
    publishOwnCount("databaseCount", 6);
    expect(badgeCount(counts.value.databaseCount)).toBe("6");

    // A different window is a different question — a count learned about the
    // last one must not be painted beside the new one's table.
    await load("acme", OTHER_RANGE, WINDOW, { system: "postgresql" });

    expect(
      badgeCount(counts.value.databaseCount),
      "a stale published count must not survive a window change",
    ).toBe("1");
  });

  it("treats an empty breakdown beside total:0 as a MEASURED zero, not an unknown", async () => {
    // THE REPORTED BUG, at its source. Scoping Activity to `mssql-prod-1` —
    // an engine with no session sampler at all — returns
    // `{ by_state: [], total: 0 }`. Folding that to `null` meant "we could not
    // count", so `carryForward` preserved the PREVIOUS scope's number and the
    // badge read 493 beside a table correctly showing no sessions.
    //
    // `total` is still never the COUNT (it is row-limited and would render a
    // cap as the population) — only the witness that the slice was read.
    service.getBadges.mockResolvedValueOnce({
      data: { ...envelope(), activity: { by_state: [], total: 0, hits: [] } },
    });
    const { counts, load } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { instance: "mssql-prod-1" });

    expect(
      badgeCount(counts.value.activityCount),
      "an engine with no session feed must read 0, not inherit another scope's count",
    ).toBe("0");
  });

  it("still reports an unknown when the breakdown is empty and no total was given", async () => {
    // The complement, so the fix above cannot quietly turn every failed read
    // into a confident zero: with no `total` there is no witness that anything
    // was measured, and `null` remains the honest answer.
    service.getBadges.mockResolvedValueOnce({
      data: { ...envelope(), activity: { by_state: [], hits: [] } },
    });
    const { counts, load } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { instance: "mssql-prod-1" });

    expect(
      counts.value.activityCount,
      "an unmeasured slice must not claim zero",
    ).toBeNull();
  });

  it("drops published counts when the SCOPE moves, not only the window", async () => {
    // THE REPORTED BUG. Filtering to an instance re-fetched the strip
    // correctly, and the previous scope's page-published number was then
    // painted back over the fresh answer: an Activity badge reading 466
    // beside a table showing "0 sessions", where the API returned 0 for that
    // scope. The window never moved — only the filter — so the existing
    // window-change guard never fired.
    // The second fan-out returns `null` for activity — a slice that could not
    // be counted under the new scope. This is the case that EXPOSES the bug:
    // when the fresh envelope carries a number it simply overwrites the stale
    // one, so only a `null` lets a stale override survive into the render.
    // (Live, this is what an errored or withheld slice looks like.)
    service.getBadges
      .mockResolvedValueOnce({ data: envelope() })
      .mockResolvedValueOnce({ data: { ...envelope(), activity: null } });
    const { counts, load, publishOwnCount } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { system: "postgresql" });
    publishOwnCount("activityCount", 466);
    expect(badgeCount(counts.value.activityCount)).toBe("466");

    // Same org, same window — a narrower SCOPE. A different question.
    await load("acme", RANGE, WINDOW, { system: "postgresql", instance: "mssql-prod-1" });

    expect(
      badgeCount(counts.value.activityCount),
      "a count measured under the previous scope must not survive a filter change",
    ).not.toBe("466");
  });

  it("lets a page republish after a scope change, so the badge is not stuck blank", async () => {
    // The invalidation must not be a one-way door: once the page reloads under
    // the new scope it measures again, and that number is the right one to
    // show. A guard that permanently ignored page counts would trade a stale
    // badge for a blank one.
    service.getBadges
      .mockResolvedValueOnce({ data: envelope() })
      .mockResolvedValueOnce({ data: { ...envelope(), activity: null } });
    const { counts, load, publishOwnCount } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW, { system: "postgresql" });
    publishOwnCount("activityCount", 466);
    await load("acme", RANGE, WINDOW, { system: "postgresql", instance: "mssql-prod-1" });

    publishOwnCount("activityCount", 0);
    expect(
      badgeCount(counts.value.activityCount),
      "the page's fresh measurement under the new scope must be painted",
    ).toBe("0");
  });

  it("ignores a published count of undefined (the page has no better number)", async () => {
    service.getBadges.mockResolvedValue({ data: envelope() });
    const { counts, load, publishOwnCount } = useDbmTabCounts();

    await load("acme", RANGE, WINDOW);
    publishOwnCount("queryCount", undefined);

    expect(badgeCount(counts.value.queryCount)).toBe("50+");
  });
});

/**
 * A page that refines a badge must PUBLISH it.
 *
 * Not a taste rule. A refined count substituted into a page's own copy of the
 * snapshot is visible only while the reader stands on that page, which is the
 * whole reported bug — and the failure is silent, because the page still
 * renders its own badge correctly and nothing type-checks the omission. This
 * scan is the only thing that can see a page dropping its `ownCounts` while
 * keeping the ref that fed it (which is exactly how BlockedQueriesPage lost
 * its badge mid-refactor).
 */
describe("every page that refines a badge publishes it to the shared snapshot", () => {
  const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "../../views/DatabaseMonitoring");
  const read = (file: string) => readFileSync(join(viewsDir, file), "utf8");

  /** page file → the badge it counts better than the shared fan-out can. */
  const REFINERS: readonly [string, string][] = [
    ["DatabasesPage.vue", "databaseCount"],
    ["QueriesPage.vue", "queryCount"],
    ["SamplesPage.vue", "sampleCallsCount"],
    ["ActivityPage.vue", "activityCount"],
    ["DeadlocksPage.vue", "deadlockCount"],
    ["BlockedQueriesPage.vue", "blockedCount"],
    ["TableHealthPage.vue", "tableHealthCount"],
  ];

  it.each(REFINERS)("%s publishes %s", (file, key) => {
    const source = read(file);
    expect(source, `${file} must declare ownCounts`).toContain("ownCounts:");
    expect(source, `${file} must publish ${key}`).toContain(`key: "${key}"`);
  });

  /**
   * The counterpart: no page may go back to substituting its badge into its
   * own copy, which is the shape that hid the number from every sibling tab.
   */
  it.each(REFINERS.map(([file]) => file))("%s does not re-substitute via withOwnCount", (file) => {
    expect(read(file)).not.toContain("withOwnCount(");
  });
});

/**
 * The publish hook must not read the page's getters during SETUP.
 *
 * Every page calls `useDbmListPage` inside the `const { … } = useDbmListPage({…})`
 * whose destructuring binds `loading`, so an `immediate` watch on an
 * `ownCounts` getter runs while `loading` is still in its temporal dead zone:
 * `Cannot access 'loading' before initialization`, thrown from the page's own
 * `value()`. The first read is deferred to `onMounted` for exactly that reason,
 * and this pins it — the getter here reproduces the TDZ the real pages have.
 */
describe("publishing must not evaluate a page's getters during setup", () => {
  it("defers the first read past the destructuring that binds them", async () => {
    const { mount } = await import("@vue/test-utils");
    const { defineComponent, h } = await import("vue");
    const { createRouter, createMemoryHistory } = await import("vue-router");
    const { useDbmListPage } = await import("@/composables/dbm/useDbmListPage");

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", name: "dbmDatabases", component: { render: () => null } }],
    });
    router.push("/");
    await router.isReady();

    const page = defineComponent({
      setup() {
        // Mirrors every DBM page: the getter closes over a binding that this
        // very statement is still in the middle of creating.
        const { loading } = useDbmListPage({
          load: () => {},
          ownCounts: [{ key: "databaseCount", value: () => (loading.value ? undefined : 7) }],
        });
        return () => h("div", String(loading.value));
      },
    });

    expect(() => mount(page, { global: { plugins: [router] } })).not.toThrow();
  });
});

/**
 * The SHELL must provide every member of the context, not just the ones it
 * happened to need first.
 *
 * `provideDbmTabCounts({ counts, refresh })` compiled fine while the pages
 * called `publishOwnCount` — `vue-tsc` does not type-check SFC script bodies
 * under this project's config, so a missing required member of the provided
 * object reaches the browser as `publishOwnCount is not a function`, thrown
 * from every page's watcher. The inject fallback cannot help: it applies only
 * when NO provider exists, and here one does — just an incomplete one.
 *
 * So this asserts the wiring directly, on the real composable's real return.
 */
describe("the shell provides the whole tab-counts context", () => {
  it("exposes every member the context type requires", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../views/DatabaseMonitoring/DbmShell.vue"),
      "utf8",
    );
    // Whatever the shell destructures from the composable must reach the
    // provide call — the two lists are the wiring, and a member in one and not
    // the other is exactly the defect above.
    expect(source).toContain("provideDbmTabCounts({ counts, refresh, publishOwnCount })");
  });

  it("returns a callable publishOwnCount from the composable itself", () => {
    const source = useDbmTabCounts();
    expect(typeof source.publishOwnCount, "publishOwnCount must be callable").toBe("function");
    expect(typeof source.load).toBe("function");
    expect(source.counts).toBeDefined();
  });
});

/**
 * A page must not publish a count it has not measured.
 *
 * Deadlocks and Blocked queries hold `ref(0)` before their first load, and
 * Table health's count is `null` until its rows arrive. Under keep-alive those
 * pages mount on first visit and publish that pre-load value straight over the
 * shell's real number — so standing on Slowest calls showed `Deadlocks 0`,
 * `Blocked queries 0` and a blank Table health, while the same window on
 * another tab showed `96+`, `100+` and `8`. The strip disagreed with itself
 * depending on which tabs had been opened.
 *
 * `publishOwnCount` cannot tell a measured `0` from an initial one — only the
 * page knows — so the guard is the page withholding until it has loaded.
 */
describe("a page withholds its badge until it has actually loaded", () => {
  const viewsDir = join(dirname(fileURLToPath(import.meta.url)), "../../views/DatabaseMonitoring");
  const read = (file: string) => readFileSync(join(viewsDir, file), "utf8");

  /** page → the ref whose pre-load value must never reach the strip. */
  const PAGES = [
    ["DeadlocksPage.vue", "deadlockCount"],
    ["BlockedQueriesPage.vue", "blockedCount"],
    ["TableHealthPage.vue", "tableHealthCount"],
  ] as const;

  it.each(PAGES)("%s gates its published %s on having loaded", (file, key) => {
    const source = read(file);
    const at = source.indexOf(`key: "${key}"`);
    expect(at, `${file} must publish ${key}`).toBeGreaterThan(-1);
    const entry = source.slice(at, source.indexOf("}", at));
    // `undefined` is the "no better number yet" signal the shared snapshot
    // defers to; a bare ref would publish its initial value instead.
    expect(
      entry,
      `${file} publishes ${key} unconditionally — a pre-load 0 will overwrite the shell's count`,
    ).toContain("undefined");
  });
});

/**
 * The strip must FETCH under the reader's whole scope, not just its engine.
 *
 * The shell forwarded `system` alone, and keyed its cache on `system` alone,
 * so four of the five filters could not reach the badges at all — a URL
 * carrying `instance=postgres` produced the same numbers as one without it.
 * Measured live, `/server_samples` narrows from 73 rows to 0 under that
 * instance, so the Slowest-calls badge was reporting a population its own tab
 * had already excluded.
 *
 * Keying matters as much as sending: a cache keyed on less than it sends would
 * serve the first scope's answer to every later one.
 */
describe("the badge fan-out is scoped by every filter the reader set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDbmTabCounts();
    clearDbmFleetInstances();
    service.getBadges.mockResolvedValue({ data: envelope() });
  });

  const SCOPE = {
    system: "postgresql",
    instance: "postgres",
    namespace: "public",
    env: "prod",
    service: "checkout",
  } as const;

  it("sends every dimension to /badges", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW, SCOPE);

    expect(service.getBadges).toHaveBeenCalledTimes(1);
    const [, params] = service.getBadges.mock.calls[0];
    for (const [key, value] of Object.entries(SCOPE)) {
      expect(params[key], `${key} must reach the badges request`).toBe(value);
    }
  });

  it("omits a dimension the reader did not set", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW, { system: "postgresql" });

    const [, params] = service.getBadges.mock.calls[0];
    expect(params.system).toBe("postgresql");
    expect(params.instance, "an unset filter must not be sent").toBeUndefined();
  });

  it("refetches when a NON-system dimension changes", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW, { system: "postgresql", instance: "postgres" });
    await load("acme", RANGE, WINDOW, { system: "postgresql", instance: "replica" });

    expect(
      service.getBadges,
      "a cache keyed only on system would serve the first instance's answer",
    ).toHaveBeenCalledTimes(2);
  });

  it("still serves the cache when the whole scope is unchanged", async () => {
    const { load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW, SCOPE);
    await load("acme", RANGE, WINDOW, SCOPE);

    expect(service.getBadges, "an unchanged tab switch must not refetch").toHaveBeenCalledTimes(1);
  });
});

/**
 * A capped read renders as a FLOOR, not a population.
 *
 * `/table_health` caps its rows and now discloses it, like the deadlocks and
 * blocking reads always did. The fold took `total` as a bare number, so a
 * fleet with 400 relations printed a stable `100` — a ceiling shown as a
 * total, and a stably wrong one: it reads the same today and tomorrow while
 * the real number moves, which looks like a measurement that is not changing
 * rather than one that is not being taken.
 */
describe("a capped table-health read is a claim, not a total", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDbmTabCounts();
    clearDbmFleetInstances();
  });

  it("renders a truncated count with the + disclosure", async () => {
    service.getBadges.mockResolvedValueOnce({
      data: { ...envelope(), table_health: { total: 100, truncated: true } },
    });
    const { counts, load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW);

    expect(badgeCount(counts.value.tableHealthCount)).toBe("100+");
  });

  it("renders an uncapped count plainly", async () => {
    service.getBadges.mockResolvedValueOnce({
      data: { ...envelope(), table_health: { total: 8, truncated: false } },
    });
    const { counts, load } = useDbmTabCounts();
    await load("acme", RANGE, WINDOW);

    expect(badgeCount(counts.value.tableHealthCount)).toBe("8");
  });
});

/**
 * TableHealthPage must not undo the disclosure it just received.
 *
 * The page publishes its own count into the shared snapshot, so a bare
 * `hits.length` there overwrites the shell's claim with the same undisclosed
 * cap — and its table told OTable the count was exact while every sibling
 * passes `:total-count-exact="!truncated"`.
 */
describe("TableHealthPage carries the cap through", () => {
  const src = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../views/DatabaseMonitoring/TableHealthPage.vue",
    ),
    "utf8",
  );

  it("records whether its own read was capped", () => {
    expect(src, "the page must read the API's truncated flag").toMatch(
      /truncated\.value = Boolean\(data\.truncated\)/,
    );
  });

  it("publishes its count as a claim that can render 100+", () => {
    expect(src).toContain("countClaim(");
  });

  it("tells the table the count is a floor when the read was capped", () => {
    expect(src).toContain(':total-count-exact="!truncated"');
  });
});
