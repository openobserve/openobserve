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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";

// ---------------------------------------------------------------------------
// Mock useErrorIssuesData — mutable refs shared across the mock factory and
// the tests, following the same pattern used in TraceCorrelationCard.spec.ts.
// The factory arrow function is only invoked when useErrorImpact() calls
// useErrorIssuesData(), which happens inside each test (after these `let`
// assignments below have already executed), so referencing them here is safe.
// ---------------------------------------------------------------------------

const fetchAll = vi.fn().mockResolvedValue(undefined);

let issues = ref<any[]>([]);
let chartSeries = ref<any[]>([]);
let latestDeploy = ref<any>(null);
let deploySpikeFactor = ref<number | null>(null);
let kpis = ref<any>({
  usersAffected: 0,
  totalUsers: 0,
  errorSessions: 0,
  crashFreePct: null,
});
let isLoadingIssues = ref(false);
let isLoadingChart = ref(false);
let isLoadingKpis = ref(false);

vi.mock("@/composables/rum/useErrorIssuesData", () => ({
  default: () => ({
    issues,
    chartSeries,
    latestDeploy,
    deploySpikeFactor,
    kpis,
    isLoadingIssues,
    isLoadingChart,
    isLoadingKpis,
    fetchAll,
  }),
}));

import useErrorImpact from "@/composables/rum/useErrorImpact";

const SEVEN_DAYS_US = 604800000000;

describe("useErrorImpact", () => {
  beforeEach(() => {
    fetchAll.mockClear();
    fetchAll.mockResolvedValue(undefined);

    issues.value = [];
    chartSeries.value = [];
    latestDeploy.value = null;
    deploySpikeFactor.value = null;
    kpis.value = {
      usersAffected: 0,
      totalUsers: 0,
      errorSessions: 0,
      crashFreePct: null,
    };
    isLoadingIssues.value = false;
    isLoadingChart.value = false;
    isLoadingKpis.value = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // =========================================================================
  // loadForError — signature clause construction
  // =========================================================================

  describe("loadForError signature clause", () => {
    it("builds a WHERE-clause from error_type, error_message and error_handling and forwards service", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();
      const error = {
        error_type: "TypeError",
        error_message: "Cannot read property foo",
        error_handling: "unhandled",
      };

      // Act
      await loadForError(error, "web-app");

      // Assert
      expect(fetchAll).toHaveBeenCalledTimes(1);
      const params = fetchAll.mock.calls[0][0];
      expect(params.userQuery).toBe(
        "error_type = 'TypeError' AND error_message = 'Cannot read property foo' AND error_handling = 'unhandled'",
      );
      expect(params.service).toBe("web-app");
    });

    it("defaults service to an empty string when not provided", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();

      // Act
      await loadForError({ error_type: "TypeError" });

      // Assert
      const params = fetchAll.mock.calls[0][0];
      expect(params.service).toBe("");
    });

    it("escapes single quotes in error_message by doubling them", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();
      const error = { error_type: "Error", error_message: "it's broken" };

      // Act
      await loadForError(error);

      // Assert
      const params = fetchAll.mock.calls[0][0];
      expect(params.userQuery).toBe(
        "error_type = 'Error' AND error_message = 'it''s broken'",
      );
    });

    it("uses IS NULL for a field that is explicitly null on the record", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();
      const error = { error_type: "TypeError", error_message: null };

      // Act
      await loadForError(error);

      // Assert
      const params = fetchAll.mock.calls[0][0];
      expect(params.userQuery).toBe(
        "error_type = 'TypeError' AND error_message IS NULL",
      );
    });

    it("omits a field entirely when it is undefined on the record", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();
      const error = {
        error_type: "TypeError",
        error_message: undefined,
        error_handling: undefined,
      };

      // Act
      await loadForError(error);

      // Assert
      const params = fetchAll.mock.calls[0][0];
      expect(params.userQuery).toBe("error_type = 'TypeError'");
      expect(params.userQuery).not.toContain("error_message");
      expect(params.userQuery).not.toContain("error_handling");
    });

    it("returns without calling fetchAll when the record has no signature fields", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();

      // Act
      await loadForError({});

      // Assert
      expect(fetchAll).not.toHaveBeenCalled();
    });

    it("returns without calling fetchAll when error_type and error_message are both undefined", async () => {
      // Arrange
      const { loadForError } = useErrorImpact();

      // Act
      await loadForError({ unrelated_field: "x" });

      // Assert
      expect(fetchAll).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // loadForError — trailing 7-day window
  // =========================================================================

  describe("loadForError time window", () => {
    it("ends the window at now (µs) and starts it 7 days earlier when the error predates now", async () => {
      // Arrange
      const fixedNowMs = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(fixedNowMs);
      const errorTs = fixedNowMs * 1000 - 1_000_000; // 1s before now, in µs
      const { loadForError } = useErrorImpact();

      // Act
      await loadForError({ error_type: "TypeError", _timestamp: errorTs });

      // Assert
      const params = fetchAll.mock.calls[0][0];
      const expectedEnd = fixedNowMs * 1000;
      expect(params.endTime).toBe(expectedEnd);
      expect(params.startTime).toBe(expectedEnd - SEVEN_DAYS_US);
    });

    it("ends the window at the error's own timestamp when it is more recent than now", async () => {
      // Arrange
      const fixedNowMs = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(fixedNowMs);
      const errorTs = fixedNowMs * 1000 + 5_000_000; // 5s after now, in µs
      const { loadForError } = useErrorImpact();

      // Act
      await loadForError({ error_type: "TypeError", _timestamp: errorTs });

      // Assert
      const params = fetchAll.mock.calls[0][0];
      expect(params.endTime).toBe(errorTs);
      expect(params.startTime).toBe(errorTs - SEVEN_DAYS_US);
    });

    it("treats a missing _timestamp as 0, using now as the window end", async () => {
      // Arrange
      const fixedNowMs = 1_700_000_000_000;
      vi.spyOn(Date, "now").mockReturnValue(fixedNowMs);
      const { loadForError } = useErrorImpact();

      // Act
      await loadForError({ error_type: "TypeError" });

      // Assert
      const params = fetchAll.mock.calls[0][0];
      expect(params.endTime).toBe(fixedNowMs * 1000);
    });
  });

  // =========================================================================
  // metrics computed
  // =========================================================================

  describe("metrics", () => {
    it("maps the underlying issue row to impact metrics", () => {
      // Arrange
      issues.value = [
        {
          events: 42,
          users_affected: 5,
          sessions_affected: 7,
          first_seen: 1000,
          zo_sql_timestamp: 2000,
          status: "new",
        },
      ];
      kpis.value = {
        usersAffected: 3,
        totalUsers: 50,
        errorSessions: 9,
        crashFreePct: 88,
      };

      // Act
      const { metrics } = useErrorImpact();

      // Assert
      expect(metrics.value.occurrences).toBe(42);
      expect(metrics.value.usersAffected).toBe(5);
      expect(metrics.value.totalUsers).toBe(50);
      expect(metrics.value.sessionsAffected).toBe(7);
      expect(metrics.value.crashFreePct).toBe(88);
      expect(metrics.value.firstSeen).toBe(1000);
      expect(metrics.value.lastSeen).toBe(2000);
      expect(metrics.value.status).toBe("new");
    });

    it("falls back to kpis-derived values when no issue row is present", () => {
      // Arrange
      issues.value = [];
      kpis.value = {
        usersAffected: 3,
        totalUsers: 50,
        errorSessions: 9,
        crashFreePct: 88,
      };

      // Act
      const { metrics } = useErrorImpact();

      // Assert
      expect(metrics.value.occurrences).toBe(0);
      expect(metrics.value.usersAffected).toBe(3);
      expect(metrics.value.totalUsers).toBe(50);
      expect(metrics.value.sessionsAffected).toBe(9);
      expect(metrics.value.crashFreePct).toBe(88);
      expect(metrics.value.firstSeen).toBe(0);
      expect(metrics.value.lastSeen).toBe(0);
      expect(metrics.value.status).toBe("ongoing");
    });

    it("falls back to kpis usersAffected/sessionsAffected when the row omits them", () => {
      // Arrange — row present but without users_affected / sessions_affected
      issues.value = [
        { events: 10, first_seen: 100, zo_sql_timestamp: 200, status: "ongoing" },
      ];
      kpis.value = {
        usersAffected: 4,
        totalUsers: 20,
        errorSessions: 6,
        crashFreePct: 70,
      };

      // Act
      const { metrics } = useErrorImpact();

      // Assert
      expect(metrics.value.usersAffected).toBe(4);
      expect(metrics.value.sessionsAffected).toBe(6);
    });

    it("always sources totalUsers and crashFreePct from kpis, never from the row", () => {
      // Arrange
      issues.value = [
        {
          events: 10,
          users_affected: 1,
          sessions_affected: 1,
          first_seen: 100,
          zo_sql_timestamp: 200,
          status: "ongoing",
        },
      ];
      kpis.value = {
        usersAffected: 1,
        totalUsers: 999,
        errorSessions: 1,
        crashFreePct: 55.5,
      };

      // Act
      const { metrics } = useErrorImpact();

      // Assert
      expect(metrics.value.totalUsers).toBe(999);
      expect(metrics.value.crashFreePct).toBe(55.5);
    });
  });

  // =========================================================================
  // Re-exposed refs
  // =========================================================================

  describe("re-exposed refs", () => {
    it("exposes chartBuckets as the underlying chartSeries ref", () => {
      // Arrange
      chartSeries.value = [{ ts: 1, handled: 1, unhandled: 2 }];

      // Act
      const { chartBuckets } = useErrorImpact();

      // Assert
      expect(chartBuckets.value).toEqual([{ ts: 1, handled: 1, unhandled: 2 }]);
    });

    it("exposes latestDeploy from the underlying composable", () => {
      // Arrange
      latestDeploy.value = { version: "1.2.3", firstSeen: 500 };

      // Act
      const { latestDeploy: exposedDeploy } = useErrorImpact();

      // Assert
      expect(exposedDeploy.value).toEqual({ version: "1.2.3", firstSeen: 500 });
    });

    it("exposes deploySpikeFactor from the underlying composable", () => {
      // Arrange
      deploySpikeFactor.value = 2.5;

      // Act
      const { deploySpikeFactor: exposedSpike } = useErrorImpact();

      // Assert
      expect(exposedSpike.value).toBe(2.5);
    });
  });

  // =========================================================================
  // isLoading
  // =========================================================================

  describe("isLoading", () => {
    it("is false when none of the underlying loads are in flight", () => {
      // Act
      const { isLoading } = useErrorImpact();

      // Assert
      expect(isLoading.value).toBe(false);
    });

    it("is true when isLoadingIssues is true", () => {
      // Arrange
      isLoadingIssues.value = true;

      // Act
      const { isLoading } = useErrorImpact();

      // Assert
      expect(isLoading.value).toBe(true);
    });

    it("is true when isLoadingChart is true", () => {
      // Arrange
      isLoadingChart.value = true;

      // Act
      const { isLoading } = useErrorImpact();

      // Assert
      expect(isLoading.value).toBe(true);
    });

    it("is true when isLoadingKpis is true", () => {
      // Arrange
      isLoadingKpis.value = true;

      // Act
      const { isLoading } = useErrorImpact();

      // Assert
      expect(isLoading.value).toBe(true);
    });
  });
});
