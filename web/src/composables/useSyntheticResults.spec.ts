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

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: { selectedOrganization: { identifier: "test-org" } },
  })),
}));

// Hoisted: `vi.mock` factories run before module init, so a plain `const` here
// would still be undefined when the factory closes over it.
const { getStreamMock } = vi.hoisted(() => ({
  getStreamMock: vi.fn(),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: getStreamMock,
  }),
}));

import useSyntheticResults from "./useSyntheticResults";

describe("useSyntheticResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Schema unknown by default: optional columns fall back to literals, which
    // is the shape most of these cases assert against.
    getStreamMock.mockRejectedValue(new Error("no stream"));
  });

  it("should map raw search responses into typed state via the adapters", async () => {
    // Order of Promise.all: kpi, lastRun, histogram, runs.
    executeQuery
      .mockResolvedValueOnce([
        { total_runs: 100, passed_runs: 99, failed_runs: 1, p95_duration: 2940 },
      ])
      .mockResolvedValueOnce([{ status: "passed", ts: 1_700_000_000_000_000 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ts: 1_700_000_000_000_000,
          status: "failed",
          duration: 1760,
          location: "us-east-1",
          device: "desktop",
          error: "Timeout",
        },
      ]);

    const { kpi, runs, loading, hasLoadedOnce, fetchAll } = useSyntheticResults();

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

  it("issues one query per Overview panel, all against the logs page type", async () => {
    executeQuery.mockResolvedValue([]);
    const { fetchAll } = useSyntheticResults();
    await fetchAll("mon-1", 1, 100);

    // KPI, last-run, histogram, runs — and nothing for the Steps tab. The step
    // aggregation is the most expensive request the page can make and the Steps
    // tab is the least-visited one, so it is not part of the Overview load;
    // counting calls is the only thing that notices if it creeps back in.
    expect(executeQuery).toHaveBeenCalledTimes(4);
    for (const call of executeQuery.mock.calls) {
      expect(call[3]).toBe("logs");
    }
    expect(executeQuery.mock.calls.some((c) => String(c[0]).includes("last_attempt_steps"))).toBe(
      false,
    );
  });

  it("issues the step queries only from fetchSteps", async () => {
    executeQuery.mockResolvedValue([]);
    const { fetchSteps } = useSyntheticResults();
    await fetchSteps("mon-1", 1, 100);

    // The step tally, and the step DEFINITIONS. The latter is a second, bounded
    // query rather than a column on the tally: `recorded_steps` is ~4 KB per row
    // and near-identical within a config version, so selecting it across the
    // 5000-row aggregation shipped the same payload thousands of times.
    //
    // `getStream` is mocked to reject here, so the schema is unknown and the
    // retry-attribution query does not fire — see the case below.
    expect(executeQuery).toHaveBeenCalledTimes(2);
    for (const call of executeQuery.mock.calls) {
      expect(call[3]).toBe("logs");
    }
    expect(executeQuery.mock.calls.some((c) => String(c[0]).includes("last_attempt_steps"))).toBe(
      true,
    );
  });

  it("adds the retry-attribution query only when the column exists", async () => {
    // `retry_step_ids` replaces reading `retry_history` on every row of the step
    // tally, so it is additive-then-subtractive: the third query buys back a
    // blob column. Gated on the schema because a stream that has never recorded
    // a retry does not have the field, and naming an absent column is rejected
    // outright by the search API.
    executeQuery.mockResolvedValue([]);
    getStreamMock.mockResolvedValueOnce({
      schema: [{ name: "attempts" }, { name: "retry_history" }, { name: "retry_step_ids" }],
    });

    const { fetchSteps } = useSyntheticResults();
    await fetchSteps("mon-1", 1, 100);

    const sql = executeQuery.mock.calls.map((c) => String(c[0]));
    expect(sql.some((q) => q.includes("retry_step_ids") && q.includes("attempts > 1"))).toBe(true);
    // And the tally stops selecting the blob it replaces.
    const tally = sql.find((q) => q.includes("last_attempt_steps"));
    expect(tally).toBeDefined();
    expect(tally).not.toContain("retry_history");
  });

  it("should not query when monitorId or the time range is missing", async () => {
    const { fetchAll } = useSyntheticResults();
    await fetchAll("", 1, 100);
    await fetchAll("mon-1", 0, 0);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("should surface a per-group error and reset state when a query fails", async () => {
    executeQuery.mockRejectedValue(new Error("boom"));
    const { kpiError, runsError, kpi, runs, fetchAll } = useSyntheticResults();
    await fetchAll("mon-1", 1, 100);
    // Errors are surfaced per-group, not at the top level
    expect(kpiError.value).toBe("boom");
    expect(runsError.value).toBe("boom");
    expect(kpi.value.totalRuns).toBe(0);
    expect(runs.value).toEqual([]);
  });
});
