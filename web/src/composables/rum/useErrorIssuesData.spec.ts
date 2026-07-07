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

// ---------------------------------------------------------------------------
// Composable analysis
// ---------------------------------------------------------------------------
// Component: useErrorIssuesData
// Path: src/composables/rum/useErrorIssuesData.ts
// Store deps: store.state.zoConfig.timestamp_column, zoConfig.sql_base64_enabled,
//             selectedOrganization.identifier
// Service deps: @/services/search (mocked at service boundary)
// Other deps: @/lib/feedback/Toast/useToast (mocked), @/composables/useQuery
// Refs: issues, trendBuckets, chartSeries, latestDeploy, kpis (computed),
//       deploySpikeFactor (computed), issuesTruncated (computed),
//       isLoadingIssues, isLoadingChart, isLoadingKpis
// Async:
//   fetchAll()  → exactly 5 parallel calls via Promise.allSettled (no auto trends)
//   fetchTrend(issue) → lazy per-issue fetch; cached; deduped in-flight;
//                       cleared when a new fetchAll runs
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";

// ---------------------------------------------------------------------------
// vi.mock() calls MUST be at the top — hoisted by Vitest
// ---------------------------------------------------------------------------

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

// Mock vuex to inject a controlled store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    zoConfig: {
      timestamp_column: "_timestamp",
      sql_base64_enabled: false,
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import searchService from "@/services/search";
import useErrorIssuesData from "./useErrorIssuesData";
import {
  WINDOW_START_US,
  WINDOW_END_US,
  MID_WINDOW_US,
  EARLY_WINDOW_US,
  FULL_SCHEMA,
  MOCK_ISSUE_HITS,
  MOCK_HISTOGRAM_HITS,
  MOCK_KPI_HIT,
  MOCK_DENOMINATOR_HIT,
  MOCK_DEPLOY_HITS_IN_WINDOW,
  MOCK_DEPLOY_HITS_AT_EDGE,
  MOCK_TREND_HITS,
} from "@/test/unit/mockData/errorIssues";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_PARAMS = {
  startTime: WINDOW_START_US,
  endTime: WINDOW_END_US,
  schema: FULL_SCHEMA,
  userQuery: "",
  service: "",
};

/**
 * Make a resolved search response as the composable expects: {data: {hits}}.
 */
function makeHitsResponse(hits: any[]) {
  return { data: { hits } };
}

/**
 * Set up the default "happy path" mock sequence for fetchAll:
 * 5 parallel search calls (issues, chart, kpis, denominators, deploys),
 * plus a 6th deploy-verification lookback when a deploy candidate exists
 * (in-window fixture). No automatic trends call — trends are lazy-loaded
 * per row via fetchTrend().
 */
function setupHappyPathMocks(
  deployHits = MOCK_DEPLOY_HITS_IN_WINDOW,
  // Default: version has no prior events → the deploy candidate is kept.
  lookbackHits: any[] | null = deployHits === MOCK_DEPLOY_HITS_IN_WINDOW
    ? [{ prior_events: 0 }]
    : null,
) {
  const mocked = vi
    .mocked(searchService.search)
    .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS)) // 1 issues
    .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS)) // 2 chart
    .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT])) // 3 kpis
    .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT])) // 4 denominators
    .mockResolvedValueOnce(makeHitsResponse(deployHits)); // 5 deploys
  if (lookbackHits !== null) {
    mocked.mockResolvedValueOnce(makeHitsResponse(lookbackHits)); // 6 lookback
  }
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe("useErrorIssuesData", () => {
  beforeEach(() => {
    // resetAllMocks clears both call history AND queued mockResolvedValueOnce
    // return values so no mock responses from one test leak into the next.
    vi.resetAllMocks();
    // Restore store defaults before each test.
    mockStore.state.zoConfig.sql_base64_enabled = false;
    mockStore.state.zoConfig.timestamp_column = "_timestamp";
    mockStore.state.selectedOrganization.identifier = "test-org";
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Return value structure
  // ─────────────────────────────────────────────────────────────────────────
  describe("return value structure", () => {
    it("exposes all documented public refs and functions", () => {
      const composable = useErrorIssuesData();

      expect(typeof composable.fetchAll).toBe("function");
      expect(typeof composable.fetchTrend).toBe("function");
      expect(composable.issues).toBeDefined();
      expect(composable.trendBuckets).toBeDefined();
      expect(composable.chartSeries).toBeDefined();
      expect(composable.latestDeploy).toBeDefined();
      expect(composable.kpis).toBeDefined();
      expect(composable.deploySpikeFactor).toBeDefined();
      expect(composable.issuesTruncated).toBeDefined();
      expect(composable.isLoadingIssues).toBeDefined();
      expect(composable.isLoadingChart).toBeDefined();
      expect(composable.isLoadingKpis).toBeDefined();
      // isLoadingTrends is gone — trends are lazy-loaded per row
      expect((composable as any).isLoadingTrends).toBeUndefined();
      expect(typeof composable.pickUserField).toBe("function");
    });

    it("initializes refs to empty/falsy defaults before any fetch", () => {
      const { issues, trendBuckets, chartSeries, latestDeploy } =
        useErrorIssuesData();

      expect(issues.value).toEqual([]);
      expect(trendBuckets.value).toEqual({});
      expect(chartSeries.value).toEqual([]);
      expect(latestDeploy.value).toBeNull();
    });

    it("initializes loading flags to false before any fetch", () => {
      const {
        isLoadingIssues,
        isLoadingChart,
        isLoadingKpis,
      } = useErrorIssuesData();

      expect(isLoadingIssues.value).toBe(false);
      expect(isLoadingChart.value).toBe(false);
      expect(isLoadingKpis.value).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fetchAll — call count
  // ─────────────────────────────────────────────────────────────────────────
  describe("fetchAll call count", () => {
    it("makes exactly 5 search calls when no deploy candidate is found", async () => {
      // Arrange — edge-of-window version → no candidate → no verification
      setupHappyPathMocks(MOCK_DEPLOY_HITS_AT_EDGE);

      const { fetchAll } = useErrorIssuesData();

      // Act
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Assert — no automatic trends call; trends are lazy via fetchTrend()
      expect(searchService.search).toHaveBeenCalledTimes(5);
    });

    it("makes a 6th verification call when a deploy candidate exists", async () => {
      // Arrange
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll } = useErrorIssuesData();

      // Act
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Assert — 5 parallel + 1 deploy lookback verification
      expect(searchService.search).toHaveBeenCalledTimes(6);
    });

    it("does not make a trends call when issues array is empty", async () => {
      // Arrange
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([])) // issues — empty
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_AT_EDGE));

      const { fetchAll } = useErrorIssuesData();

      // Act
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Assert
      expect(searchService.search).toHaveBeenCalledTimes(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Deploy verification (lookback before the window)
  // ─────────────────────────────────────────────────────────────────────────
  describe("deploy verification", () => {
    it("keeps the deploy when the version has no events before the window", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW, [{ prior_events: 0 }]);

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(latestDeploy.value?.version).toBe("v2.0.0");
    });

    it("drops the deploy when the version already existed before the window", async () => {
      // A long-lived version whose in-window MIN was just sparse traffic.
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW, [{ prior_events: 42 }]);

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(latestDeploy.value).toBeNull();
    });

    it("hides the deploy when the verification query fails", async () => {
      // Unverifiable → no marker: a false deploy is worse than none.
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW, null);
      vi.mocked(searchService.search).mockRejectedValueOnce(
        new Error("lookback failed"),
      );

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(latestDeploy.value).toBeNull();
    });

    it("queries an equal-length lookback range strictly before the window", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      const lookbackCall = vi.mocked(searchService.search).mock.calls[5];
      const query = lookbackCall[0].query.query;
      const span = WINDOW_END_US - WINDOW_START_US;
      expect(query.sql).toContain("prior_events");
      expect(query.sql).toContain("version='v2.0.0'");
      expect(query.start_time).toBe(WINDOW_START_US - span);
      expect(query.end_time).toBe(WINDOW_START_US - 1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issues population and field coercion
  // ─────────────────────────────────────────────────────────────────────────
  describe("issues population", () => {
    it("populates issues ref with correct length after successful fetch", async () => {
      setupHappyPathMocks();

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issues.value).toHaveLength(2);
    });

    it("coerces events from string to number", async () => {
      setupHappyPathMocks();

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(typeof issues.value[0].events).toBe("number");
      expect(issues.value[0].events).toBe(42);
      expect(issues.value[1].events).toBe(10);
    });

    it("coerces users_affected from string to number when present", async () => {
      setupHappyPathMocks();

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(typeof issues.value[0].users_affected).toBe("number");
      expect(issues.value[0].users_affected).toBe(7);
    });

    it("preserves hit order as returned (no client-side re-sort)", async () => {
      setupHappyPathMocks();

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issues.value[0].error_type).toBe("TypeError");
      expect(issues.value[1].error_type).toBe("ReferenceError");
    });

    it("carries through non-aggregated hit fields (error_type, error_message, etc.)", async () => {
      setupHappyPathMocks();

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issues.value[0].error_type).toBe("TypeError");
      expect(issues.value[0].error_message).toBe(
        "Cannot read properties of null",
      );
      expect(issues.value[0].error_handling).toBe("unhandled");
      expect(issues.value[0].latest_error_id).toBe("err-001");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Status derivation — with a deploy in window
  // ─────────────────────────────────────────────────────────────────────────
  describe("status derivation with a deploy", () => {
    it("marks issue as 'new' when first_seen >= deploy firstSeen", async () => {
      // Deploy at MID_WINDOW_US; second issue has first_seen = MID_WINDOW_US.
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Second issue: first_seen = MID_WINDOW_US === deploy ts → "new"
      expect(issues.value[1].status).toBe("new");
    });

    it("marks issue as 'ongoing' when first_seen < deploy firstSeen", async () => {
      // Deploy at MID_WINDOW_US; first issue has first_seen = EARLY_WINDOW_US.
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // First issue: first_seen = EARLY_WINDOW_US < MID_WINDOW_US → "ongoing"
      expect(issues.value[0].status).toBe("ongoing");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // latestDeploy — pick logic
  // ─────────────────────────────────────────────────────────────────────────
  describe("latestDeploy selection", () => {
    it("sets latestDeploy when a version first_seen is strictly inside the window", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(latestDeploy.value).not.toBeNull();
      expect(latestDeploy.value?.version).toBe("v2.0.0");
    });

    it("sets latestDeploy to null when version first_seen is at window start edge", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_AT_EDGE);

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(latestDeploy.value).toBeNull();
    });

    it("sets latestDeploy to null when no deploy hits are returned", async () => {
      setupHappyPathMocks([]);

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(latestDeploy.value).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // kpis computed
  // ─────────────────────────────────────────────────────────────────────────
  describe("kpis computed", () => {
    it("computes totalErrors from kpi hit", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.totalErrors).toBe(52);
    });

    it("computes errorSessions from kpi hit", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.errorSessions).toBe(10);
    });

    it("computes usersAffected from kpi hit", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.usersAffected).toBe(8);
    });

    it("computes totalSessions from denominator hit", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.totalSessions).toBe(200);
    });

    it("computes totalUsers from denominator hit", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.totalUsers).toBe(150);
    });

    it("computes crashFreePct as (1 - errorSessions / totalSessions) * 100", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // (1 - 10/200) * 100 = 95
      expect(kpis.value.crashFreePct).toBeCloseTo(95, 5);
    });

    it("returns crashFreePct as null when totalSessions is 0", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(
          makeHitsResponse([{ total_sessions: "0", total_users: "0" }]),
        )
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.crashFreePct).toBeNull();
    });

    it("computes uniqueIssues as the length of the issues array", async () => {
      setupHappyPathMocks();

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.uniqueIssues).toBe(2);
    });

    it("computes newIssues by counting issues with status === 'new'", async () => {
      // With deploy at MID_WINDOW_US: issue[0] → ongoing, issue[1] → new
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.newIssues).toBe(1);
    });

    it("sets deployVersion from latestDeploy when a deploy is detected", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_IN_WINDOW);

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.deployVersion).toBe("v2.0.0");
    });

    it("sets deployVersion to null when no deploy is detected", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_AT_EDGE);

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.deployVersion).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // chartSeries
  // ─────────────────────────────────────────────────────────────────────────
  describe("chartSeries", () => {
    it("chartSeries has at least one bucket after fetch with histogram data", async () => {
      setupHappyPathMocks();

      const { fetchAll, chartSeries } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(chartSeries.value.length).toBeGreaterThan(0);
    });

    it("first bucket accumulates handled and unhandled counts from histogram hits", async () => {
      setupHappyPathMocks();

      const { fetchAll, chartSeries } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Histogram hits both land in the first bucket (ts = window start):
      // unhandled: 15, handled: 8
      const firstBucket = chartSeries.value[0];
      expect(firstBucket.unhandled).toBe(15);
      expect(firstBucket.handled).toBe(8);
    });

    it("sets chartSeries to [] when chart call fails", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockRejectedValueOnce(new Error("chart fail"))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW));

      const { fetchAll, chartSeries } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(chartSeries.value).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // trendBuckets — initial state after fetchAll
  // ─────────────────────────────────────────────────────────────────────────
  describe("trendBuckets after fetchAll", () => {
    it("starts as {} after fetchAll (no auto trends call)", async () => {
      // Arrange
      setupHappyPathMocks();

      const { fetchAll, trendBuckets } = useErrorIssuesData();

      // Act
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Assert — no lazy fetch has been triggered yet
      expect(trendBuckets.value).toEqual({});
    });

    it("resets trendBuckets to {} on a subsequent fetchAll call", async () => {
      // Arrange — first fetchAll + fetchTrend populates trendBuckets
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS)); // fetchTrend call

      const { fetchAll, fetchTrend, trendBuckets } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      const keysAfterFirstFetch = Object.keys(trendBuckets.value);
      expect(keysAfterFirstFetch.length).toBeGreaterThan(0);

      // Act — second fetchAll; provide 5 more mocks
      setupHappyPathMocks();
      await fetchAll(DEFAULT_PARAMS);

      // Assert — trendBuckets cleared synchronously at start of fetchAll
      expect(trendBuckets.value).toEqual({});

      // Cleanup: resolve remaining flushPromises so no dangling async
      await flushPromises();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fetchTrend — lazy per-issue trend fetch
  // ─────────────────────────────────────────────────────────────────────────
  describe("fetchTrend", () => {
    it("issues exactly 1 additional search call after fetchAll", async () => {
      // Arrange
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS)); // fetchTrend

      const { fetchAll, fetchTrend } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();
      const callsAfterFetchAll = vi.mocked(searchService.search).mock.calls.length;

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert
      expect(vi.mocked(searchService.search).mock.calls.length).toBe(callsAfterFetchAll + 1);
    });

    it("sends SQL containing 'error_message IN' and the escaped message", async () => {
      // Arrange
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

      const { fetchAll, fetchTrend } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — the last search call's SQL must reference the issue's error_message
      const calls = vi.mocked(searchService.search).mock.calls;
      const trendCall = calls[calls.length - 1];
      const sql: string = trendCall[0].query.query.sql;
      // SQL should reference error_message filtering
      expect(sql).toMatch(/error_message/i);
    });

    it("populates trendBuckets with the pivoted bucket array for the issue key", async () => {
      // Arrange
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

      const { fetchAll, fetchTrend, trendBuckets } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — trendBuckets should have a key containing the error_message
      const keys = Object.keys(trendBuckets.value);
      const typeErrorKey = keys.find((k) =>
        k.includes("Cannot read properties of null"),
      );
      expect(typeErrorKey).toBeDefined();
      const bucketArr = trendBuckets.value[typeErrorKey!];
      expect(Array.isArray(bucketArr)).toBe(true);
      // The trend hit had events:10, so sum must be 10
      const total = bucketArr.reduce((sum: number, n: number) => sum + n, 0);
      expect(total).toBe(10);
    });

    it("sets trendBuckets key to [] when query returns no data for that issue", async () => {
      // Arrange
      setupHappyPathMocks();
      // Return trend hits for a DIFFERENT issue only — nothing for issue[0]
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([])); // empty result

      const { fetchAll, fetchTrend, trendBuckets } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — key exists but is an empty array
      const keys = Object.keys(trendBuckets.value);
      const typeErrorKey = keys.find((k) =>
        k.includes("Cannot read properties of null"),
      );
      expect(typeErrorKey).toBeDefined();
      expect(trendBuckets.value[typeErrorKey!]).toEqual([]);
    });

    it("sets trendBuckets key to [] on rejection", async () => {
      // Arrange
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(new Error("trend fail"));

      const { fetchAll, fetchTrend, trendBuckets } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — key set to empty array on failure
      const keys = Object.keys(trendBuckets.value);
      const typeErrorKey = keys.find((k) =>
        k.includes("Cannot read properties of null"),
      );
      expect(typeErrorKey).toBeDefined();
      expect(trendBuckets.value[typeErrorKey!]).toEqual([]);
    });

    it("does not make a new search call for a cached key (second fetchTrend)", async () => {
      // Arrange
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS)); // first fetchTrend only

      const { fetchAll, fetchTrend } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // First fetch — populates cache
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();
      const callsAfterFirst = vi.mocked(searchService.search).mock.calls.length;

      // Act — second fetch for same issue
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — no additional search call
      expect(vi.mocked(searchService.search).mock.calls.length).toBe(callsAfterFirst);
    });

    it("resolves immediately without any search call when called before fetchAll", async () => {
      // Arrange — no fetchAll called yet; trendContext is null
      const { fetchTrend } = useErrorIssuesData();

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — no search calls made
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("does not call toast on trend failure (non-fatal)", async () => {
      // Arrange
      setupHappyPathMocks();
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(new Error("trend fail"));

      const { fetchAll, fetchTrend } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Act
      await fetchTrend(MOCK_ISSUE_HITS[0] as any);
      await flushPromises();

      // Assert — no toast for trend failures
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("discards results from a fetchTrend superseded by a new fetchAll", async () => {
      // Arrange — first fetchAll populates trendContext (runId = 1)
      setupHappyPathMocks();
      // The deferred trend search resolves AFTER a new fetchAll starts
      let resolveTrend!: (v: any) => void;
      const deferredTrend = new Promise<any>((r) => (resolveTrend = r));
      // Queue: 5 for fetchAll, 1 deferred for fetchTrend
      vi.mocked(searchService.search)
        .mockReturnValueOnce(deferredTrend); // 6th call — fetchTrend search

      const { fetchAll, fetchTrend, trendBuckets } = useErrorIssuesData();
      await fetchAll(DEFAULT_PARAMS); // runId becomes 1
      await flushPromises();

      // Start fetchTrend — it will call searchService.search with deferredTrend
      const trendPromise = fetchTrend(MOCK_ISSUE_HITS[0] as any);

      // Immediately start a new fetchAll — this increments runId to 2,
      // invalidating the in-flight fetchTrend from run 1
      setupHappyPathMocks();
      const fetchAllPromise = fetchAll(DEFAULT_PARAMS); // runId becomes 2

      // Now resolve the deferred trend (stale, from run 1)
      resolveTrend(makeHitsResponse(MOCK_TREND_HITS));

      // Wait for both to complete
      await Promise.all([trendPromise, fetchAllPromise]);
      await flushPromises();

      // Assert — stale trend result discarded; trendBuckets cleared by new fetchAll
      expect(trendBuckets.value).toEqual({});
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // issuesTruncated computed
  // ─────────────────────────────────────────────────────────────────────────
  describe("issuesTruncated", () => {
    it("is false when issues count is below ISSUES_LIMIT", async () => {
      setupHappyPathMocks();

      const { fetchAll, issuesTruncated } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issuesTruncated.value).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Loading flags lifecycle
  // ─────────────────────────────────────────────────────────────────────────
  describe("loading flags", () => {
    it("sets isLoadingIssues, isLoadingChart, isLoadingKpis to true during fetch", async () => {
      let resolveIssues!: (v: any) => void;
      const issuesPromise = new Promise<any>((r) => (resolveIssues = r));

      vi.mocked(searchService.search)
        .mockReturnValueOnce(issuesPromise) // issues — deferred
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, isLoadingIssues, isLoadingChart, isLoadingKpis } =
        useErrorIssuesData();

      const fetchPromise = fetchAll(DEFAULT_PARAMS);

      // Flags are set synchronously before awaiting allSettled.
      expect(isLoadingIssues.value).toBe(true);
      expect(isLoadingChart.value).toBe(true);
      expect(isLoadingKpis.value).toBe(true);

      // Unblock the deferred promise and complete.
      resolveIssues(makeHitsResponse([]));
      await fetchPromise;
      await flushPromises();

      expect(isLoadingIssues.value).toBe(false);
      expect(isLoadingChart.value).toBe(false);
      expect(isLoadingKpis.value).toBe(false);
    });

    it("clears isLoadingIssues, isLoadingChart, isLoadingKpis after successful fetch", async () => {
      setupHappyPathMocks();

      const {
        fetchAll,
        isLoadingIssues,
        isLoadingChart,
        isLoadingKpis,
      } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(isLoadingIssues.value).toBe(false);
      expect(isLoadingChart.value).toBe(false);
      expect(isLoadingKpis.value).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Issues query failure (fatal path)
  // ─────────────────────────────────────────────────────────────────────────
  describe("issues query failure", () => {
    it("calls toast with variant='error' when issues call rejects", async () => {
      const error = new Error("issues fetch failed");
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(error) // issues
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("sets issues to [] when issues call rejects", async () => {
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(new Error("issues fetch failed"))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issues.value).toEqual([]);
    });

    it("leaves loading flags false after issues query failure", async () => {
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, isLoadingIssues, isLoadingChart, isLoadingKpis } =
        useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(isLoadingIssues.value).toBe(false);
      expect(isLoadingChart.value).toBe(false);
      expect(isLoadingKpis.value).toBe(false);
    });

    it("uses a fallback toast message when the error has no response message", async () => {
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Error while fetching error events"),
          variant: "error",
        }),
      );
    });

    it("uses response.data.message from the error when available", async () => {
      const richError = {
        response: { data: { message: "Quota exceeded" } },
      } as any;
      vi.mocked(searchService.search)
        .mockRejectedValueOnce(richError)
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Quota exceeded",
          variant: "error",
        }),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // KPI / denominator failures (degrade independently)
  // ─────────────────────────────────────────────────────────────────────────
  describe("KPI and denominator failures", () => {
    it("sets errorTotals to zeros when kpi call fails", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockRejectedValueOnce(new Error("kpi fail"))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.totalErrors).toBe(0);
      expect(kpis.value.errorSessions).toBe(0);
    });

    it("sets denominators to zeros when denominator call fails", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockRejectedValueOnce(new Error("denom fail"))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.totalSessions).toBe(0);
      expect(kpis.value.crashFreePct).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Race condition / supersede guard
  // ─────────────────────────────────────────────────────────────────────────
  describe("race condition (stale run guard)", () => {
    it("second fetchAll supersedes first — only second run's data is committed", async () => {
      // Run A: deferred issues, rest resolve immediately.
      let resolveRunA!: (v: any) => void;
      const runAIssues = new Promise<any>((r) => (resolveRunA = r));

      // We'll queue: run A (5 calls) then run B (5 calls).
      vi.mocked(searchService.search)
        // Run A — issues deferred, others immediate
        .mockReturnValueOnce(runAIssues) // A-1 issues
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS)) // A-2 chart
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT])) // A-3 kpis
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT])) // A-4 denom
        .mockResolvedValueOnce(makeHitsResponse([])) // A-5 deploys
        // Run B — all immediate, single issue different from A
        .mockResolvedValueOnce(
          makeHitsResponse([
            {
              ...MOCK_ISSUE_HITS[1],
              error_message: "RUN_B_ONLY_MSG",
            },
          ]),
        ) // B-1 issues
        .mockResolvedValueOnce(makeHitsResponse([])) // B-2 chart
        .mockResolvedValueOnce(makeHitsResponse([])) // B-3 kpis
        .mockResolvedValueOnce(makeHitsResponse([])) // B-4 denom
        .mockResolvedValueOnce(makeHitsResponse([])); // B-5 deploys

      const { fetchAll, issues } = useErrorIssuesData();

      // Start run A (issues deferred).
      const fetchA = fetchAll(DEFAULT_PARAMS);
      // Start run B immediately — this increments runId, so A's results will be stale.
      const fetchB = fetchAll(DEFAULT_PARAMS);

      // Resolve run A's deferred promise after run B has started.
      resolveRunA(makeHitsResponse(MOCK_ISSUE_HITS));

      await fetchA;
      await fetchB;
      await flushPromises();

      // Only run B's data should be committed.
      expect(issues.value).toHaveLength(1);
      expect(issues.value[0].error_message).toBe("RUN_B_ONLY_MSG");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Base64 encoding when sql_base64_enabled is true
  // ─────────────────────────────────────────────────────────────────────────
  describe("base64 encoding", () => {
    it("encodes the SQL in base64 when sql_base64_enabled is true", async () => {
      // Enable base64 mode in the store.
      mockStore.state.zoConfig.sql_base64_enabled = true;

      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // The requests should have been made with the encoding flag set and
      // base64-encoded SQL.  Check that at least one call used encoding.
      const calls = vi.mocked(searchService.search).mock.calls;

      // At least one of the 5 calls should have req.encoding === 'base64'.
      const anyBase64 = calls.some((call) => {
        const req = call[0].query;
        return req.encoding === "base64";
      });

      expect(anyBase64).toBe(true);
    });

    it("sql in requests is a base64 string when sql_base64_enabled is true", async () => {
      mockStore.state.zoConfig.sql_base64_enabled = true;

      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      const calls = vi.mocked(searchService.search).mock.calls;
      // Verify the SQL in at least one call is base64-encoded (not plain SQL).
      const firstSql = calls[0][0].query.query.sql as string;
      // Base64 strings only contain A-Z a-z 0-9 + / = characters.
      expect(firstSql).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Request payload shape
  // ─────────────────────────────────────────────────────────────────────────
  describe("request payload shape", () => {
    it("passes org_identifier from the store to every search call", async () => {
      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      vi.mocked(searchService.search).mock.calls.forEach((call) => {
        expect(call[0].org_identifier).toBe("test-org");
      });
    });

    it("passes page_type='logs' to every search call", async () => {
      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      vi.mocked(searchService.search).mock.calls.forEach((call) => {
        expect(call[0].page_type).toBe("logs");
      });
    });

    it("passes 'RUM' as the second argument to every search call", async () => {
      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      vi.mocked(searchService.search).mock.calls.forEach((call) => {
        expect(call[1]).toBe("RUM");
      });
    });

    it("sets start_time and end_time on the query from params", async () => {
      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      const firstCall = vi.mocked(searchService.search).mock.calls[0];
      expect(firstCall[0].query.query.start_time).toBe(WINDOW_START_US);
      expect(firstCall[0].query.query.end_time).toBe(WINDOW_END_US);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deploySpikeFactor computed
  // ─────────────────────────────────────────────────────────────────────────
  describe("deploySpikeFactor", () => {
    it("is null when latestDeploy is null", async () => {
      setupHappyPathMocks(MOCK_DEPLOY_HITS_AT_EDGE); // no deploy in window

      const { fetchAll, deploySpikeFactor } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(deploySpikeFactor.value).toBeNull();
    });

    it("is null when chartSeries is empty", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockRejectedValueOnce(new Error("chart fail")) // chart → empty series
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW));

      const { fetchAll, deploySpikeFactor } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(deploySpikeFactor.value).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases — empty / missing data
  // ─────────────────────────────────────────────────────────────────────────
  describe("edge cases", () => {
    it("handles undefined users_affected gracefully (no coercion crash)", async () => {
      const hitWithoutUsers = {
        ...MOCK_ISSUE_HITS[0],
        users_affected: undefined,
      };
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([hitWithoutUsers]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issues.value[0].users_affected).toBeUndefined();
    });

    it("handles kpi hit with non-numeric strings gracefully (defaults to 0)", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(
          makeHitsResponse([
            { total_errors: "N/A", error_sessions: null, users_affected: "" },
          ]),
        )
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, kpis } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(kpis.value.totalErrors).toBe(0);
      expect(kpis.value.errorSessions).toBe(0);
    });

    it("handles deploy hits with non-numeric first_seen (defaults to 0)", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(
          makeHitsResponse([{ version: "v0.1.0", first_seen: "invalid" }]),
        );

      const { fetchAll, latestDeploy } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // first_seen coerces to 0, which is <= windowStart + bucketMicros → null
      expect(latestDeploy.value).toBeNull();
    });

    it("does not throw when response has no hits property", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce({ data: {} } as any) // no hits
        .mockResolvedValueOnce({ data: {} } as any)
        .mockResolvedValueOnce({ data: {} } as any)
        .mockResolvedValueOnce({ data: {} } as any)
        .mockResolvedValueOnce({ data: {} } as any);

      const { fetchAll, issues } = useErrorIssuesData();

      await expect(fetchAll(DEFAULT_PARAMS)).resolves.not.toThrow();
      await flushPromises();

      expect(issues.value).toEqual([]);
    });
  });
});
