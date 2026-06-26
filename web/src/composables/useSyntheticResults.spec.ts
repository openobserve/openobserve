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

import { describe, expect, it, vi, beforeEach } from "vitest";

const executeQuery = vi.fn();
const cancelAll = vi.fn();

vi.mock("@/plugins/traces/composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({ executeQuery, cancelAll }),
}));

import useSyntheticResults from "./useSyntheticResults";

describe("useSyntheticResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should map raw search responses into typed state via the adapters", async () => {
    // Order of Promise.all: kpi, lastRun, histogram, runs.
    executeQuery
      .mockResolvedValueOnce([
        { total_runs: 100, passed_runs: 99, failed_runs: 1, p95_duration: 2940 },
      ])
      .mockResolvedValueOnce([{ status: "up", ts: 1_700_000_000_000_000 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ts: 1_700_000_000_000_000,
          status: "down",
          duration: 1760,
          location: "us-east-1",
          device: "desktop",
          error: "Timeout",
        },
      ]);

    const { kpi, runs, loading, hasLoadedOnce, fetchAll } =
      useSyntheticResults();

    await fetchAll("mon-1", 1_700_000_000_000_000, 1_700_003_600_000_000);

    expect(kpi.value.totalRuns).toBe(100);
    expect(kpi.value.failedRuns).toBe(1);
    expect(kpi.value.uptimePct).toBeCloseTo(99, 5);
    expect(kpi.value.lastRunStatus).toBe("passed");
    expect(runs.value).toHaveLength(1);
    expect(runs.value[0].status).toBe("failed");
    expect(runs.value[0].location).toBe("us-east-1");
    expect(loading.value).toBe(false);
    expect(hasLoadedOnce.value).toBe(true);
  });

  it("should issue four scoped queries against the logs page type", async () => {
    executeQuery.mockResolvedValue([]);
    const { fetchAll } = useSyntheticResults();
    await fetchAll("mon-1", 1, 100);
    expect(executeQuery).toHaveBeenCalledTimes(4);
    for (const call of executeQuery.mock.calls) {
      expect(call[3]).toBe("logs");
    }
  });

  it("should not query when monitorId or the time range is missing", async () => {
    const { fetchAll } = useSyntheticResults();
    await fetchAll("", 1, 100);
    await fetchAll("mon-1", 0, 0);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("should surface an error message and reset state when a query fails", async () => {
    executeQuery.mockRejectedValue(new Error("boom"));
    const { error, kpi, runs, fetchAll } = useSyntheticResults();
    await fetchAll("mon-1", 1, 100);
    expect(error.value).toBe("boom");
    expect(kpi.value.totalRuns).toBe(0);
    expect(runs.value).toEqual([]);
  });
});
