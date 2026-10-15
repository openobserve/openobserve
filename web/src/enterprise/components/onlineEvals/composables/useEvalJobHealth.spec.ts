// @vitest-environment jsdom
// Tests for useEvalJobHealth — the read-time health overlay for the Eval Jobs
// list. A failed request must leave the list renderable (empty map → "—").

import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockJobsHealth } = vi.hoisted(() => ({ mockJobsHealth: vi.fn() }));

vi.mock("@/services/online-evals.service", async (importOriginal) => {
  // vi.mock factories are hoisted above static imports, so the helper must be loaded here.
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { jobs: { health: mockJobsHealth } },
  });
});

import { useEvalJobHealth, MAX_HEALTH_JOBS } from "./useEvalJobHealth";
import type { EvalJob, EvalJobHealth } from "@/services/online-evals.service";

function job(id: string, status: EvalJob["status"]): EvalJob {
  return { id, name: id, stream: "default", scorers: [], status } as EvalJob;
}

function health(jobId: string): EvalJobHealth {
  return {
    jobId,
    health: "healthy",
    recentRuns: 3,
    recentErrors: 0,
    scores24h: 3,
    lastSuccessAt: 1,
    lastError: null,
  };
}

beforeEach(() => {
  mockJobsHealth.mockReset();
});

describe("useEvalJobHealth", () => {
  it("asks about every job except drafts, in one request", async () => {
    mockJobsHealth.mockResolvedValue([health("a"), health("c")]);
    const { healthById, loadHealth } = useEvalJobHealth();
    await loadHealth("org", [job("a", "active"), job("b", "draft"), job("c", "paused")]);
    expect(mockJobsHealth).toHaveBeenCalledTimes(1);
    expect(mockJobsHealth).toHaveBeenCalledWith("org", ["a", "c"]);
    expect(Object.keys(healthById.value)).toEqual(["a", "c"]);
  });

  it("caps the request at the server limit", async () => {
    mockJobsHealth.mockResolvedValue([]);
    const { loadHealth } = useEvalJobHealth();
    const jobs = Array.from({ length: MAX_HEALTH_JOBS + 5 }, (_, i) => job(`j${i}`, "active"));
    await loadHealth("org", jobs);
    expect(mockJobsHealth.mock.calls[0][1]).toHaveLength(MAX_HEALTH_JOBS);
  });

  it("skips the request when there is nothing to ask about", async () => {
    const { healthById, loadHealth } = useEvalJobHealth();
    await loadHealth("org", [job("b", "draft")]);
    expect(mockJobsHealth).not.toHaveBeenCalled();
    expect(healthById.value).toEqual({});
  });

  it("clears health when the request fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { healthById, loadHealth } = useEvalJobHealth();
    mockJobsHealth.mockResolvedValueOnce([health("a")]);
    await loadHealth("org", [job("a", "active")]);
    mockJobsHealth.mockRejectedValueOnce(new Error("boom"));
    await loadHealth("org", [job("a", "active")]);
    expect(healthById.value).toEqual({});
    warn.mockRestore();
  });

  it("ignores a response overtaken by a newer load", async () => {
    const slowResponse = Promise.withResolvers<EvalJobHealth[]>();
    mockJobsHealth
      .mockReturnValueOnce(slowResponse.promise)
      .mockResolvedValueOnce([health("new")]);
    const { healthById, loadHealth } = useEvalJobHealth();
    const slow = loadHealth("org", [job("old", "active")]);
    await loadHealth("org", [job("new", "active")]);
    slowResponse.resolve([health("old")]);
    await slow;
    expect(Object.keys(healthById.value)).toEqual(["new"]);
  });
});
