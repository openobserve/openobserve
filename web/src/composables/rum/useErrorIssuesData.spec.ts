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
//       isLoadingIssues, isLoadingChart, isLoadingKpis, isLoadingTrends
// Async: fetchAll() → 5 parallel calls via Promise.allSettled, then 1 trends call
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
 * Set up the default "happy path" mock sequence:
 * calls 1–5: Promise.allSettled batch (issues, chart, kpis, denominators, deploys)
 * call 6:    trends
 *
 * The order in Promise.allSettled is determined by how runSearch() is called
 * inside fetchAll(), so the mock queue must match that exact order.
 */
function setupHappyPathMocks(deployHits = MOCK_DEPLOY_HITS_IN_WINDOW) {
  vi.mocked(searchService.search)
    .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS)) // 1 issues
    .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS)) // 2 chart
    .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT])) // 3 kpis
    .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT])) // 4 denominators
    .mockResolvedValueOnce(makeHitsResponse(deployHits)) // 5 deploys
    .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS)); // 6 trends
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe("useErrorIssuesData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore store defaults before each test.
    mockStore.state.zoConfig.sql_base64_enabled = false;
    mockStore.state.zoConfig.timestamp_column = "_timestamp";
    mockStore.state.selectedOrganization.identifier = "test-org";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Return value structure
  // ─────────────────────────────────────────────────────────────────────────
  describe("return value structure", () => {
    it("exposes all documented public refs and functions", () => {
      const composable = useErrorIssuesData();

      expect(typeof composable.fetchAll).toBe("function");
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
      expect(composable.isLoadingTrends).toBeDefined();
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
        isLoadingTrends,
      } = useErrorIssuesData();

      expect(isLoadingIssues.value).toBe(false);
      expect(isLoadingChart.value).toBe(false);
      expect(isLoadingKpis.value).toBe(false);
      expect(isLoadingTrends.value).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // fetchAll — call count
  // ─────────────────────────────────────────────────────────────────────────
  describe("fetchAll call count", () => {
    it("makes 6 search calls total (5 parallel + 1 trends) when issues have messages", async () => {
      setupHappyPathMocks();

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(searchService.search).toHaveBeenCalledTimes(6);
    });

    it("makes only 5 calls (no trends) when issues array is empty", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([])) // issues — empty
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW));

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(searchService.search).toHaveBeenCalledTimes(5);
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
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

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
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

      const { fetchAll, chartSeries } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(chartSeries.value).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // trendBuckets
  // ─────────────────────────────────────────────────────────────────────────
  describe("trendBuckets", () => {
    it("populates trendBuckets with entries keyed by issue signature", async () => {
      setupHappyPathMocks();

      const { fetchAll, trendBuckets } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      const keys = Object.keys(trendBuckets.value);
      expect(keys.length).toBeGreaterThan(0);
    });

    it("trend bucket arrays sum to the fixture events count for that issue", async () => {
      setupHappyPathMocks();

      const { fetchAll, trendBuckets } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      // Find the bucket for the TypeError issue.
      const typeErrorKey = Object.keys(trendBuckets.value).find((k) =>
        k.includes("Cannot read properties of null"),
      );
      expect(typeErrorKey).toBeDefined();
      const bucketArr = trendBuckets.value[typeErrorKey!];
      const total = bucketArr.reduce((sum: number, n: number) => sum + n, 0);
      // Trend hit for this issue had events: 10
      expect(total).toBe(10);
    });

    it("stays as {} when issues are empty (no trends call)", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([]));

      const { fetchAll, trendBuckets } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

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

    it("clears all loading flags after successful fetch completes", async () => {
      setupHappyPathMocks();

      const {
        fetchAll,
        isLoadingIssues,
        isLoadingChart,
        isLoadingKpis,
        isLoadingTrends,
      } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(isLoadingIssues.value).toBe(false);
      expect(isLoadingChart.value).toBe(false);
      expect(isLoadingKpis.value).toBe(false);
      expect(isLoadingTrends.value).toBe(false);
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
  // Non-fatal trends failure
  // ─────────────────────────────────────────────────────────────────────────
  describe("trends query failure (non-fatal)", () => {
    it("leaves trendBuckets as {} when trends call rejects", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW))
        .mockRejectedValueOnce(new Error("trends fail")); // 6th call — trends

      const { fetchAll, trendBuckets } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(trendBuckets.value).toEqual({});
    });

    it("leaves issues populated when trends call rejects", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW))
        .mockRejectedValueOnce(new Error("trends fail"));

      const { fetchAll, issues } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(issues.value).toHaveLength(2);
    });

    it("sets isLoadingTrends to false after trends failure", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW))
        .mockRejectedValueOnce(new Error("trends fail"));

      const { fetchAll, isLoadingTrends } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(isLoadingTrends.value).toBe(false);
    });

    it("does not call toast for non-fatal trends failure", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeHitsResponse(MOCK_ISSUE_HITS))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_HISTOGRAM_HITS))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_KPI_HIT]))
        .mockResolvedValueOnce(makeHitsResponse([MOCK_DENOMINATOR_HIT]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW))
        .mockRejectedValueOnce(new Error("trends fail"));

      const { fetchAll } = useErrorIssuesData();

      await fetchAll(DEFAULT_PARAMS);
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

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
        .mockResolvedValueOnce(makeHitsResponse([]))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

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

      // We'll queue: run A (5 calls) then run B (5+1 calls).
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
        .mockResolvedValueOnce(makeHitsResponse([])) // B-5 deploys
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS)); // B-6 trends

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

      // At least one of the 5+ calls should have req.encoding === 'base64'.
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
        .mockResolvedValueOnce(makeHitsResponse(MOCK_DEPLOY_HITS_IN_WINDOW))
        .mockResolvedValueOnce(makeHitsResponse(MOCK_TREND_HITS));

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
      // No trends call because the issue has no error_message.

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
