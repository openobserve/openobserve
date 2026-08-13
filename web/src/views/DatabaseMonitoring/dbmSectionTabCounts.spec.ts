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
 * The L2 tab bar states how much is happening in EVERY view, from whichever
 * view you are standing in.
 *
 * This suite used to read the pages' SOURCE, because each page built its
 * own badge fan-out and the only thing they shared was a convention. They now
 * share an implementation — `DbmShell` issues ONE `/badges` request and the
 * pages render the snapshot — so the same requirements are asserted by CALLING
 * it, which is both stronger and no longer coupled to how any page spells its
 * variables. The envelope's members are the six endpoints' own bodies (`null`
 * for a failed slice), so the fold here exercises exactly what the server
 * returns.
 *
 * What survives here as a source scan is only the property no unit test can
 * see: that a page does not fan out BEHIND the shell's back.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { badgeCount } from "@/utils/dbm/format";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

vi.mock("@/services/db_monitoring", () => ({
  default: {
    // The strip's one request.
    getBadges: vi.fn(),
    // The composable must never reach these itself anymore — the per-endpoint
    // reads and the zero-trace fallback pair both moved server-side. Mocked so
    // a regression calls a spy (asserted never-called below) instead of the
    // network.
    getDatabases: vi.fn(),
    getQueries: vi.fn(),
    getActivity: vi.fn(),
    getDeadlocks: vi.fn(),
    getBlocking: vi.fn(),
    getTableHealth: vi.fn(),
    getServerQueries: vi.fn(),
    getServerSamples: vi.fn(),
  },
}));

const { default: dbMonitoringService } = await import("@/services/db_monitoring");
const { fetchDbmTabCounts, tabCountProps, withOwnCount, emptyDbmTabCounts } =
  await import("@/composables/dbm/useDbmTabCounts");

const service = dbMonitoringService as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** A fulfilled response, in the shape axios hands back. */
const ok = (data: unknown) => Promise.resolve({ data });

/**
 * A fully-answered `/badges` envelope: every member is its endpoint's body,
 * no fallback member (the client vantage answered), so a test can override
 * only what it cares about.
 */
const fullEnvelope = () => ({
  // One row deliberately carries no `calls` — legal per the response contract
  // (an idle instance's row omits it); the fold treats it as 0.
  databases: { hits: [{ calls: 800 }, { calls: 400 }, {}] },
  queries: { total: 42 },
  activity: { by_state: [{ state: "active", sessions: 7 }], hits: [{ session_pid: 1 }] },
  deadlocks: { total: 90, truncated: true },
  blocking: { total: 100, truncated: true, hits: [{ pid: 5 }] },
  table_health: { total: 12 },
});

const badgesAnswer = (envelope: unknown) => service.getBadges.mockReturnValue(ok(envelope));

const WINDOW = { startTime: 1_000, endTime: 2_000 };

describe("the one badges request answers every tab's badge at once", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    badgesAnswer(fullEnvelope());
  });

  /**
   * The whole point of the server-side fan-in: the strip costs ONE request
   * per window. The six-read fan-out (and its up-to-two fallback reads) is
   * the server's concurrency now, not the browser's.
   */
  it("issues exactly one request", async () => {
    await fetchDbmTabCounts("acme", WINDOW);
    expect(service.getBadges).toHaveBeenCalledTimes(1);
    for (const [name, fn] of Object.entries(service)) {
      if (name === "getBadges") continue;
      expect(fn, `${name} must not be read by the strip anymore`).not.toHaveBeenCalled();
    }
  });

  /** One request, and every one of the seven badges comes out of it populated. */
  it("fills all seven badges from that one request", async () => {
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(tabCountProps(counts)).toEqual({
      databaseCount: 3,
      queryCount: 42,
      sampleCallsCount: 1200,
      activityCount: 7,
      deadlockCount: { count: 90, complete: false },
      blockedCount: { count: 100, complete: false },
      tableHealthCount: 12,
    });
  });

  /**
   * The badge means SESSIONS in the window, which is what the state breakdown
   * counts. `hits`/`total` on the activity member is a row-limited sample, so
   * sourcing the badge from it would render a constant cap as the population.
   *
   * This also pins a bug the consolidation fixed: TableHealthPage used to pass
   * the whole activity RESPONSE to `activitySampleTotal`, which expects the
   * `by_state` array. An object has no `.length`, so that badge silently
   * resolved to `null` on every load and had never once rendered a number.
   */
  it("sources the activity badge from the state breakdown, not from hits", async () => {
    badgesAnswer({
      ...fullEnvelope(),
      activity: {
        total: 100,
        by_state: [
          { state: "active", sessions: 5 },
          { state: "idle", sessions: 6 },
        ],
        hits: [{}, {}],
      },
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.activityCount).toBe(11);
  });

  /**
   * **A capped read may not reach the badge as a bare total.**
   *
   * Measured against a live backend: /deadlocks returned total 90 with
   * truncated true for a window holding at least 814 events, and /blocking 100
   * for 426. Both are CEILINGS rendered as populations, and both stay still
   * across windows in which the real number moves — the badge looks like a
   * measurement that is not changing rather than one that is not being taken.
   *
   * So the claim carries the server's flag and the badge prints `90+`. The
   * arithmetic is unit-tested in format.spec.ts; what is pinned here is that
   * the flag survives the fold into the shared snapshot.
   */
  it("carries the server's cap into the capped badges", async () => {
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(badgeCount(counts.deadlockCount)).toBe("90+");
    expect(badgeCount(counts.blockedCount)).toBe("100+");
  });

  it("drops the cap marker when the server says the read was complete", async () => {
    badgesAnswer({ ...fullEnvelope(), deadlocks: { total: 7, truncated: false } });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(badgeCount(counts.deadlockCount)).toBe("7");
  });
});

describe("the zero-trace fallback counts what the tabs actually show", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    badgesAnswer(fullEnvelope());
  });

  /**
   * With no traced traffic, Top queries and Slowest calls render
   * database-reported lists — so the strip must count those, as capped
   * claims, on EVERY tab from the first paint. A shared `0` above rendered
   * rows denies working data; a badge that only corrects after the page's own
   * read lands flashes wrong and disagrees across tabs. The SERVER arms the
   * fallback (exact zero, never a failed slice) and ships the members in the
   * same envelope; the fold here turns them into the same capped claims the
   * fallback pages put on their own badges.
   */
  it("fills the query and samples badges from the database-reported lists", async () => {
    badgesAnswer({
      ...fullEnvelope(),
      queries: { total: 0 },
      databases: { hits: [] },
      server_queries: {
        hits: [{ db_system: "postgresql", db_instance: "postgres" }],
        truncated: true,
      },
      server_samples: {
        hits: [
          { db_system: "postgresql", db_instance: "postgres" },
          { db_system: "mysql", db_instance: "mysql" },
        ],
        truncated: false,
      },
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(badgeCount(counts.queryCount)).toBe("1+");
    expect(badgeCount(counts.sampleCallsCount)).toBe("2");
    // Overview: distinct instances the server vantage NAMES — identity only,
    // from rows already in hand.
    expect(counts.databaseCount).toBe(2);
  });

  /**
   * With client answers in hand the server sends no fallback members, and the
   * strip must neither invent them nor fetch them itself — the fallback reads
   * moved server-side, and a second client-side pass would be the request
   * storm this endpoint exists to remove.
   */
  it("keeps the client answers when no fallback member is present", async () => {
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.queryCount).toBe(42);
    expect(counts.sampleCallsCount).toBe(1200);
    expect(service.getServerQueries).not.toHaveBeenCalled();
    expect(service.getServerSamples).not.toHaveBeenCalled();
  });

  /**
   * `null` is a FAILED read, and unknown is not zero — a fallback fired on a
   * failure would dress an outage as a quiet org with server data. The server
   * enforces this (a null slice ships no fallback member); the fold must obey
   * the envelope rather than re-deciding.
   */
  it("does not fire the fallback for a failed client read", async () => {
    badgesAnswer({ ...fullEnvelope(), queries: null });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.queryCount).toBeNull();
    expect(service.getServerQueries).not.toHaveBeenCalled();
  });

  /**
   * A fallback that FIRED and then FAILED arrives as a null member — present,
   * unknown. The honest client zero stands; a null member must never be read
   * as rows.
   */
  it("keeps the client zero when a fired fallback member is null", async () => {
    badgesAnswer({
      ...fullEnvelope(),
      queries: { total: 0 },
      server_queries: null,
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.queryCount).toBe(0);
  });

  /** An org with nothing anywhere keeps its honest zeros. */
  it("keeps the client zeros when the databases report nothing either", async () => {
    badgesAnswer({
      ...fullEnvelope(),
      queries: { total: 0 },
      databases: { hits: [] },
      server_queries: { hits: [], truncated: false },
      server_samples: { hits: [], truncated: false },
    });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.queryCount).toBe(0);
    expect(counts.sampleCallsCount).toBe(0);
    expect(counts.databaseCount).toBe(0);
  });
});

describe("a failed slice blanks its own badge and nothing else", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    badgesAnswer(fullEnvelope());
  });

  /**
   * `null` is bare; `0` is a measurement. A failed read has measured nothing,
   * and printing `0` for it claims "there are none" — the one wrong answer that
   * stops a reader opening the tab during an incident. The envelope carries
   * the failure as a null member, and the fold must keep it null.
   */
  it.each([
    ["databases", "databaseCount"],
    // The samples badge folds the SAME databases member, so the same
    // failure blanks it too — an honest blank, not a 0-call claim.
    ["databases", "sampleCallsCount"],
    ["queries", "queryCount"],
    ["activity", "activityCount"],
    ["deadlocks", "deadlockCount"],
    ["blocking", "blockedCount"],
    ["table_health", "tableHealthCount"],
  ])("a null %s member leaves %s null, never 0", async (member, badge) => {
    badgesAnswer({ ...fullEnvelope(), [member]: null });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts[badge as keyof typeof counts]).toBeNull();
    expect(badgeCount(counts[badge as keyof typeof counts] as never)).toBeNull();
  });

  /** One dead slice must not abandon the others — per-member isolation. */
  it("still answers the other badges", async () => {
    badgesAnswer({ ...fullEnvelope(), activity: null });
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.activityCount).toBeNull();
    expect(counts.databaseCount).toBe(3);
    expect(counts.queryCount).toBe(42);
    expect(counts.tableHealthCount).toBe(12);
  });

  /**
   * THE REGRESSION TEST for `samples is not iterable`.
   *
   * The predecessor cache was keyed per page because the pages built
   * DIVERGENT payload shapes: only Table health carried `blockingSamples`. A
   * shared key therefore let whichever page loaded first decide what the others
   * got, and landing on Deadlocks then switching to Table health handed it a
   * payload with no `blockingSamples` — `chainsFromSamples` threw out of a Vue
   * computed.
   *
   * The snapshot has ONE shape with every key always present, so that is now
   * unrepresentable. Asserted on the failure paths specifically — every member
   * null, and the whole request rejected — because those are the paths that
   * used to produce the missing field.
   */
  it.each(["activityStates", "sessions", "blockingSamples"] as const)(
    "%s is an array even when every member is null",
    async (key) => {
      badgesAnswer({
        databases: null,
        queries: null,
        activity: null,
        deadlocks: null,
        blocking: null,
        table_health: null,
      });
      const counts = await fetchDbmTabCounts("acme", WINDOW);
      expect(Array.isArray(counts[key]), `${key} must never be undefined`).toBe(true);
      expect(counts[key]).toEqual([]);
    },
  );

  /** A total request failure is every-member-lost: all nulls, all `[]`. */
  it("folds a rejected request to the empty snapshot", async () => {
    service.getBadges.mockRejectedValue(new Error("boom"));
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts).toEqual(emptyDbmTabCounts());
  });

  /** The same guarantee before anything has been fetched at all. */
  it.each(["activityStates", "sessions", "blockingSamples"] as const)(
    "%s is an array on the pre-fetch snapshot",
    (key) => {
      expect(Array.isArray(emptyDbmTabCounts()[key])).toBe(true);
    },
  );

  /**
   * The array payloads are PROJECTIONS of the same members the counts came
   * from — Table health's two rules read the activity and blocking samples — so
   * they must be served from this snapshot rather than refetched. A second read
   * over the same window could disagree with the badge sitting beside it.
   */
  it("serves the rule inputs from the same responses as the counts", async () => {
    const counts = await fetchDbmTabCounts("acme", WINDOW);
    expect(counts.sessions).toEqual([{ session_pid: 1 }]);
    expect(counts.blockingSamples).toEqual([{ pid: 5 }]);
    expect(service.getBadges).toHaveBeenCalledTimes(1);
  });
});

describe("the active tab still overrides its own badge", () => {
  /**
   * Each page counts its own tab from the rows it actually loaded, which is
   * fresher than the shared fan-out's number and can differ from it
   * legitimately — the page applies its own filters. That behaviour predates
   * the hoist and must survive it: the shell supplies the sibling badges, the
   * page supplies its own.
   */
  it("takes the page's own count in place of the shared one", () => {
    const shared = { ...emptyDbmTabCounts(), activityCount: 500 };
    expect(tabCountProps(withOwnCount(shared, "activityCount", 3)).activityCount).toBe(3);
  });

  /** The other badges are untouched by an override. */
  it("leaves the badges it did not override alone", () => {
    const shared = { ...emptyDbmTabCounts(), activityCount: 500, queryCount: 9 };
    expect(tabCountProps(withOwnCount(shared, "activityCount", 3)).queryCount).toBe(9);
  });

  /**
   * `undefined` means "I have no better number" and the shared one stands;
   * `null` is a real "unknown" the page is asserting, so it wins and blanks the
   * badge. Conflating them would let a page that has not loaded yet silently
   * publish a zero-ish blank over a number the shell already has.
   */
  it("keeps the shared count when the page offers undefined", () => {
    const shared = { ...emptyDbmTabCounts(), activityCount: 500 };
    expect(tabCountProps(withOwnCount(shared, "activityCount", undefined)).activityCount).toBe(500);
  });

  it("lets a page assert null over a shared number", () => {
    const shared = { ...emptyDbmTabCounts(), activityCount: 500 };
    expect(tabCountProps(withOwnCount(shared, "activityCount", null)).activityCount).toBeNull();
  });

  /**
   * DeadlocksPage and BlockedQueriesPage publish BARE NUMBERS where the shared
   * snapshot holds a claim, and have always rendered them without the `+`.
   * Quietly promoting them to claims would be a visible change nobody asked
   * for, so the override accepts either.
   */
  it("accepts a bare number where the shared snapshot holds a claim", () => {
    const shared = { ...emptyDbmTabCounts(), deadlockCount: { count: 90, complete: false } };
    expect(badgeCount(withOwnCount(shared, "deadlockCount", 43).deadlockCount)).toBe("43");
  });
});

/**
 * The one property no unit test can see: that a page does not quietly fan out
 * behind the shell's back.
 *
 * Read off the source, for the reason dbmRequestGuard.spec.ts gives.
 */
describe("no page re-fetches the badges the shell already owns", () => {
  /** Which endpoint each page is legitimately allowed to read for ITS OWN table. */
  const OWN_READ: Record<string, string[]> = {
    "DatabasesPage.vue": ["getDatabases", "getQueries"],
    "QueriesPage.vue": ["getQueries"],
    // Its own table reads `getSamples`, which is not a badge fetch; its badge
    // (the finished-call population) rides the shell's `/databases` read.
    "SamplesPage.vue": [],
    "ActivityPage.vue": ["getActivity"],
    "DeadlocksPage.vue": ["getDeadlocks"],
    "BlockedQueriesPage.vue": ["getBlocking"],
    "TableHealthPage.vue": ["getTableHealth"],
  };

  const BADGE_FETCHES = [
    // The strip's one request — only the shell may issue it. A page calling
    // it directly reintroduces the duplicate fan-out server-side.
    "getBadges",
    "getDatabases",
    "getQueries",
    "getActivity",
    "getDeadlocks",
    "getBlocking",
    "getTableHealth",
  ];

  it.each(Object.keys(OWN_READ))("%s reads only the endpoints its own table needs", (page) => {
    const source = read(page);
    const stray = BADGE_FETCHES.filter(
      (fetcher) =>
        !OWN_READ[page].includes(fetcher) && source.includes(`dbMonitoringService.${fetcher}(`),
    );
    expect(
      stray,
      `${page} still fans out to ${stray.join(", ")} — the shell already fetches ` +
        `those for every tab, so this is the duplicate read the hoist removed`,
    ).toEqual([]);
  });

  /** And every page must actually render the strip it is handed counts for. */
  it.each(Object.keys(OWN_READ))("%s renders the shared tab strip", (page) => {
    expect(read(page)).toMatch(/<DbmSectionTabs\s+v-bind="tabCounts"\s*\/>/);
  });

  /**
   * The refresh button must still reach the badges. The shell watches the URL,
   * which does NOT change on a refresh, so a page that only reloaded its own
   * table would leave the badges stating the pre-refresh numbers.
   */
  it.each(Object.keys(OWN_READ))("%s forces the shared counts on refresh", (page) => {
    expect(
      read(page),
      `${page} never forces the shared badges, so its refresh button leaves them stale`,
    ).toMatch(/tabCountsContext\.refresh\(\{ force: true \}\)/);
  });

  /**
   * Filter changes must reach the URL. The route query is how the shell and
   * the sibling tabs learn the scope, so a dimension filter that only calls
   * `load()` narrows the table while the URL — and everything reading it —
   * still describes the unfiltered question; a reload or a shared link then
   * reopens a different table than the one on screen.
   */
  it.each(["QueriesPage.vue", "SamplesPage.vue", "DatabasesPage.vue"])(
    "%s publishes every dimension-filter change to the URL",
    (page) => {
      const source = read(page);
      const filters = source.split("const dimensionFilters")[1]?.split("\n]);")[0] ?? "";
      expect(filters, "dimensionFilters must exist").not.toBe("");
      const handlers = filters.match(/onChange: \(/g) ?? [];
      expect(handlers.length, "the filter set must carry handlers").toBeGreaterThan(0);
      const synced = filters.match(/syncUrl\(\);\s*\n\s*load\(\);/g) ?? [];
      expect(synced.length, `${page}: every onChange must sync the URL before reloading`).toBe(
        handlers.length,
      );
    },
  );
});

/**
 * The coverage caveat under each open database.
 *
 * `showsShortfall` is unit-tested in breakdownRows.spec.ts; what is pinned here
 * is that the page ASKS it. The defect was never in the arithmetic — the
 * per-row percentages were always distinct — it was that the page gated the
 * caveat on `shortfall !== null` directly, which is true even when nothing was
 * attributed and every row therefore reported the identical 100%.
 */
describe("DatabasesPage gates the coverage caveat on the shared rule", () => {
  const source = read("DatabasesPage.vue");

  it("asks showsShortfall rather than reading shortfall itself", () => {
    expect(source).toContain('from "@/utils/dbm/breakdownRows"');
    expect(source).toMatch(/const hasShortfall[\s\S]{0,400}showsShortfall\(/);
  });

  it("no longer gates the caveat on a bare non-null shortfall", () => {
    expect(source).not.toMatch(/hasShortfall[\s\S]{0,200}breakdown\.shortfall !== null/);
  });

  /** The figure still rides along — a caveat without one is the disclaimer. */
  it("still prints the row's own percentage in the caveat", () => {
    expect(source).toMatch(/shortfallLine[\s\S]{0,300}dbm\.breakdown\.shortfall/);
    expect(source).toMatch(/shortfallLine[\s\S]{0,300}percent:/);
  });
});
